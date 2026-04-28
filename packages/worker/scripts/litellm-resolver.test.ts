/**
 * Coverage harness for `resolveLiteLLMKey`.
 *
 * This file is a plain-node executable (no test runner dependency). Validate
 * resolver coverage against the real LiteLLM JSON with:
 *
 *     node --experimental-strip-types \
 *       packages/worker/scripts/litellm-resolver.test.ts
 *
 * It fetches the live JSON the first time and caches it at /tmp/litellm.json
 * for subsequent runs. The `CASES` list is exported so it can be reused by a
 * real vitest spec once one is added to the repo.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolveLiteLLMKey, generateCandidates } from '../src/lib/litellm-resolver.ts';

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_PATH = '/tmp/litellm.json';

export type TestCase = {
  category: string;
  raw: string | null;
  /**
   * Expected LiteLLM key. `null` means "we expect no match, and that's
   * correct." When several variants are equally correct, leave `expected`
   * as one and list the rest in `acceptAny`.
   */
  expected: string | null;
  /** Leave empty to require exact match; set if any of these are acceptable. */
  acceptAny?: string[];
  notes?: string;
};

export const CASES: TestCase[] = [
  // ---- Claude Code JSONL outputs (Anthropic API names) ----
  {
    category: 'claude-jsonl',
    raw: 'claude-sonnet-4-5-20250929',
    expected: 'claude-sonnet-4-5-20250929',
  },
  {
    category: 'claude-jsonl',
    raw: 'claude-opus-4-5-20251101',
    expected: 'claude-opus-4-5-20251101',
  },
  {
    category: 'claude-jsonl',
    raw: 'claude-haiku-4-5-20251001',
    expected: 'claude-haiku-4-5-20251001',
  },
  {
    category: 'claude-jsonl',
    raw: 'claude-opus-4-20250514',
    expected: 'claude-opus-4-20250514',
  },
  {
    category: 'claude-jsonl',
    raw: 'claude-sonnet-4-20250514',
    expected: 'claude-sonnet-4-20250514',
  },
  {
    category: 'claude-jsonl',
    raw: 'claude-3-5-sonnet-20241022',
    // No bare LiteLLM key exists - only bedrock/vertex forms. Resolver must
    // fall through via prefix-add. openrouter/anthropic/... doesn't exist as
    // a bare candidate either, so we expect null and propose a targeted fix.
    expected: null,
    notes: 'LiteLLM has no bare claude-3-5-sonnet key',
  },
  {
    category: 'claude-jsonl',
    raw: 'claude-3-5-haiku-20241022',
    expected: null,
    notes: 'LiteLLM has no bare claude-3-5-haiku key',
  },
  {
    category: 'claude-jsonl',
    raw: 'claude-sonnet-4-6-20260205',
    // Sonnet 4.6 has bare form only - NOT the dated one. Opus 4.6 has dated.
    // So dated Sonnet 4.6 must strip-to-base and find `claude-sonnet-4-6`.
    expected: 'claude-sonnet-4-6',
    notes: 'Date unknown for Sonnet 4.6 - only bare key exists',
  },
  {
    category: 'claude-jsonl',
    raw: 'claude-opus-4-6-20260205',
    expected: 'claude-opus-4-6-20260205',
  },
  {
    category: 'claude-jsonl',
    raw: 'claude-3-7-sonnet-20250219',
    expected: 'claude-3-7-sonnet-20250219',
  },

  // ---- Bedrock forms ----
  {
    category: 'bedrock',
    raw: 'bedrock/us-west-2/claude-sonnet-4-5-20250929-v1:0',
    // `bedrock/us-gov-west-1/claude-sonnet-4-5-20250929-v1:0` exists but
    // us-west-2 does not. Resolver strips `bedrock/us-west-2/` and finds the
    // dated version-suffixed bare key, which is pricing-accurate for this
    // Bedrock deployment.
    expected: 'claude-sonnet-4-5-20250929-v1:0',
  },
  {
    category: 'bedrock',
    raw: 'claude-sonnet-4-5-20250929-v1:0',
    // Exact key present in LiteLLM.
    expected: 'claude-sonnet-4-5-20250929-v1:0',
  },
  {
    category: 'bedrock',
    raw: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    expected: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  },
  {
    category: 'bedrock',
    raw: 'anthropic.claude-sonnet-4-6',
    expected: 'anthropic.claude-sonnet-4-6',
  },

  // ---- Vertex forms ----
  {
    category: 'vertex',
    raw: 'vertex_ai/claude-sonnet-4-5@20250929',
    expected: 'vertex_ai/claude-sonnet-4-5@20250929',
  },
  {
    category: 'vertex',
    raw: 'vertex_ai/gemini-2.5-pro',
    // No `vertex_ai/gemini-2.5-pro` key exists - Vertex Gemini pricing lives
    // at other keys. Resolver strips prefix and falls to bare `gemini-2.5-pro`.
    expected: 'gemini-2.5-pro',
    notes: 'Vertex Gemini bare-prefixed key does not exist; fall through to bare',
  },

  // ---- OpenAI ----
  { category: 'openai', raw: 'gpt-5', expected: 'gpt-5' },
  { category: 'openai', raw: 'gpt-5-mini', expected: 'gpt-5-mini' },
  { category: 'openai', raw: 'gpt-5-2025-08-07', expected: 'gpt-5-2025-08-07' },
  { category: 'openai', raw: 'gpt-5.1', expected: 'gpt-5.1' },
  { category: 'openai', raw: 'gpt-5.2', expected: 'gpt-5.2' },
  {
    category: 'openai',
    raw: 'gpt-5.3-codex',
    expected: 'gpt-5.3-codex',
  },
  { category: 'openai', raw: 'gpt-5.4', expected: 'gpt-5.4' },
  { category: 'openai', raw: 'gpt-4o', expected: 'gpt-4o' },
  { category: 'openai', raw: 'gpt-4o-mini', expected: 'gpt-4o-mini' },
  { category: 'openai', raw: 'gpt-4o-2024-11-20', expected: 'gpt-4o-2024-11-20' },
  { category: 'openai', raw: 'o3', expected: 'o3' },
  { category: 'openai', raw: 'o3-mini', expected: 'o3-mini' },
  { category: 'openai', raw: 'o4-mini', expected: 'o4-mini' },
  { category: 'openai', raw: 'openai/gpt-5', expected: 'gpt-5' },

  // ---- Codex forms (CodeBurn FALLBACK_PRICING compatibility) ----
  { category: 'codex', raw: 'gpt-5-codex', expected: 'gpt-5-codex' },
  { category: 'codex', raw: 'gpt-5.1-codex', expected: 'gpt-5.1-codex' },

  // ---- Gemini ----
  { category: 'gemini', raw: 'gemini-2.5-pro', expected: 'gemini-2.5-pro' },
  { category: 'gemini', raw: 'gemini-2.5-flash', expected: 'gemini-2.5-flash' },
  { category: 'gemini', raw: 'google/gemini-2.5-pro', expected: 'gemini-2.5-pro' },
  {
    category: 'gemini',
    raw: 'models/gemini-2.5-pro',
    expected: 'gemini-2.5-pro',
    notes: 'Google SDK-style prefix',
  },
  {
    category: 'gemini',
    raw: 'gemini/gemini-2.5-pro',
    expected: 'gemini/gemini-2.5-pro',
    notes: 'LiteLLM has both bare AND gemini/ forms; both resolve',
  },

  // ---- Grok ----
  { category: 'grok', raw: 'grok-4', expected: 'xai/grok-4' },
  { category: 'grok', raw: 'xai/grok-4', expected: 'xai/grok-4' },
  { category: 'grok', raw: 'xai/grok-code-fast-1', expected: 'xai/grok-code-fast-1' },
  { category: 'grok', raw: 'grok-3', expected: 'xai/grok-3' },
  { category: 'grok', raw: 'grok-3-mini', expected: 'xai/grok-3-mini' },

  // ---- DeepSeek ----
  { category: 'deepseek', raw: 'deepseek-v3', expected: 'deepseek/deepseek-v3' },
  { category: 'deepseek', raw: 'deepseek-r1', expected: 'deepseek/deepseek-r1' },
  { category: 'deepseek', raw: 'deepseek/deepseek-r1', expected: 'deepseek/deepseek-r1' },

  // ---- Edge cases ----
  { category: 'edge', raw: '', expected: null },
  { category: 'edge', raw: '   ', expected: null },
  { category: 'edge', raw: null, expected: null },
  { category: 'edge', raw: 'foo/bar', expected: null, notes: 'unknown prefix' },
  {
    category: 'edge',
    raw: 'claude-3-5-sonnet',
    expected: null,
    notes: 'no dated form, no bare LiteLLM key - genuine miss',
  },
];

async function loadLiteLLMKeys(): Promise<Set<string>> {
  let json: Record<string, unknown>;
  if (existsSync(CACHE_PATH)) {
    json = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
  } else {
    const res = await fetch(LITELLM_URL);
    if (!res.ok) throw new Error(`Failed to fetch LiteLLM JSON: ${res.status}`);
    const text = await res.text();
    writeFileSync(CACHE_PATH, text);
    json = JSON.parse(text);
  }
  return new Set(Object.keys(json));
}

type Result = {
  category: string;
  raw: string | null;
  expected: string | null;
  actual: string | null;
  candidateMatched: string | null;
  candidateIndex: number;
  pass: boolean;
};

function runCoverage(keySet: Set<string>): Result[] {
  const results: Result[] = [];
  for (const c of CASES) {
    const actual = resolveLiteLLMKey(c.raw, keySet);
    let idx = -1;
    if (c.raw) {
      const cands = generateCandidates(c.raw);
      idx = cands.findIndex((x) => x === actual);
    }
    const pass = actual === c.expected;
    results.push({
      category: c.category,
      raw: c.raw,
      expected: c.expected,
      actual,
      candidateMatched: actual,
      candidateIndex: idx,
      pass,
    });
  }
  return results;
}

async function main() {
  const keys = await loadLiteLLMKeys();
  console.log(`Loaded ${keys.size} LiteLLM keys.\n`);

  const results = runCoverage(keys);
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const pct = ((passed / total) * 100).toFixed(1);

  console.log(`| # | Category | Raw | Expected | Actual | Cand # | Pass |`);
  console.log(`|---|----------|-----|----------|--------|--------|------|`);
  results.forEach((r, i) => {
    const raw = r.raw === null ? '(null)' : `\`${r.raw}\``;
    const exp = r.expected === null ? '(null)' : `\`${r.expected}\``;
    const act = r.actual === null ? '(null)' : `\`${r.actual}\``;
    const ci = r.candidateIndex === -1 ? '-' : String(r.candidateIndex);
    const mark = r.pass ? 'PASS' : 'FAIL';
    console.log(`| ${i + 1} | ${r.category} | ${raw} | ${exp} | ${act} | ${ci} | ${mark} |`);
  });

  console.log(`\nCoverage: ${passed}/${total} = ${pct}%\n`);

  if (passed < total) {
    console.log('MISSES:');
    results
      .filter((r) => !r.pass)
      .forEach((r) =>
        console.log(`  [${r.category}] raw=${r.raw} expected=${r.expected} actual=${r.actual}`),
      );
  }
}

// Only run if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
