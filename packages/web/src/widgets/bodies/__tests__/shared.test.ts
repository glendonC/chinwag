import { describe, it, expect } from 'vitest';
import { hasCostData, costEmptyReason } from '../shared.js';

// Minimal token_usage fixture — the reliability helpers consume a structural
// subset of TokenUsageStats, so tests don't need to fill unrelated fields.
function tu(overrides: Partial<Parameters<typeof hasCostData>[0]> = {}) {
  return {
    sessions_with_token_data: 5,
    pricing_is_stale: false,
    models_without_pricing: [],
    models_without_pricing_total: 0,
    by_model: [{ agent_model: 'claude-sonnet-4-5-20250514' }],
    ...overrides,
  };
}

describe('hasCostData', () => {
  it('is true for the healthy path', () => {
    expect(hasCostData(tu())).toBe(true);
  });

  it('is false when no sessions reported token data', () => {
    expect(hasCostData(tu({ sessions_with_token_data: 0 }))).toBe(false);
  });

  it('is false when pricing snapshot is stale', () => {
    // pricing-enrich.ts zeroes total_estimated_cost_usd in this state; the
    // widget must render em-dash, not $0.00, to honor the "em-dashes, not
    // wrong numbers" contract documented in pricing-enrich.ts:20-23.
    expect(hasCostData(tu({ pricing_is_stale: true }))).toBe(false);
  });

  it('is false when every observed model is unpriced on a fresh snapshot', () => {
    expect(
      hasCostData(
        tu({
          by_model: [{ agent_model: 'brand-new-model-v1' }, { agent_model: 'brand-new-model-v2' }],
          models_without_pricing: ['brand-new-model-v1', 'brand-new-model-v2'],
          models_without_pricing_total: 2,
        }),
      ),
    ).toBe(false);
  });

  it('is true when some models are unpriced but others priced', () => {
    // Partial coverage still yields a meaningful total — the priced subset.
    // Coverage note handles attribution; gate stays true.
    expect(
      hasCostData(
        tu({
          by_model: [{ agent_model: 'priced' }, { agent_model: 'unpriced' }],
          models_without_pricing: ['unpriced'],
          models_without_pricing_total: 1,
        }),
      ),
    ).toBe(true);
  });

  it('is true when by_model is empty and token data exists', () => {
    // Sessions captured tokens but agent_model was never set — the SQL
    // groups the model breakdown by non-null agent_model, so by_model can
    // be empty without meaning "no cost data." totals still add up.
    expect(hasCostData(tu({ by_model: [] }))).toBe(true);
  });
});

describe('costEmptyReason', () => {
  it('explains stale pricing before any other state', () => {
    expect(costEmptyReason(tu({ pricing_is_stale: true }), ['claude-code'])).toBe(
      'Pricing refresh pending — cost estimates paused',
    );
  });

  it('names the first unpriced model when there is exactly one', () => {
    expect(
      costEmptyReason(
        tu({
          by_model: [{ agent_model: 'brand-new' }],
          models_without_pricing: ['brand-new'],
          models_without_pricing_total: 1,
        }),
        ['claude-code'],
      ),
    ).toBe('Awaiting pricing for brand-new');
  });

  it('pluralizes when multiple models are unpriced', () => {
    expect(
      costEmptyReason(
        tu({
          by_model: [{ agent_model: 'a' }, { agent_model: 'b' }, { agent_model: 'c' }],
          models_without_pricing: ['a', 'b', 'c'],
          models_without_pricing_total: 3,
        }),
        ['claude-code'],
      ),
    ).toBe('Awaiting pricing for a (and 2 more)');
  });

  it('routes zero-sessions through the capability helper rather than a pricing-specific reason', () => {
    // Contract: when neither stale nor all-unpriced, zero-sessions delegates
    // to capabilityCoverageNote. The helper's exact output depends on the
    // live tool-registry; what this test locks is that we don't accidentally
    // surface a pricing-specific reason for a non-pricing empty state.
    const reason = costEmptyReason(tu({ sessions_with_token_data: 0 }), []);
    if (reason != null) {
      expect(reason).not.toMatch(/Pricing refresh pending/);
      expect(reason).not.toMatch(/Awaiting pricing/);
    }
  });

  it('prefers stale reason over the all-unpriced reason when both would fire', () => {
    // Pricing-enrich zeroes models_without_pricing when stale, so in practice
    // only one branch fires at a time — but if both conditions somehow were
    // true, stale wins. That ordering matters for the em-dash message users
    // see during a late snapshot refresh that caught new models.
    expect(
      costEmptyReason(
        tu({
          pricing_is_stale: true,
          by_model: [{ agent_model: 'x' }],
          models_without_pricing: ['x'],
          models_without_pricing_total: 1,
        }),
        [],
      ),
    ).toBe('Pricing refresh pending — cost estimates paused');
  });
});
