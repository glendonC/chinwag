// Tests for the pure cost computation layer in pricing-enrich.ts.
//
// Focuses on `computeWindowCost` because that's the shared helper now
// driving both the main token_usage enrichment and the period-comparison
// enrichment. If this function is right, both callers are right.
//
// The four null causes documented on the `cost_per_edit` schema field
// are the load-bearing invariants - each gets its own test here so a
// future refactor can't silently break the contract.

import { describe, it, expect, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

import { computeWindowCost, type WindowTokenAggregate } from '../lib/pricing-enrich.js';
import type { PricingSnapshot } from '../lib/pricing-cache.js';
import type { NormalizedModelPrice } from '../lib/litellm-transform.js';

// Minimal Sonnet-shaped pricing row. Numbers chosen so 1M input + 1M output
// = $3 + $15 = $18 - round numbers for assertion readability.
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

function snapshot(opts: { isStale?: boolean; rows?: NormalizedModelPrice[] }): PricingSnapshot {
  const byName = new Map<string, NormalizedModelPrice>();
  for (const row of opts.rows ?? [SONNET_ROW]) {
    byName.set(row.canonical_name, row);
  }
  return {
    byName,
    fetchedAt: new Date().toISOString(),
    isStale: opts.isStale ?? false,
    modelsCount: byName.size,
    loadedAt: Date.now(),
  };
}

function agg(
  modelName: string,
  input: number,
  output: number,
  edits: number,
): WindowTokenAggregate {
  return {
    by_model: [
      {
        agent_model: modelName,
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
    ],
    total_edits_in_token_sessions: edits,
  };
}

describe('computeWindowCost - null-cause invariants', () => {
  // Each of the four reasons the schema doc-comment enumerates must
  // produce a null result. These are the contract boundary: future
  // refactors can change the math inside, but these four cases stay null.

  it('returns null cost_per_edit when the aggregate has no by_model rows', () => {
    const result = computeWindowCost(
      { by_model: [], total_edits_in_token_sessions: 42 },
      snapshot({}),
    );
    expect(result.total_estimated_cost_usd).toBeNull();
    expect(result.cost_per_edit).toBeNull();
  });

  it('returns null cost_per_edit when edits is zero (zero-denominator)', () => {
    const result = computeWindowCost(
      agg('claude-sonnet-4-5-20250929', 1_000_000, 500_000, 0),
      snapshot({}),
    );
    expect(result.total_estimated_cost_usd).not.toBeNull();
    expect(result.cost_per_edit).toBeNull();
  });

  it('returns null for everything when the pricing snapshot is stale', () => {
    const result = computeWindowCost(
      agg('claude-sonnet-4-5-20250929', 1_000_000, 500_000, 10),
      snapshot({ isStale: true }),
    );
    expect(result.total_estimated_cost_usd).toBeNull();
    expect(result.cost_per_edit).toBeNull();
    expect(result.models_without_pricing).toEqual([]);
    expect(result.models_without_pricing_total).toBe(0);
  });

  it('returns null when every model in the window is missing from pricing', () => {
    const result = computeWindowCost(
      agg('some-unknown-model-v99', 1_000_000, 500_000, 10),
      snapshot({}),
    );
    expect(result.total_estimated_cost_usd).toBeNull();
    expect(result.cost_per_edit).toBeNull();
    expect(result.models_without_pricing).toContain('some-unknown-model-v99');
    expect(result.models_without_pricing_total).toBe(1);
  });
});

describe('computeWindowCost - positive-case math', () => {
  // Token counts stay under 200k so estimateSessionCost stays on base rates.
  // Above-200k tiered pricing is exercised in model-pricing.test.ts already.

  it('computes cost_per_edit from sum(cost) / edits at 4-decimal precision', () => {
    // 100k input * $3/1M + 100k output * $15/1M = $0.30 + $1.50 = $1.80.
    // 60 edits → $0.03/edit.
    const result = computeWindowCost(
      agg('claude-sonnet-4-5-20250929', 100_000, 100_000, 60),
      snapshot({}),
    );
    expect(result.total_estimated_cost_usd).toBe(1.8);
    expect(result.cost_per_edit).toBe(0.03);
  });

  it('stores cost_per_edit at 4 decimals so sub-cent movements survive', () => {
    // 200k output * $15/1M = $3.00 (zero input keeps us off the 200k
    // tier - tiering is gated on totalInputVolume). 10000 edits →
    // $0.0003/edit exactly. 3-decimal rounding would collapse this to
    // $0.000 (lost); 4-decimal preserves $0.0003. That's the point of
    // storing 4 decimals - sub-cent movements exist in real data.
    const result = computeWindowCost(
      {
        by_model: [
          {
            agent_model: 'claude-sonnet-4-5-20250929',
            input_tokens: 0,
            output_tokens: 200_000,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
          },
        ],
        total_edits_in_token_sessions: 10_000,
      },
      snapshot({}),
    );
    expect(result.cost_per_edit).toBe(0.0003);
  });

  it('includes priced models and ignores unpriced models in the total', () => {
    const result = computeWindowCost(
      {
        by_model: [
          {
            agent_model: 'claude-sonnet-4-5-20250929',
            input_tokens: 100_000,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
          },
          {
            agent_model: 'some-unknown-model-v99',
            input_tokens: 200_000,
            output_tokens: 100_000,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
          },
        ],
        total_edits_in_token_sessions: 100,
      },
      snapshot({}),
    );
    // Only the sonnet row is priced: 100k input * $3/1M = $0.30.
    expect(result.total_estimated_cost_usd).toBe(0.3);
    expect(result.cost_per_edit).toBe(0.003);
    expect(result.models_without_pricing).toEqual(['some-unknown-model-v99']);
    expect(result.models_without_pricing_total).toBe(1);
  });
});
