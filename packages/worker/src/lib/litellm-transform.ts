// Shared LiteLLM-to-chinmeister transformation helpers.
//
// The same work happens in two environments:
//   1. Build time - scripts/fetch-pricing-seed.ts regenerates the committed
//      snapshot by running `npm run build:pricing-seed` under Node.
//   2. Runtime   - lib/refresh-model-prices.ts runs every 6h from the
//      scheduled Worker handler, refreshing DatabaseDO.model_prices.
//
// Both need to: skip sample_spec, filter by mode (chat/completion/responses),
// require nullish (not falsy) cost fields so free-tier models with zero
// prices are kept, and normalize prices from per-token to per-1M-tokens.
// This module is the single source of truth for that logic so the two paths
// can't drift.
//
// The module is pure TypeScript with no Worker-specific APIs, so the Node
// build script can import it via relative path without pulling in the whole
// worker runtime.

export interface LiteLLMEntry {
  mode?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_creation_input_token_cost?: number;
  cache_read_input_token_cost?: number;
  input_cost_per_token_above_200k_tokens?: number;
  output_cost_per_token_above_200k_tokens?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  [k: string]: unknown;
}

/**
 * The canonical per-1M-token row both the bundled seed and the DO upsert
 * consume. Prices are in USD per 1M tokens. Cache fields are nullable because
 * not every model supports prompt caching, and `raw` stores the full LiteLLM
 * entry as JSON so future tiers (above_500k, audio, image) can be read
 * without another schema migration.
 */
export interface NormalizedModelPrice {
  canonical_name: string;
  input_per_1m: number;
  output_per_1m: number;
  cache_creation_per_1m: number | null;
  cache_read_per_1m: number | null;
  input_per_1m_above_200k: number | null;
  output_per_1m_above_200k: number | null;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  raw: string | null;
}

// Modes we KEEP. Everything else (image, embedding, audio_*, rerank,
// moderation) prices on different units and doesn't belong in a text-token
// pricing table.
export const ALLOWED_MODES = new Set(['chat', 'completion', 'responses']);

export const PER_1M = 1_000_000;

export function perMillion(value: number | undefined | null): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value * PER_1M;
}

/**
 * Decide whether a LiteLLM entry is a text-token-priced model we want to
 * store. Nullish (not falsy) check so free-tier models with
 * `input_cost_per_token: 0` are kept - this was the CodeBurn bug that
 * dropped legitimate zero-priced models (see models.ts:58 in that repo).
 */
export function isTextTokenModel(name: string, entry: LiteLLMEntry): boolean {
  if (name === 'sample_spec') return false;
  if (typeof entry !== 'object' || entry == null) return false;
  if (entry.input_cost_per_token == null) return false;
  if (entry.output_cost_per_token == null) return false;
  if (entry.mode != null && !ALLOWED_MODES.has(entry.mode)) return false;
  return true;
}

/**
 * Convert one LiteLLM entry into the normalized row shape. Assumes
 * isTextTokenModel has already passed - the function itself doesn't guard
 * against missing required fields because the caller is expected to filter
 * first.
 */
export function transformLiteLLMEntry(name: string, entry: LiteLLMEntry): NormalizedModelPrice {
  return {
    canonical_name: name,
    input_per_1m: perMillion(entry.input_cost_per_token) ?? 0,
    output_per_1m: perMillion(entry.output_cost_per_token) ?? 0,
    cache_creation_per_1m: perMillion(entry.cache_creation_input_token_cost),
    cache_read_per_1m: perMillion(entry.cache_read_input_token_cost),
    input_per_1m_above_200k: perMillion(entry.input_cost_per_token_above_200k_tokens),
    output_per_1m_above_200k: perMillion(entry.output_cost_per_token_above_200k_tokens),
    max_input_tokens: entry.max_input_tokens ?? null,
    max_output_tokens: entry.max_output_tokens ?? null,
    raw: JSON.stringify(entry),
  };
}
