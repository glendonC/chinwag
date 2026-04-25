// Analytics RPC bodies extracted from TeamDO.
//
// getAnalyticsForOwner is the cross-project (owner-scoped) extended
// analytics path used by the dashboard. It pairs with getAnalytics in
// session-rpc but gates on team_owners (not member presence) and always
// returns extended.
//
// getBillingBlocks returns the caller's 5h Anthropic rate-limit windows
// for this team's sessions, scoped by owner id.

import type { DOError } from '../../types.js';
import { isDOError } from '../../lib/errors.js';
import { getExtendedAnalytics as getExtendedAnalyticsFn } from './analytics/index.js';
import { getBillingBlocksForOwner as getBillingBlocksForOwnerFn } from './analytics/billing-blocks.js';
import {
  enrichAnalyticsWithPricing,
  enrichDailyTrendsWithPricing,
  enrichPeriodComparisonCost,
} from '../../lib/pricing-enrich.js';
import { queryDailyTokenUsage, queryTokenAggregateForWindow } from './analytics/tokens.js';
import type { AnalyticsScope } from './analytics/scope.js';
import type { RpcCtx } from './rpc-ctx.js';

export async function rpcGetAnalyticsForOwner(
  ctx: RpcCtx,
  ownerId: string,
  days: number,
  tzOffsetMinutes: number = 0,
  scope: AnalyticsScope = {},
): Promise<ReturnType<typeof getExtendedAnalyticsFn> | DOError> {
  const gate = ctx.withOwner(ownerId, () =>
    getExtendedAnalyticsFn(ctx.sql, scope, days, tzOffsetMinutes),
  );
  if (isDOError(gate)) return gate;
  const enriched = await enrichAnalyticsWithPricing(gate, ctx.env);
  const dailyTokens = queryDailyTokenUsage(ctx.sql, scope, days, tzOffsetMinutes);
  await enrichDailyTrendsWithPricing(enriched.daily_trends, dailyTokens, ctx.env);
  // Same period-comparison cost enrichment as getAnalytics. Each team
  // ships its own cost/edits in period_comparison; the cross-team route
  // then sums them null-stickily and re-derives cost_per_edit on the
  // merged totals (daily-trends pattern) instead of averaging ratios.
  const currentAgg = queryTokenAggregateForWindow(ctx.sql, scope, days, 0);
  const previousAgg = queryTokenAggregateForWindow(ctx.sql, scope, days * 2, days);
  await enrichPeriodComparisonCost(enriched, currentAgg, previousAgg, ctx.env);
  return enriched;
}

export async function rpcGetBillingBlocks(
  ctx: RpcCtx,
  ownerId: string,
): Promise<ReturnType<typeof getBillingBlocksForOwnerFn> | DOError> {
  return ctx.withOwner(ownerId, () => getBillingBlocksForOwnerFn(ctx.sql, ownerId));
}
