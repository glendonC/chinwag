// Analytics pricing enrichment.
//
// queryTokenUsage returns raw token totals with no cost math. This module
// is called from the async DO methods (getAnalytics, getAnalyticsForOwner)
// after the sync query returns, and fills in:
//
//   - per-model estimated_cost_usd (null when the model isn't in LiteLLM)
//   - total_estimated_cost_usd (sum of non-null per-model costs)
//   - pricing_refreshed_at / pricing_is_stale (UI staleness banner signals)
//   - models_without_pricing (capped at 20, for the "coverage gap" surface)
//
// Staleness semantics: if the isolate snapshot is >7 days old, ALL costs are
// zeroed and per-model values become null. Serving stale-but-confident
// numbers is worse than rendering em-dashes; the UI can detect the stale
// flag and show a banner.
//
// The helper mutates the token_usage object in place because we're building
// a response that will be serialized once. Making copies would double the
// allocation for every analytics request with no benefit.

import type { Env } from '../../types.js';
import { getPricingCache } from '../../lib/pricing-cache.js';
import { estimateSessionCostV2 } from '../../lib/model-pricing-v2.js';
import { resolveLiteLLMKey } from '../../lib/litellm-resolver.js';

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
  total_estimated_cost_usd: number;
  pricing_refreshed_at: string | null;
  pricing_is_stale: boolean;
  models_without_pricing: string[];
  [k: string]: unknown;
}

/**
 * Enrich a single analytics response object's token_usage section with cost
 * data. Safe to call when token_usage is missing or empty — it's a no-op in
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
  const keySet = new Set(snapshot.byName.keys());

  if (snapshot.isStale) {
    // Serve em-dashes, not wrong numbers. UI reads pricing_is_stale to show
    // the staleness banner.
    tokenUsage.pricing_refreshed_at = snapshot.fetchedAt;
    tokenUsage.pricing_is_stale = true;
    tokenUsage.total_estimated_cost_usd = 0;
    tokenUsage.models_without_pricing = [];
    for (const m of tokenUsage.by_model) {
      m.estimated_cost_usd = null;
    }
    return analytics;
  }

  const unpriced: string[] = [];
  let totalCost = 0;

  for (const m of tokenUsage.by_model) {
    const canonical = resolveLiteLLMKey(m.agent_model, keySet);
    const row = canonical ? snapshot.byName.get(canonical) : undefined;
    const cost = estimateSessionCostV2(row ?? null, {
      inputTokens: m.input_tokens ?? 0,
      outputTokens: m.output_tokens ?? 0,
      cacheReadTokens: m.cache_read_tokens ?? 0,
      cacheCreationTokens: m.cache_creation_tokens ?? 0,
    });

    m.estimated_cost_usd = cost;
    if (cost == null) {
      if (m.agent_model && unpriced.length < MAX_UNPRICED_REPORTED) {
        unpriced.push(m.agent_model);
      }
    } else {
      totalCost += cost;
    }
  }

  tokenUsage.pricing_refreshed_at = snapshot.fetchedAt;
  tokenUsage.pricing_is_stale = false;
  tokenUsage.total_estimated_cost_usd = Math.round(totalCost * 100) / 100;
  tokenUsage.models_without_pricing = unpriced;

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
