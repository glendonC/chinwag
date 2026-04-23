/**
 * LiteLLM key resolver
 * ====================
 *
 * Maps a raw `agent_model` string (captured client-side from a tool's own
 * logs) to a top-level key in LiteLLM's `model_prices_and_context_window.json`.
 *
 * Design rules (all discovered by probing the real JSON, not guessed):
 *
 *  1. Never rename between dash-separated forms (`claude-3-5-sonnet` is LiteLLM's
 *     canonical shape; `claude-sonnet-3-5` is chinmeister's *display* canonical and
 *     does NOT exist in LiteLLM). This resolver stays in LiteLLM space end-to-end.
 *  2. Always try candidates in order of specificity (most specific first), so a
 *     dated key wins over a bare family key when both exist. This matters for
 *     e.g. `claude-opus-4-6-20260205` (dated key is pricing-accurate for the
 *     release) vs `claude-opus-4-6` (base, also priced but may drift).
 *  3. Provider prefixes are BOTH stripped AND added, because LiteLLM is
 *     inconsistent: `gemini-2.5-pro` exists bare, `deepseek/deepseek-r1` only
 *     exists prefixed, and `xai/grok-4` only exists prefixed.
 *  4. Return `null` on no match. Callers (e.g. pricing lookup) should fall back
 *     to display grouping or surface the miss via telemetry. We deliberately do
 *     NOT fall back to a "family prefix" match like `gpt-5.3-codex → gpt-5.3`
 *     because that silently prices a new SKU with stale data (see NOTES below).
 *
 * NOTES on gotchas found during research:
 *  - `claude-3-5-sonnet-20241022` is NOT a bare LiteLLM key. LiteLLM uses
 *    `anthropic.claude-3-5-sonnet-20241022-v2:0` (Bedrock style) or
 *    `vertex_ai/claude-3-5-sonnet@20241022`. There is no un-prefixed key for
 *    3.5 Sonnet / 3.5 Haiku / 3 Opus / 3 Sonnet / 3 Haiku / Opus 4 / Sonnet 4
 *    *without* a date. The dated bare forms DO exist for Opus 4 and Sonnet 4
 *    (`claude-opus-4-20250514`, `claude-sonnet-4-20250514`) and for 3.7-sonnet
 *    (`claude-3-7-sonnet-20250219`). Bare 3.5/3-opus/3-haiku do NOT.
 *  - Claude 4.5 and 4.6 DO have bare forms (`claude-sonnet-4-5`,
 *    `claude-sonnet-4-6`, `claude-opus-4-6`) AND dated forms — we prefer dated
 *    when available.
 *  - `grok-*` and `deepseek-v3`/`deepseek-r1` only exist with provider prefix.
 *  - Gemini exists bare (`gemini-2.5-pro`) AND prefixed (`gemini/gemini-2.5-pro`).
 *    `vertex_ai/gemini-2.5-pro` does NOT exist; Vertex Gemini pricing lives at
 *    other keys. Strip `vertex_ai/` for Gemini and fall through to bare.
 *  - `models/gemini-2.5-pro` is Google SDK style. Strip `models/` prefix.
 *  - Bedrock inference profiles use `{region}.anthropic.claude-*` (e.g.
 *    `us.anthropic.claude-sonnet-4-5-20250929-v1:0`). We only normalize the
 *    top-level `bedrock/{region}/...` form the SDK emits; region-prefixed bare
 *    forms we leave alone (the raw key is already an exact LiteLLM match).
 */

const PROVIDER_PREFIX_RE =
  /^(?:anthropic|openai|google|vertex_ai|azure|azure_ai|bedrock|models|gemini|deepseek|xai|meta|perplexity|openrouter|replicate)\/[^/]*\//;

const SIMPLE_PROVIDER_PREFIX_RE =
  /^(?:anthropic|openai|google|vertex_ai|azure|azure_ai|bedrock|models|gemini|deepseek|xai|meta)\//;

const DATE_SUFFIX_YYYYMMDD_RE = /-\d{8}$/; // -20250929 (Anthropic style)
const DATE_SUFFIX_YYYY_MM_DD_RE = /-\d{4}-\d{2}-\d{2}$/; // -2025-08-07 (OpenAI style)

// Bedrock version suffix. Must include the `:N` tail, otherwise `-v3` in
// `deepseek-v3` collides with the strip (and `deepseek-v3.2`, `claude-v1`, etc.)
// LiteLLM Bedrock IDs we've seen always have the colon form: `-v1:0`, `-v2:0`.
// The bare trailing `-vN` without a colon is NEVER a Bedrock version, it's
// part of a model name.
const BEDROCK_VERSION_SUFFIX_RE = /-v\d+:\d+$/;

/**
 * Strip a single `@suffix` (Vertex style: `claude-sonnet-4-5@20250929`).
 * We remove the `@...` tail entirely; LiteLLM's bare key form never uses `@`.
 */
function stripAtSuffix(s: string): string {
  const at = s.indexOf('@');
  return at === -1 ? s : s.slice(0, at);
}

/**
 * Strip a leading provider prefix like `anthropic/`, `vertex_ai/`,
 * `bedrock/us-west-2/`, `models/`, etc. Returns the tail only.
 * We handle TWO-segment prefixes (e.g. `bedrock/us-west-2/`) first, then
 * single-segment.
 */
function stripProviderPrefix(s: string): string {
  // bedrock/us-west-2/... or vertex_ai/us-central-1/... etc
  const two = s.replace(PROVIDER_PREFIX_RE, '');
  if (two !== s) return two;
  return s.replace(SIMPLE_PROVIDER_PREFIX_RE, '');
}

/**
 * Strip a trailing Bedrock version suffix like `-v1:0` or `-v2:0`.
 * Runs AFTER date stripping, because Bedrock keys are of the form
 * `claude-sonnet-4-5-20250929-v1:0`.
 */
function stripBedrockVersion(s: string): string {
  return s.replace(BEDROCK_VERSION_SUFFIX_RE, '');
}

/**
 * Strip an `anthropic.` prefix (Bedrock model ID namespace, not the slash form).
 * Also strips the region-prefix variants `us.anthropic.`, `eu.anthropic.`, etc.
 */
function stripAnthropicDotPrefix(s: string): string {
  return s.replace(/^(?:[a-z]{2}(?:-[a-z]+)?\.)?anthropic\./, '');
}

/**
 * Strip a date suffix, trying both formats. Returns the cleaned string OR the
 * original if no date was present.
 */
function stripDateSuffix(s: string): string {
  if (DATE_SUFFIX_YYYYMMDD_RE.test(s)) return s.replace(DATE_SUFFIX_YYYYMMDD_RE, '');
  if (DATE_SUFFIX_YYYY_MM_DD_RE.test(s)) return s.replace(DATE_SUFFIX_YYYY_MM_DD_RE, '');
  return s;
}

/**
 * Generate ordered candidates for a raw model string, most specific first.
 * The resolver tries each in order against the LiteLLM key set.
 */
export function generateCandidates(rawInput: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    if (!s) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  const raw = rawInput.trim().toLowerCase();
  if (!raw) return out;

  // 1. Original (before any transforms) — catches things that are already
  //    valid LiteLLM keys like `xai/grok-4` or `gemini/gemini-2.5-pro`.
  push(raw);

  // 2. Strip provider prefix (slash form). Then try that, dated and undated.
  const noPrefix = stripProviderPrefix(raw);
  push(noPrefix);

  // 3. Strip `anthropic.` dot-namespace prefix (Bedrock-style model IDs).
  const noDotPrefix = stripAnthropicDotPrefix(noPrefix);
  push(noDotPrefix);

  // 4. Strip @suffix (Vertex style) from whatever we have.
  const noAt = stripAtSuffix(noDotPrefix);
  push(noAt);

  // 5. Strip bedrock -v1:0 / -v2:0 suffix.
  const noVersion = stripBedrockVersion(noAt);
  push(noVersion);

  // 6. Strip date suffix (either format).
  const noDate = stripDateSuffix(noVersion);
  push(noDate);

  // 7. At each level, also try with common provider prefixes added back,
  //    because some LiteLLM keys only exist prefixed (xai/grok-*,
  //    deepseek/deepseek-*, gemini/gemini-*).
  //    We prefix the most-stripped candidate since that's the cleanest form.
  const base = noDate;
  push(`xai/${base}`);
  push(`deepseek/${base}`);
  push(`gemini/${base}`);
  push(`anthropic/${base}`);
  push(`openai/${base}`);

  // 8. Also try prefixing the dated candidate (before date strip). Some dated
  //    Anthropic keys live at bare top-level (`claude-opus-4-20250514`) and
  //    prefixing gains nothing, but for safety we add it anyway.
  if (noVersion !== base) {
    push(`anthropic/${noVersion}`);
  }

  return out;
}

/**
 * Resolve a raw model string to a LiteLLM key, or return null.
 *
 * @param rawInput  The raw `agent_model` string as captured client-side.
 * @param liteLLMKeySet  Set of top-level keys from
 *                       `model_prices_and_context_window.json`.
 * @returns  The first candidate that is a member of `liteLLMKeySet`, or `null`.
 */
export function resolveLiteLLMKey(
  rawInput: string | null | undefined,
  liteLLMKeySet: Set<string>,
): string | null {
  if (!rawInput || typeof rawInput !== 'string') return null;

  const candidates = generateCandidates(rawInput);
  for (const candidate of candidates) {
    if (liteLLMKeySet.has(candidate)) return candidate;
  }
  return null;
}
