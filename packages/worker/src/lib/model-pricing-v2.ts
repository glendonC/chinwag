// Pure session-cost function. Replaces the legacy model-pricing.ts estimate
// that hardcoded ~20 entries with no cache-token support.
//
// Contract:
//   - takes a single ModelPriceRow (resolved upstream via litellm-resolver
//     against the isolate cache) plus the four token counts for the session
//   - returns a USD cost number, or null if the row is missing
//   - NEVER returns 0 on missing data; a null signals "we don't know" and
//     the response contract surfaces it via models_without_pricing
//   - uses the above_200k pricing tier when the combined input volume
//     (uncached + cache_read + cache_creation) exceeds 200K tokens
//   - falls back to ratio pricing (cache_write = 1.25x input, cache_read =
//     0.1x input) for models that lack explicit cache fields in LiteLLM
//
// The cost computation mirrors Anthropic's billing model: cache reads are
// billed at ~10% of the input rate, cache writes at ~125%, output at the
// output rate. For heavy-cache Claude Code sessions (the default), cache
// reads typically account for the dominant input-side cost.

export interface ModelPriceRow {
  canonical_name: string;
  input_per_1m: number;
  output_per_1m: number;
  cache_creation_per_1m: number | null;
  cache_read_per_1m: number | null;
  input_per_1m_above_200k: number | null;
  output_per_1m_above_200k: number | null;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
}

export interface TokenUsageInput {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// Fallback ratios used when a LiteLLM record lacks explicit cache fields.
// These mirror Anthropic's published multipliers and are the same defaults
// CodeBurn's parseLiteLLMEntry uses (models.ts:62).
const CACHE_WRITE_RATIO = 1.25;
const CACHE_READ_RATIO = 0.1;

const LONG_CONTEXT_THRESHOLD = 200_000;

/**
 * Estimate the USD cost of a session given resolved pricing and four token
 * counts. Returns null when pricing is unavailable; callers render "—" and
 * increment an unknown-model counter rather than treating null as zero.
 */
export function estimateSessionCostV2(
  row: ModelPriceRow | null | undefined,
  tokens: TokenUsageInput,
): number | null {
  if (!row) return null;

  // Tier selection: Claude Sonnet 4.5 / 4.6 and Gemini 2.5 Pro charge an
  // above_200k rate when the prompt exceeds 200K tokens. We approximate per
  // session using the combined input volume (uncached + cached portions) as
  // the tier signal. This is pessimistic for sessions that made many small
  // requests over cached context but stayed under 200K per request; the
  // correct fix would require per-request pricing, which we don't have.
  const totalInputVolume = tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheCreationTokens;
  const useAbove200k =
    totalInputVolume > LONG_CONTEXT_THRESHOLD && row.input_per_1m_above_200k != null;

  const inputRate = useAbove200k ? row.input_per_1m_above_200k! : row.input_per_1m;
  const outputRate =
    useAbove200k && row.output_per_1m_above_200k != null
      ? row.output_per_1m_above_200k
      : row.output_per_1m;

  // Cache pricing: prefer LiteLLM's explicit fields, fall back to ratios.
  // We use the base input rate (not the above_200k rate) as the anchor for
  // ratio fallbacks, since LiteLLM never exposes cache pricing tiered on
  // prompt length.
  const cacheCreationRate = row.cache_creation_per_1m ?? row.input_per_1m * CACHE_WRITE_RATIO;
  const cacheReadRate = row.cache_read_per_1m ?? row.input_per_1m * CACHE_READ_RATIO;

  const cost =
    (tokens.inputTokens / 1_000_000) * inputRate +
    (tokens.outputTokens / 1_000_000) * outputRate +
    (tokens.cacheReadTokens / 1_000_000) * cacheReadRate +
    (tokens.cacheCreationTokens / 1_000_000) * cacheCreationRate;

  // Defensive: a NaN here would serialize as null through JSON anyway, but
  // returning null explicitly keeps the contract predictable and lets the
  // enrichment layer count it as an unknown-model failure.
  if (!Number.isFinite(cost)) return null;
  return cost;
}
