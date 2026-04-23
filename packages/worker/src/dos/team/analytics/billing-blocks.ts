// Anthropic 5-hour billing-window blocks. Ported from ccusage
// `_session-blocks.ts` (MIT) into chinmeister's snake_case contract shape
// and Durable Object query path.
//
// Motivation: Anthropic Pro's rate-limit window is 5 hours from the
// first prompt. Chinmeister's daily token aggregates can't answer "how much
// of my current window have I burned, and when does it reset?" — the
// question a Pro user hits two hours into a heavy refactor. This module
// groups token-bearing conversation events into 5-hour blocks, flags
// the active one, and projects where the burn rate is heading.
//
// The algorithm is a pure function so it's cheap to unit-test against
// scripted event sequences. The DO query (see `getBillingBlocks` below)
// is the only IO-aware part.

import type {
  BillingBlocksResult,
  BurnRate,
  SessionBlock,
  TokenCounts,
} from '@chinmeister/shared/contracts/billing-blocks.js';

export const DEFAULT_SESSION_DURATION_HOURS = 5;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

/**
 * One token-bearing event ingested into the block grouper. The DO query
 * projects `conversation_events` assistant rows with token data into this
 * shape; the algorithm is storage-agnostic.
 */
export interface BillingEvent {
  timestamp_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  model: string | null;
  /** Pre-computed USD cost if available (Aider, Cline). Null = derive later. */
  cost_usd: number | null;
}

/** Convert an ISO timestamp string to wall-clock ms, or null on parse failure. */
export function parseTimestamp(iso: string): number | null {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Floor a wall-clock ms value to the start of its UTC hour. */
function floorToHour(timestampMs: number): number {
  const d = new Date(timestampMs);
  d.setUTCMinutes(0, 0, 0);
  return d.getTime();
}

function emptyTokens(): TokenCounts {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };
}

function totalTokens(t: TokenCounts): number {
  return t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_creation_tokens;
}

function uniquePreserveOrder(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * Group `events` into billing blocks. New block starts when the block has
 * been open for more than `sessionDurationHours`, or when the gap since
 * the last entry exceeds that window (which also inserts a gap-block for
 * the idle period). Active-block detection is derived from `nowMs`.
 *
 * Events must be pre-sorted oldest-first; callers can pass unsorted data
 * and rely on the internal sort, but the SQL path already orders by
 * created_at so the sort is usually a no-op.
 */
export function identifyBillingBlocks(
  events: BillingEvent[],
  options: { sessionDurationHours?: number; nowMs?: number } = {},
): SessionBlock[] {
  if (events.length === 0) return [];

  const durationHours = options.sessionDurationHours ?? DEFAULT_SESSION_DURATION_HOURS;
  const durationMs = durationHours * MS_PER_HOUR;
  const nowMs = options.nowMs ?? Date.now();

  // Defensive sort. SQL callers already ORDER BY timestamp, but the
  // algorithm is also used by direct unit tests that pass hand-crafted
  // arrays in arbitrary order.
  const sorted = [...events].sort((a, b) => a.timestamp_ms - b.timestamp_ms);

  const blocks: SessionBlock[] = [];
  let blockStartMs: number | null = null;
  let blockEvents: BillingEvent[] = [];

  for (const ev of sorted) {
    if (blockStartMs === null) {
      blockStartMs = floorToHour(ev.timestamp_ms);
      blockEvents = [ev];
      continue;
    }

    const sinceBlockStart = ev.timestamp_ms - blockStartMs;
    const lastEvent = blockEvents[blockEvents.length - 1];
    // Invariant: blockEvents is non-empty whenever blockStartMs is set.
    // Guard defensively anyway so a type-narrowing change can't silently
    // blow up the algorithm.
    if (!lastEvent) {
      blockStartMs = floorToHour(ev.timestamp_ms);
      blockEvents = [ev];
      continue;
    }
    const sinceLastEvent = ev.timestamp_ms - lastEvent.timestamp_ms;

    if (sinceBlockStart > durationMs || sinceLastEvent > durationMs) {
      // Seal the current block.
      blocks.push(buildBlock(blockStartMs, blockEvents, nowMs, durationMs));

      // If the gap itself was longer than a window, emit a gap block so
      // the UI can render idle periods honestly instead of implying
      // continuous usage.
      if (sinceLastEvent > durationMs) {
        const gap = buildGapBlock(lastEvent.timestamp_ms, ev.timestamp_ms, durationMs);
        if (gap) blocks.push(gap);
      }

      blockStartMs = floorToHour(ev.timestamp_ms);
      blockEvents = [ev];
    } else {
      blockEvents.push(ev);
    }
  }

  if (blockStartMs !== null && blockEvents.length > 0) {
    blocks.push(buildBlock(blockStartMs, blockEvents, nowMs, durationMs));
  }

  return blocks;
}

function buildBlock(
  startMs: number,
  events: BillingEvent[],
  nowMs: number,
  durationMs: number,
): SessionBlock {
  const endMs = startMs + durationMs;
  const lastEvent = events[events.length - 1];
  const actualEndMs = lastEvent ? lastEvent.timestamp_ms : startMs;
  // "Active" = the current wall-clock time still falls inside the window
  // AND there was activity within the last `durationMs`. The second check
  // means a block that saw its last prompt 6h ago isn't active even if
  // wall-clock time is still inside the nominal window somehow.
  const isActive = nowMs - actualEndMs < durationMs && nowMs < endMs;

  const tokens = emptyTokens();
  let costUsd = 0;
  const models: string[] = [];
  for (const ev of events) {
    tokens.input_tokens += ev.input_tokens;
    tokens.output_tokens += ev.output_tokens;
    tokens.cache_read_tokens += ev.cache_read_tokens;
    tokens.cache_creation_tokens += ev.cache_creation_tokens;
    if (ev.cost_usd != null) costUsd += ev.cost_usd;
    if (ev.model) models.push(ev.model);
  }

  return {
    id: new Date(startMs).toISOString(),
    start_time: new Date(startMs).toISOString(),
    end_time: new Date(endMs).toISOString(),
    actual_end_time: new Date(actualEndMs).toISOString(),
    is_active: isActive,
    is_gap: false,
    event_count: events.length,
    tokens,
    cost_usd: costUsd,
    models: uniquePreserveOrder(models),
  };
}

function buildGapBlock(
  lastActivityMs: number,
  nextActivityMs: number,
  durationMs: number,
): SessionBlock | null {
  const gapMs = nextActivityMs - lastActivityMs;
  if (gapMs <= durationMs) return null;

  const gapStartMs = lastActivityMs + durationMs;
  return {
    id: `gap-${new Date(gapStartMs).toISOString()}`,
    start_time: new Date(gapStartMs).toISOString(),
    end_time: new Date(nextActivityMs).toISOString(),
    actual_end_time: null,
    is_active: false,
    is_gap: true,
    event_count: 0,
    tokens: emptyTokens(),
    cost_usd: 0,
    models: [],
  };
}

/**
 * Derive the burn rate of a block. Returns null for gap blocks, blocks
 * with no events, and blocks whose events all share the same timestamp
 * (divide-by-zero guard).
 *
 * `tokens_per_minute_non_cache` is a separate figure because the
 * cached-read token count can dominate total tokens on a warmed cache
 * and hide real throughput — the UI uses this narrower figure for
 * "HIGH/MODERATE/NORMAL" indicators while `tokens_per_minute` is the
 * honest gross rate.
 */
export function calculateBurnRate(block: SessionBlock, events: BillingEvent[]): BurnRate | null {
  if (block.is_gap || events.length === 0) return null;
  const first = events[0];
  const last = events[events.length - 1];
  if (!first || !last) return null;
  const durationMinutes = (last.timestamp_ms - first.timestamp_ms) / MS_PER_MINUTE;
  if (durationMinutes <= 0) return null;

  const total = totalTokens(block.tokens);
  const nonCache = block.tokens.input_tokens + block.tokens.output_tokens;
  return {
    tokens_per_minute: total / durationMinutes,
    tokens_per_minute_non_cache: nonCache / durationMinutes,
    cost_per_hour: (block.cost_usd / durationMinutes) * 60,
  };
}

/**
 * Project where the active block will land if the current burn rate
 * continues. Returns null unless the block is active and has a defined
 * burn rate.
 */
export function projectActiveBlock(
  block: SessionBlock,
  events: BillingEvent[],
  nowMs: number,
): BillingBlocksResult['projection'] {
  if (!block.is_active) return null;
  const burn = calculateBurnRate(block, events);
  if (!burn) return null;

  const endMs = new Date(block.end_time).getTime();
  const remainingMinutes = Math.max(0, (endMs - nowMs) / MS_PER_MINUTE);
  const currentTokens = totalTokens(block.tokens);
  const projectedTokens = currentTokens + burn.tokens_per_minute * remainingMinutes;
  const projectedAdditionalCost = (burn.cost_per_hour / 60) * remainingMinutes;

  return {
    projected_tokens: Math.round(projectedTokens),
    projected_cost: Math.round((block.cost_usd + projectedAdditionalCost) * 100) / 100,
    remaining_minutes: Math.round(remainingMinutes),
  };
}

/**
 * Scan conversation_events for a given owner and return billing blocks.
 * Scopes by joining to `members.owner_id` so the result covers every
 * session the caller ran inside this team, not just one agent's.
 *
 * A 30-day lookback is hard-coded (the same "recent" horizon as every
 * other chinmeister analytics query). Active-block detection only cares
 * about wall-clock proximity to `now`, so an older horizon would just
 * add dead history without changing the live answer.
 *
 * Only assistant messages with token data participate — user messages
 * don't carry token usage, and assistant messages without tokens (e.g.
 * an early-exit stop_reason) don't move the billing window.
 */
export function getBillingBlocksForOwner(
  sql: SqlStorage,
  ownerId: string,
  options: { sessionDurationHours?: number; nowMs?: number; lookbackDays?: number } = {},
): BillingBlocksResult {
  const lookbackDays = options.lookbackDays ?? 30;
  const rows = sql
    .exec(
      `SELECT ce.created_at, ce.input_tokens, ce.output_tokens,
              ce.cache_read_tokens, ce.cache_creation_tokens, ce.model
       FROM conversation_events ce
       JOIN members m ON m.agent_id = ce.agent_id
       WHERE m.owner_id = ?
         AND ce.role = 'assistant'
         AND ce.created_at > datetime('now', '-' || ? || ' days')
         AND (ce.input_tokens IS NOT NULL OR ce.output_tokens IS NOT NULL)
       ORDER BY ce.created_at ASC`,
      ownerId,
      lookbackDays,
    )
    .toArray() as Array<{
    created_at: string;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    cache_creation_tokens: number | null;
    model: string | null;
  }>;

  const events: BillingEvent[] = [];
  for (const r of rows) {
    // SQLite's `datetime('now')` string is "YYYY-MM-DD HH:MM:SS" (UTC,
    // no offset). `new Date(...)` parses that as local time on some
    // runtimes — the Workers runtime happens to be UTC so this is OK,
    // but keep the explicit Z-append in mind if we ever move to a
    // non-UTC runtime.
    const ts = parseTimestamp(
      r.created_at.includes('T') ? r.created_at : r.created_at.replace(' ', 'T') + 'Z',
    );
    if (ts === null) continue;
    events.push({
      timestamp_ms: ts,
      input_tokens: r.input_tokens ?? 0,
      output_tokens: r.output_tokens ?? 0,
      cache_read_tokens: r.cache_read_tokens ?? 0,
      cache_creation_tokens: r.cache_creation_tokens ?? 0,
      model: r.model,
      // Per-message cost is not stored; derivation happens in the
      // pricing-enrichment pass at the route layer if the caller wants
      // dollar figures. Leaving null means cost_usd on each block will
      // be 0; clients with pricing data can overlay their own cost calc.
      cost_usd: null,
    });
  }

  return summarizeBillingBlocks(events, options);
}

/**
 * One-shot wrapper: run the grouper, pick the active block, compute
 * burn rate + projection. The shape callers actually want to render.
 *
 * `activeEvents` is the subset of `events` that fell into the active
 * block; we re-pass it to the burn/project helpers so they don't have
 * to re-partition. The grouper exposes enough state for that to be
 * trivial — see the DO call-site.
 */
export function summarizeBillingBlocks(
  events: BillingEvent[],
  options: { sessionDurationHours?: number; nowMs?: number } = {},
): BillingBlocksResult {
  const blocks = identifyBillingBlocks(events, options);
  const active = blocks.find((b) => b.is_active) ?? null;
  const sessionDurationHours = options.sessionDurationHours ?? DEFAULT_SESSION_DURATION_HOURS;
  const nowMs = options.nowMs ?? Date.now();

  let burnRate: BurnRate | null = null;
  let projection: BillingBlocksResult['projection'] = null;
  if (active) {
    const windowStartMs = new Date(active.start_time).getTime();
    const windowEndMs = new Date(active.end_time).getTime();
    // Re-partition events to find the ones inside the active block.
    // O(n) worst case over the full event list; n is small (bounded by
    // the number of token-bearing events the user generated across all
    // their sessions in the recent lookback window).
    const activeEvents = events.filter(
      (e) => e.timestamp_ms >= windowStartMs && e.timestamp_ms < windowEndMs,
    );
    burnRate = calculateBurnRate(active, activeEvents);
    projection = projectActiveBlock(active, activeEvents, nowMs);
  }

  return {
    blocks,
    active,
    burn_rate: burnRate,
    projection,
    session_duration_hours: sessionDurationHours,
  };
}
