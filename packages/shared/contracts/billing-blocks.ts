// Billing block contract - response shape for the 5-hour Anthropic
// rate-limit window endpoints. Ported from ccusage (_session-blocks.ts)
// into chinmeister's snake_case schema convention so it matches every other
// analytics payload.
//
// Clients render "3h 22m until reset · 64% tokens burned" from this
// payload; no additional aggregation on the web side.

export interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

/**
 * One billing block. For normal blocks, `end_time = start_time + 5h`.
 * For gap blocks (`is_gap: true`), `end_time` is the next activity's
 * timestamp - the UI should render these as "idle period, no tokens"
 * rather than as a regular usage window.
 */
export interface SessionBlock {
  id: string;
  start_time: string;
  end_time: string;
  /**
   * Timestamp of the last real event in the block. Null for gap blocks
   * (no events by definition).
   */
  actual_end_time: string | null;
  is_active: boolean;
  is_gap: boolean;
  event_count: number;
  tokens: TokenCounts;
  cost_usd: number;
  models: string[];
}

export interface BurnRate {
  /**
   * Gross throughput: every token type divided by event-span minutes.
   * Accurate but dominated by cache_read for warm-cache sessions.
   */
  tokens_per_minute: number;
  /**
   * Input + output only. Narrower figure for the HIGH/MODERATE/NORMAL
   * indicator - this is the number that reflects "real" work vs cache
   * replay.
   */
  tokens_per_minute_non_cache: number;
  cost_per_hour: number;
}

export interface ProjectedUsage {
  projected_tokens: number;
  projected_cost: number;
  remaining_minutes: number;
}

export interface BillingBlocksResult {
  /** Blocks sorted oldest → newest, including gap blocks inline. */
  blocks: SessionBlock[];
  /**
   * Same object (by reference equality) as the is_active entry in
   * `blocks`, or null when no block is currently live. Surfaced
   * separately so callers don't have to find() every render.
   */
  active: SessionBlock | null;
  /**
   * Burn rate of the active block. Null if no active block or if the
   * block's events all share the same timestamp (divide-by-zero guard).
   */
  burn_rate: BurnRate | null;
  /** Projected totals for the active block. Null if no active block. */
  projection: ProjectedUsage | null;
  /**
   * The session-duration constant used to produce this payload, echoed
   * back so clients don't have to hard-code "5". Defaults to 5 but can
   * be overridden via a query-string knob in the future.
   */
  session_duration_hours: number;
}
