// Integration test for the full cost enrichment pipeline.
//
// Mocks only the pricing cache (otherwise it hits a real DatabaseDO).
// Exercises the same control flow the team DO runs on every analytics
// request: queryTokenAggregateForWindow output → enrichAnalyticsWithPricing
// → enrichPeriodComparisonCost → verify period_comparison carries the
// cost delta the renderer reads.
//
// Focused on the handoff between layers rather than the math - the pure
// math is covered in pricing-enrich.test.ts. If this file goes red while
// pricing-enrich stays green, the bug is in plumbing, not arithmetic.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

import type { PricingSnapshot } from '../lib/pricing-cache.js';

// Mock the pricing cache BEFORE importing modules that call getPricingCache.
// Returning from a closure lets each test swap in its own snapshot.
let mockSnapshot: PricingSnapshot;
vi.mock('../lib/pricing-cache.js', () => ({
  getPricingCache: vi.fn(async () => mockSnapshot),
}));

import {
  enrichAnalyticsWithPricing,
  enrichPeriodComparisonCost,
  type WindowTokenAggregate,
} from '../lib/pricing-enrich.js';
import type { NormalizedModelPrice } from '../lib/litellm-transform.js';
import type { Env } from '../types.js';

const SONNET_ROW: NormalizedModelPrice = {
  canonical_name: 'claude-sonnet-4-5-20250929',
  input_per_1m: 3,
  output_per_1m: 15,
  cache_creation_per_1m: 3.75,
  cache_read_per_1m: 0.3,
  input_per_1m_above_200k: 6,
  output_per_1m_above_200k: 22.5,
  max_input_tokens: 200000,
  max_output_tokens: 64000,
  raw: null,
};

function makeSnapshot(opts: { isStale?: boolean }): PricingSnapshot {
  const byName = new Map<string, NormalizedModelPrice>();
  byName.set(SONNET_ROW.canonical_name, SONNET_ROW);
  return {
    byName,
    fetchedAt: new Date().toISOString(),
    isStale: opts.isStale ?? false,
    modelsCount: 1,
    loadedAt: Date.now(),
  };
}

// A realistic analytics payload shaped like what getExtendedAnalyticsFn
// produces: token_usage before enrichment (null cost, 0 placeholder) plus
// period_comparison with both current and previous populated from the
// comparison.ts SQL. Only the fields exercised here are filled in.
function makeAnalytics() {
  return {
    token_usage: {
      total_input_tokens: 150_000,
      total_output_tokens: 50_000,
      total_cache_read_tokens: 0,
      total_cache_creation_tokens: 0,
      avg_input_per_session: 15_000,
      avg_output_per_session: 5_000,
      sessions_with_token_data: 10,
      sessions_without_token_data: 0,
      total_edits_in_token_sessions: 100,
      total_estimated_cost_usd: null as number | null,
      pricing_refreshed_at: null as string | null,
      pricing_is_stale: false,
      models_without_pricing: [] as string[],
      models_without_pricing_total: 0,
      cost_per_edit: null as number | null,
      cache_hit_rate: null as number | null,
      by_model: [
        {
          agent_model: 'claude-sonnet-4-5-20250929',
          input_tokens: 150_000,
          output_tokens: 50_000,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          sessions: 10,
          estimated_cost_usd: null as number | null,
        },
      ],
      by_tool: [],
    },
    period_comparison: {
      current: {
        completion_rate: 70,
        avg_duration_min: 24,
        stuckness_rate: 10,
        memory_hit_rate: 60,
        edit_velocity: 2.8,
        total_sessions: 10,
        total_estimated_cost_usd: null as number | null,
        total_edits_in_token_sessions: 0,
        cost_per_edit: null as number | null,
      },
      previous: {
        completion_rate: 64,
        avg_duration_min: 27,
        stuckness_rate: 18,
        memory_hit_rate: 58,
        edit_velocity: 2.4,
        total_sessions: 8,
        total_estimated_cost_usd: null as number | null,
        total_edits_in_token_sessions: 0,
        cost_per_edit: null as number | null,
      },
    },
  };
}

const mockEnv = {} as Env;

describe('pricing enrichment - integration (team DO pipeline shape)', () => {
  beforeEach(() => {
    mockSnapshot = makeSnapshot({});
  });

  it('end-to-end: current + previous window produce a cost_per_edit delta on 7-day-style payload', async () => {
    const analytics = makeAnalytics();

    // Stage 1: main token_usage enrichment (what dos/team/index.ts runs
    // first on every extended analytics response).
    await enrichAnalyticsWithPricing(analytics, mockEnv);

    // 150k input * $3/1M = $0.45 + 50k output * $15/1M = $0.75 → $1.20.
    // Rounded to 2 decimals. cost_per_edit = 1.20 / 100 edits = $0.012.
    expect(analytics.token_usage.total_estimated_cost_usd).toBe(1.2);
    expect(analytics.token_usage.cost_per_edit).toBe(0.012);
    expect(analytics.token_usage.pricing_is_stale).toBe(false);
    expect(analytics.token_usage.by_model[0].estimated_cost_usd).toBe(1.2);

    // Stage 2: period-comparison cost enrichment (new this chat).
    // The DO passes the windowed aggregates that queryTokenAggregateForWindow
    // returned - current matches the main token_usage window, previous is
    // the N-days-before-that window.
    const currentAgg: WindowTokenAggregate = {
      by_model: [
        {
          agent_model: 'claude-sonnet-4-5-20250929',
          input_tokens: 150_000,
          output_tokens: 50_000,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
        },
      ],
      total_edits_in_token_sessions: 100,
    };
    const previousAgg: WindowTokenAggregate = {
      by_model: [
        {
          agent_model: 'claude-sonnet-4-5-20250929',
          input_tokens: 120_000,
          output_tokens: 40_000,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
        },
      ],
      total_edits_in_token_sessions: 80,
    };

    await enrichPeriodComparisonCost(analytics, currentAgg, previousAgg, mockEnv);

    // Current period: matches the main token_usage - same aggregate, same
    // snapshot, same arithmetic.
    expect(analytics.period_comparison.current.cost_per_edit).toBe(0.012);
    expect(analytics.period_comparison.current.total_estimated_cost_usd).toBe(1.2);
    expect(analytics.period_comparison.current.total_edits_in_token_sessions).toBe(100);

    // Previous period: 120k * $3/1M = $0.36 + 40k * $15/1M = $0.60 → $0.96.
    // 80 edits → cost_per_edit = 0.96 / 80 = $0.012. Same as current
    // (stable per-edit cost across the windows even though absolute spend
    // differs). Verifies the window-scoping actually picked up the previous
    // aggregate rather than reusing the current one.
    expect(analytics.period_comparison.previous!.cost_per_edit).toBe(0.012);
    expect(analytics.period_comparison.previous!.total_estimated_cost_usd).toBe(0.96);
    expect(analytics.period_comparison.previous!.total_edits_in_token_sessions).toBe(80);
  });

  it('stale pricing nulls cost everywhere: token_usage AND period_comparison', async () => {
    mockSnapshot = makeSnapshot({ isStale: true });
    const analytics = makeAnalytics();

    await enrichAnalyticsWithPricing(analytics, mockEnv);
    expect(analytics.token_usage.total_estimated_cost_usd).toBeNull();
    expect(analytics.token_usage.cost_per_edit).toBeNull();
    expect(analytics.token_usage.pricing_is_stale).toBe(true);
    expect(analytics.token_usage.by_model[0].estimated_cost_usd).toBeNull();

    const agg: WindowTokenAggregate = {
      by_model: [
        {
          agent_model: 'claude-sonnet-4-5-20250929',
          input_tokens: 150_000,
          output_tokens: 50_000,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
        },
      ],
      total_edits_in_token_sessions: 100,
    };
    await enrichPeriodComparisonCost(analytics, agg, agg, mockEnv);

    // Both windows go null together - the UI can't show a stale-then-
    // mix-then-stale timeline; either the snapshot is fresh for both or
    // neither.
    expect(analytics.period_comparison.current.cost_per_edit).toBeNull();
    expect(analytics.period_comparison.current.total_estimated_cost_usd).toBeNull();
    expect(analytics.period_comparison.previous!.cost_per_edit).toBeNull();
    expect(analytics.period_comparison.previous!.total_estimated_cost_usd).toBeNull();
  });

  it('null previous aggregate: current fills, previous preserved at pre-enrichment null', async () => {
    const analytics = makeAnalytics();
    const currentAgg: WindowTokenAggregate = {
      by_model: [
        {
          agent_model: 'claude-sonnet-4-5-20250929',
          input_tokens: 150_000,
          output_tokens: 50_000,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
        },
      ],
      total_edits_in_token_sessions: 100,
    };

    // The 30-day retention case: comparison.ts returned previous but the
    // windowed aggregate query ran on sessions that don't exist, so
    // previousAgg is semantically "no data here" - we pass null.
    await enrichPeriodComparisonCost(analytics, currentAgg, null, mockEnv);

    expect(analytics.period_comparison.current.cost_per_edit).toBe(0.012);
    // Previous keeps whatever comparison.ts put there (here, null from
    // our fixture). The renderer's `pc.previous` truthiness gate
    // determines whether the delta renders.
    expect(analytics.period_comparison.previous!.cost_per_edit).toBeNull();
    expect(analytics.period_comparison.previous!.total_estimated_cost_usd).toBeNull();
  });

  it('no period_comparison on the analytics object: enrichment is a no-op (basic-analytics path)', async () => {
    // The non-extended getAnalytics variant returns a TeamAnalytics shape
    // with no period_comparison field. enrichPeriodComparisonCost must
    // not throw when called on it (we guard before calling in the DO,
    // but defense in depth).
    const basicAnalytics: { token_usage: { by_model: unknown[] } } = {
      token_usage: { by_model: [] },
    };
    const agg: WindowTokenAggregate = {
      by_model: [],
      total_edits_in_token_sessions: 0,
    };

    await expect(
      enrichPeriodComparisonCost(basicAnalytics, agg, agg, mockEnv),
    ).resolves.toBeDefined();
  });

  it('empty analytics (no token_usage): enrichAnalyticsWithPricing is a no-op', async () => {
    const empty = {};
    const result = await enrichAnalyticsWithPricing(empty, mockEnv);
    expect(result).toBe(empty);
  });
});
