// Analytics pricing enrichment.
//
// queryTokenUsage returns raw token totals with no cost math. This module is
// called from two places:
//   - dos/team/index.ts (getAnalytics, getAnalyticsForOwner) after the sync
//     query returns
//   - routes/user/analytics.ts once per cross-team request, on the merged
//     token_usage object
//
// Lives in lib/ rather than dos/team/ because it's a generic enrichment
// concern consumed by both the team DO and a cross-team route handler -
// not a team-DO-specific helper.
//
// Fills in:
//   - per-model estimated_cost_usd (null when the model isn't in LiteLLM)
//   - total_estimated_cost_usd (null when stale OR nothing priced)
//   - cost_per_edit (null per the four cases documented on the schema field)
//   - pricing_refreshed_at / pricing_is_stale (UI staleness banner signals)
//   - models_without_pricing (capped at 20, for the "coverage gap" surface)
//
// Staleness semantics: if the isolate snapshot is >7 days old, every
// pricing-derived field is set to null and the pricing_is_stale flag is
// true. Serving stale-but-confident numbers is worse than rendering
// em-dashes; the UI detects null + the flag and shows a staleness banner.
//
// Null-vs-zero semantics: null means "we could not determine cost" (stale,
// unpriced, or missing data). Zero means "we measured cost and it was
// zero" (rare but legitimate: a session with truly zero tokens). Widgets
// render null as `--` and zero as `$0.00`, so the difference is visible.
//
// The helper mutates token_usage in place because we're building a response
// that will be serialized once. Making copies would double the allocation
// for every analytics request with no benefit.

import type { Env } from '../types.js';
import { getPricingCache, type PricingSnapshot } from './pricing-cache.js';
import { estimateSessionCost } from './model-pricing.js';
import { resolveLiteLLMKey } from './litellm-resolver.js';

const MAX_UNPRICED_REPORTED = 20;

interface TokenUsageShape {
  by_model?: Array<{
    agent_model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens?: number;
    cache_creation_tokens?: number;
    sessions: number;
    estimated_cost_usd: number | null;
  }>;
  total_estimated_cost_usd: number | null;
  pricing_refreshed_at: string | null;
  pricing_is_stale: boolean;
  models_without_pricing: string[];
  models_without_pricing_total: number;
  total_edits_in_token_sessions?: number;
  cost_per_edit?: number | null;
  [k: string]: unknown;
}

/**
 * Token aggregate for a specific period window. Used by
 * enrichPeriodComparisonCost to compute cost + cost_per_edit for the
 * previous period (and verify the current period matches the ongoing
 * token_usage enrichment). Intentionally minimal - only the fields needed
 * for pricing, no per-tool or session breakdowns.
 */
export interface WindowTokenAggregate {
  by_model: Array<{
    agent_model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  }>;
  total_edits_in_token_sessions: number;
}

export interface WindowCostResult {
  /** Total USD cost summed over priced models. Null when snapshot is
   *  stale, window has no by_model rows, or every model was unpriced. */
  total_estimated_cost_usd: number | null;
  /** Cost divided by edits_in_token_sessions, 4-decimal storage. Null
   *  under the same conditions as total_estimated_cost_usd OR when the
   *  denominator is zero. */
  cost_per_edit: number | null;
  /** Up to MAX_UNPRICED_REPORTED canonical names that we couldn't price. */
  models_without_pricing: string[];
  /** Full count of unpriced models, including beyond the display cap. */
  models_without_pricing_total: number;
}

/**
 * Pure cost computation for a window of token aggregates. No mutation, no
 * I/O - the caller supplies the pricing snapshot. Enforces the four null
 * causes documented on the schema's cost_per_edit field so the behavior is
 * consistent whether we're enriching the main token_usage payload or a
 * previous-period aggregate for the comparison.
 */
export function computeWindowCost(
  agg: WindowTokenAggregate,
  snapshot: PricingSnapshot,
): WindowCostResult {
  if (snapshot.isStale) {
    return {
      total_estimated_cost_usd: null,
      cost_per_edit: null,
      models_without_pricing: [],
      models_without_pricing_total: 0,
    };
  }

  const keySet = new Set(snapshot.byName.keys());
  const unpricedCapped: string[] = [];
  let unpricedTotal = 0;
  let totalCost = 0;
  let anyPriced = false;

  for (const m of agg.by_model) {
    const canonical = resolveLiteLLMKey(m.agent_model, keySet);
    const row = canonical ? snapshot.byName.get(canonical) : undefined;
    const cost = estimateSessionCost(row ?? null, {
      inputTokens: m.input_tokens ?? 0,
      outputTokens: m.output_tokens ?? 0,
      cacheReadTokens: m.cache_read_tokens ?? 0,
      cacheCreationTokens: m.cache_creation_tokens ?? 0,
    });
    if (cost == null) {
      if (m.agent_model) {
        unpricedTotal++;
        if (unpricedCapped.length < MAX_UNPRICED_REPORTED) {
          unpricedCapped.push(m.agent_model);
        }
      }
    } else {
      totalCost += cost;
      anyPriced = true;
    }
  }

  if (!anyPriced) {
    return {
      total_estimated_cost_usd: null,
      cost_per_edit: null,
      models_without_pricing: unpricedCapped,
      models_without_pricing_total: unpricedTotal,
    };
  }

  const edits = agg.total_edits_in_token_sessions;
  return {
    total_estimated_cost_usd: Math.round(totalCost * 100) / 100,
    cost_per_edit: edits > 0 ? Math.round((totalCost / edits) * 10000) / 10000 : null,
    models_without_pricing: unpricedCapped,
    models_without_pricing_total: unpricedTotal,
  };
}

/**
 * Enrich a single analytics response object's token_usage section with cost
 * data. Safe to call when token_usage is missing or empty - it's a no-op in
 * that case. Returns the same reference (mutates in place).
 *
 * The generic is unconstrained so TypeScript infers T from the call site
 * (typically a union of getAnalyticsFn and getExtendedAnalyticsFn return
 * types). A narrower `T extends { token_usage?: unknown }` constraint would
 * force TS to widen T to the constraint when the argument is a union, which
 * the call site at dos/team/index.ts:getAnalytics is.
 */
export async function enrichAnalyticsWithPricing<T>(analytics: T, env: Env): Promise<T> {
  const tokenUsage = (analytics as { token_usage?: unknown }).token_usage as
    | TokenUsageShape
    | undefined;
  if (!tokenUsage || !Array.isArray(tokenUsage.by_model)) return analytics;

  const snapshot = await getPricingCache(env);

  if (snapshot.isStale) {
    // Serve em-dashes, not wrong numbers. UI reads pricing_is_stale to show
    // the staleness banner.
    tokenUsage.pricing_refreshed_at = snapshot.fetchedAt;
    tokenUsage.pricing_is_stale = true;
    tokenUsage.total_estimated_cost_usd = null;
    tokenUsage.cost_per_edit = null;
    tokenUsage.models_without_pricing = [];
    tokenUsage.models_without_pricing_total = 0;
    for (const m of tokenUsage.by_model) {
      m.estimated_cost_usd = null;
    }
    return analytics;
  }

  // Build a window aggregate from the already-fetched by_model rows so the
  // pure computation path is shared with period-comparison enrichment.
  const aggregate: WindowTokenAggregate = {
    by_model: tokenUsage.by_model.map((m) => ({
      agent_model: m.agent_model,
      input_tokens: m.input_tokens ?? 0,
      output_tokens: m.output_tokens ?? 0,
      cache_read_tokens: m.cache_read_tokens ?? 0,
      cache_creation_tokens: m.cache_creation_tokens ?? 0,
    })),
    total_edits_in_token_sessions: tokenUsage.total_edits_in_token_sessions ?? 0,
  };

  const result = computeWindowCost(aggregate, snapshot);

  // Also patch the per-model estimated_cost_usd so UsageDetailView's
  // breakdown uses the same pricing snapshot. Re-resolve per model since
  // computeWindowCost doesn't expose the per-row costs.
  const keySet = new Set(snapshot.byName.keys());
  for (const m of tokenUsage.by_model) {
    const canonical = resolveLiteLLMKey(m.agent_model, keySet);
    const row = canonical ? snapshot.byName.get(canonical) : undefined;
    m.estimated_cost_usd = estimateSessionCost(row ?? null, {
      inputTokens: m.input_tokens ?? 0,
      outputTokens: m.output_tokens ?? 0,
      cacheReadTokens: m.cache_read_tokens ?? 0,
      cacheCreationTokens: m.cache_creation_tokens ?? 0,
    });
  }

  tokenUsage.pricing_refreshed_at = snapshot.fetchedAt;
  tokenUsage.pricing_is_stale = false;
  tokenUsage.total_estimated_cost_usd = result.total_estimated_cost_usd;
  tokenUsage.cost_per_edit = result.cost_per_edit;
  tokenUsage.models_without_pricing = result.models_without_pricing;
  tokenUsage.models_without_pricing_total = result.models_without_pricing_total;

  return analytics;
}

/**
 * Same enrichment applied to an already-merged cross-team token usage object
 * (user analytics route). Accepts the built token_usage plus the env, returns
 * the enriched object. Unlike the team-scoped variant this takes the object
 * directly rather than a wrapping analytics payload, so the route handler
 * can call it once on the final merge instead of per team.
 */
export async function enrichTokenUsageWithPricing(
  tokenUsage: TokenUsageShape,
  env: Env,
): Promise<TokenUsageShape> {
  await enrichAnalyticsWithPricing({ token_usage: tokenUsage }, env);
  return tokenUsage;
}

interface PeriodMetricsCostFields {
  total_estimated_cost_usd: number | null;
  total_edits_in_token_sessions: number;
  cost_per_edit: number | null;
}

/**
 * Fill the cost fields on period_comparison.current and .previous using the
 * same pricing snapshot both windows' token aggregates are priced against.
 * Both periods use the CURRENT snapshot - if Anthropic halved prices in the
 * newer period, the delta would otherwise go green independent of behavior.
 * Applying a single snapshot to both windows yields a behavior-only delta
 * ("what would last period have cost at today's rates").
 *
 * Mutates analytics.period_comparison in place. No-op when period_comparison
 * is absent (e.g., the non-extended analytics variant).
 */
export async function enrichPeriodComparisonCost<T>(
  analytics: T,
  currentAgg: WindowTokenAggregate,
  previousAgg: WindowTokenAggregate | null,
  env: Env,
): Promise<T> {
  const pc = (
    analytics as {
      period_comparison?: {
        current: PeriodMetricsCostFields;
        previous: PeriodMetricsCostFields | null;
      } | null;
    }
  ).period_comparison;
  if (!pc) return analytics;

  const snapshot = await getPricingCache(env);

  const cur = computeWindowCost(currentAgg, snapshot);
  pc.current.total_estimated_cost_usd = cur.total_estimated_cost_usd;
  pc.current.total_edits_in_token_sessions = currentAgg.total_edits_in_token_sessions;
  pc.current.cost_per_edit = cur.cost_per_edit;

  if (pc.previous && previousAgg) {
    const prev = computeWindowCost(previousAgg, snapshot);
    pc.previous.total_estimated_cost_usd = prev.total_estimated_cost_usd;
    pc.previous.total_edits_in_token_sessions = previousAgg.total_edits_in_token_sessions;
    pc.previous.cost_per_edit = prev.cost_per_edit;
  }

  return analytics;
}

/** Shape mirrored from `DailyTokenUsageRow` in dos/team/analytics/tokens.ts.
 * Redeclared here so this module stays dependency-free against the DO graph. */
interface DailyTokenUsageRow {
  day: string;
  agent_model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

interface DailyTrendShape {
  day: string;
  edits?: number | undefined;
  cost?: number | null | undefined;
  cost_per_edit?: number | null | undefined;
  [k: string]: unknown;
}

/**
 * Populate per-day `cost` and `cost_per_edit` on an array of daily_trends
 * rows, using per-day per-model token aggregates and the isolate pricing
 * cache. Fills the trend widget's cost-over-time curve with honest per-day
 * numbers instead of the "daily cost not captured" placeholder.
 *
 * Reliability gates mirror the period-total enrichment:
 *   - Stale pricing snapshot → every day's cost stays null.
 *   - Day with no token-capturing rows → cost stays null (distinct from $0).
 *   - Day with only unpriced models → cost stays null, not a partial sum.
 *
 * Mutates in place. Safe to call with empty inputs.
 */
export async function enrichDailyTrendsWithPricing<T extends DailyTrendShape>(
  dailyTrends: T[],
  dailyTokens: DailyTokenUsageRow[],
  env: Env,
): Promise<void> {
  if (dailyTrends.length === 0) return;

  const snapshot = await getPricingCache(env);
  if (snapshot.isStale) return;

  const keySet = new Set(snapshot.byName.keys());

  const byDay = new Map<string, DailyTokenUsageRow[]>();
  for (const row of dailyTokens) {
    const bucket = byDay.get(row.day);
    if (bucket) bucket.push(row);
    else byDay.set(row.day, [row]);
  }

  for (const trend of dailyTrends) {
    const rows = byDay.get(trend.day);
    if (!rows || rows.length === 0) continue;

    let dayTotal = 0;
    let anyPriced = false;

    for (const row of rows) {
      const canonical = resolveLiteLLMKey(row.agent_model, keySet);
      const pricing = canonical ? snapshot.byName.get(canonical) : undefined;
      const cost = estimateSessionCost(pricing ?? null, {
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheReadTokens: row.cache_read_tokens,
        cacheCreationTokens: row.cache_creation_tokens,
      });
      if (cost != null) {
        dayTotal += cost;
        anyPriced = true;
      }
    }

    if (!anyPriced) continue;

    trend.cost = Math.round(dayTotal * 10000) / 10000;
    const edits = trend.edits ?? 0;
    trend.cost_per_edit = edits > 0 ? Math.round((dayTotal / edits) * 10000) / 10000 : null;
  }
}
