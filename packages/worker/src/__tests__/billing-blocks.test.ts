import { describe, it, expect } from 'vitest';
import {
  identifyBillingBlocks,
  calculateBurnRate,
  projectActiveBlock,
  summarizeBillingBlocks,
  DEFAULT_SESSION_DURATION_HOURS,
} from '../dos/team/analytics/billing-blocks.js';

/**
 * Helper: build a BillingEvent from an ISO timestamp and a token count.
 * Everything not set defaults to zero so callers only specify what the
 * test actually cares about.
 */
function ev(
  iso: string,
  {
    input = 0,
    output = 0,
    cacheRead = 0,
    cacheCreate = 0,
    model = 'claude-sonnet-4-6',
    cost = null as number | null,
  }: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheCreate?: number;
    model?: string;
    cost?: number | null;
  } = {},
) {
  return {
    timestamp_ms: new Date(iso).getTime(),
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_creation_tokens: cacheCreate,
    model,
    cost_usd: cost,
  };
}

describe('identifyBillingBlocks', () => {
  it('returns empty for zero events', () => {
    expect(identifyBillingBlocks([])).toEqual([]);
  });

  it('groups entries within a 5-hour window into one block', () => {
    const now = new Date('2026-04-19T12:00:00Z').getTime();
    const events = [
      ev('2026-04-19T08:10:00Z', { input: 100, output: 50 }),
      ev('2026-04-19T09:30:00Z', { input: 200, output: 100 }),
      ev('2026-04-19T11:45:00Z', { input: 50, output: 25 }),
    ];
    const blocks = identifyBillingBlocks(events, { nowMs: now });
    expect(blocks).toHaveLength(1);
    const [b] = blocks;
    // Start time should be floored to 08:00 (the hour of the first event)
    expect(b.start_time).toBe('2026-04-19T08:00:00.000Z');
    expect(b.end_time).toBe('2026-04-19T13:00:00.000Z');
    expect(b.is_gap).toBe(false);
    expect(b.event_count).toBe(3);
    expect(b.tokens.input_tokens).toBe(350);
    expect(b.tokens.output_tokens).toBe(175);
  });

  it('opens a new block when the gap since last event exceeds 5h, with a gap block between', () => {
    const events = [
      ev('2026-04-19T08:00:00Z', { input: 100 }),
      // 6h gap — should emit real block + gap block + new real block
      ev('2026-04-19T14:15:00Z', { input: 50 }),
    ];
    const blocks = identifyBillingBlocks(events, {
      nowMs: new Date('2026-04-19T15:00:00Z').getTime(),
    });
    expect(blocks).toHaveLength(3);
    expect(blocks[0].is_gap).toBe(false);
    expect(blocks[1].is_gap).toBe(true);
    expect(blocks[1].event_count).toBe(0);
    expect(blocks[2].is_gap).toBe(false);
    expect(blocks[2].start_time).toBe('2026-04-19T14:00:00.000Z'); // floored to hour
  });

  it('does not emit a gap block for gaps smaller than the session duration', () => {
    // Gap of 4.5h — under 5h threshold — should NOT trigger a gap block
    // but SHOULD split the window if the block has been open > 5h.
    const events = [
      ev('2026-04-19T08:00:00Z', { input: 100 }),
      ev('2026-04-19T12:30:00Z', { input: 50 }),
    ];
    const blocks = identifyBillingBlocks(events, {
      nowMs: new Date('2026-04-19T13:00:00Z').getTime(),
    });
    // Both events fall inside a single 5h block (block starts 08:00, ends 13:00)
    expect(blocks).toHaveLength(1);
    expect(blocks[0].event_count).toBe(2);
  });

  it('flags the most-recent block as active when now is inside the window AND activity is recent', () => {
    const now = new Date('2026-04-19T10:00:00Z').getTime();
    const events = [ev('2026-04-19T09:00:00Z', { input: 10 })];
    const blocks = identifyBillingBlocks(events, { nowMs: now });
    expect(blocks[0].is_active).toBe(true);
  });

  it('marks a block inactive when the last activity was more than 5h ago', () => {
    const now = new Date('2026-04-19T20:00:00Z').getTime();
    const events = [ev('2026-04-19T08:00:00Z', { input: 10 })];
    const blocks = identifyBillingBlocks(events, { nowMs: now });
    expect(blocks[0].is_active).toBe(false);
  });

  it('preserves unique models in order of first appearance, dedup-aware', () => {
    const events = [
      ev('2026-04-19T08:00:00Z', { input: 10, model: 'claude-opus-4-6' }),
      ev('2026-04-19T08:30:00Z', { input: 10, model: 'claude-sonnet-4-6' }),
      ev('2026-04-19T09:00:00Z', { input: 10, model: 'claude-opus-4-6' }),
    ];
    const [block] = identifyBillingBlocks(events, {
      nowMs: new Date('2026-04-19T10:00:00Z').getTime(),
    });
    expect(block.models).toEqual(['claude-opus-4-6', 'claude-sonnet-4-6']);
  });

  it('aggregates pre-calculated cost_usd across events (Aider/Cline-style sources)', () => {
    const events = [
      ev('2026-04-19T08:00:00Z', { cost: 0.12 }),
      ev('2026-04-19T09:00:00Z', { cost: 0.34 }),
      // Null cost is ignored, not treated as 0 (no accidental floor to 0.46)
      ev('2026-04-19T10:00:00Z', { cost: null }),
    ];
    const [block] = identifyBillingBlocks(events, {
      nowMs: new Date('2026-04-19T11:00:00Z').getTime(),
    });
    expect(block.cost_usd).toBeCloseTo(0.46, 6);
  });

  it('sorts unsorted input before grouping (defensive against arbitrary caller order)', () => {
    const blocks = identifyBillingBlocks(
      [
        ev('2026-04-19T10:00:00Z', { input: 30 }),
        ev('2026-04-19T08:00:00Z', { input: 10 }),
        ev('2026-04-19T09:00:00Z', { input: 20 }),
      ],
      { nowMs: new Date('2026-04-19T11:00:00Z').getTime() },
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].start_time).toBe('2026-04-19T08:00:00.000Z');
    expect(blocks[0].tokens.input_tokens).toBe(60);
  });
});

describe('calculateBurnRate', () => {
  const now = new Date('2026-04-19T12:00:00Z').getTime();

  it('returns null for gap blocks', () => {
    const events = [
      ev('2026-04-19T00:00:00Z', { input: 1 }),
      ev('2026-04-19T10:00:00Z', { input: 1 }),
    ];
    const blocks = identifyBillingBlocks(events, { nowMs: now });
    const gap = blocks.find((b) => b.is_gap);
    expect(calculateBurnRate(gap, [])).toBeNull();
  });

  it('returns null when the block events all share a timestamp (divide-by-zero guard)', () => {
    const sameTs = [
      ev('2026-04-19T10:00:00Z', { input: 100 }),
      ev('2026-04-19T10:00:00Z', { input: 200 }),
    ];
    const [block] = identifyBillingBlocks(sameTs, { nowMs: now });
    expect(calculateBurnRate(block, sameTs)).toBeNull();
  });

  it('reports a separate non-cache rate that excludes cache_read dominance', () => {
    // 60 minutes between first and last event
    const events = [
      ev('2026-04-19T10:00:00Z', { input: 100, output: 50, cacheRead: 9000 }),
      ev('2026-04-19T11:00:00Z', { input: 100, output: 50, cacheRead: 9000 }),
    ];
    const [block] = identifyBillingBlocks(events, {
      nowMs: new Date('2026-04-19T11:30:00Z').getTime(),
    });
    const rate = calculateBurnRate(block, events);
    expect(rate).not.toBeNull();
    // Gross = (200+100+18000) / 60 = 305
    expect(rate.tokens_per_minute).toBeCloseTo(305, 6);
    // Non-cache = (200+100) / 60 = 5
    expect(rate.tokens_per_minute_non_cache).toBeCloseTo(5, 6);
  });
});

describe('projectActiveBlock', () => {
  it('returns null for inactive blocks', () => {
    const now = new Date('2026-04-19T20:00:00Z').getTime();
    const events = [ev('2026-04-19T08:00:00Z', { input: 10 })];
    const [block] = identifyBillingBlocks(events, { nowMs: now });
    expect(block.is_active).toBe(false);
    expect(projectActiveBlock(block, events, now)).toBeNull();
  });

  it('projects additional tokens and cost from the current burn rate', () => {
    // Block at 08:00 covers 08:00–13:00. Two events an hour apart in the
    // first two hours mean 2 hours of burn observed; 3 hours remain.
    const events = [
      ev('2026-04-19T08:00:00Z', { input: 600, output: 300, cost: 0.1 }),
      ev('2026-04-19T10:00:00Z', { input: 600, output: 300, cost: 0.1 }),
    ];
    const now = new Date('2026-04-19T10:00:00Z').getTime();
    const [block] = identifyBillingBlocks(events, { nowMs: now });
    const projection = projectActiveBlock(block, events, now);
    expect(projection).not.toBeNull();
    expect(projection.remaining_minutes).toBe(180); // 13:00 - 10:00
    // Burn = 1800 tokens over 120 minutes = 15/min. 180 more mins = 2700
    // additional. Current total = 1800. Projected = 4500.
    expect(projection.projected_tokens).toBe(4500);
    // Cost burn = 0.2 USD / 120 min = 0.00167/min * 180 = 0.30 additional.
    // Current = 0.2. Projected = 0.5.
    expect(projection.projected_cost).toBeCloseTo(0.5, 2);
  });
});

describe('summarizeBillingBlocks', () => {
  it('exposes session_duration_hours so clients do not have to hard-code 5', () => {
    const summary = summarizeBillingBlocks([]);
    expect(summary.session_duration_hours).toBe(DEFAULT_SESSION_DURATION_HOURS);
    expect(summary.blocks).toEqual([]);
    expect(summary.active).toBeNull();
    expect(summary.burn_rate).toBeNull();
    expect(summary.projection).toBeNull();
  });

  it('picks the live block and computes burn + projection in one shot', () => {
    const now = new Date('2026-04-19T11:00:00Z').getTime();
    const events = [
      ev('2026-04-19T09:00:00Z', { input: 100, output: 50, cost: 0.05 }),
      ev('2026-04-19T10:00:00Z', { input: 200, output: 100, cost: 0.15 }),
    ];
    const summary = summarizeBillingBlocks(events, { nowMs: now });
    expect(summary.active).not.toBeNull();
    expect(summary.active.event_count).toBe(2);
    expect(summary.burn_rate).not.toBeNull();
    expect(summary.projection).not.toBeNull();
  });

  it('returns null projection for inactive-only histories', () => {
    // All events in the distant past — no active block
    const now = new Date('2026-04-19T20:00:00Z').getTime();
    const events = [ev('2026-04-18T08:00:00Z', { input: 10 })];
    const summary = summarizeBillingBlocks(events, { nowMs: now });
    expect(summary.active).toBeNull();
    expect(summary.burn_rate).toBeNull();
    expect(summary.projection).toBeNull();
    expect(summary.blocks).toHaveLength(1);
    expect(summary.blocks[0].is_active).toBe(false);
  });

  it('allows overriding sessionDurationHours for experimentation', () => {
    // A 1-hour window splits two events 90 minutes apart into two blocks
    const events = [
      ev('2026-04-19T08:00:00Z', { input: 10 }),
      ev('2026-04-19T09:30:00Z', { input: 20 }),
    ];
    const { blocks, session_duration_hours } = summarizeBillingBlocks(events, {
      nowMs: new Date('2026-04-19T10:00:00Z').getTime(),
      sessionDurationHours: 1,
    });
    expect(session_duration_hours).toBe(1);
    // Two blocks + a gap block (gap > 1h window)
    expect(blocks.filter((b) => !b.is_gap)).toHaveLength(2);
  });
});
