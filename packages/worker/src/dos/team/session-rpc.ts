// Session RPC bodies extracted from TeamDO.
//
// Sessions are the core observability primitive: lifecycle (start/end),
// per-session deltas (edits, outcomes, tokens, tool calls, commits),
// retroactive enrichment (model name), and reads for the swimlane and
// edit-history views. Several methods broadcast watcher events or bump
// telemetry counters; those side effects flow through the standard #op
// wrapper.

import type { DOResult, DOError } from '../../types.js';
import { isDOError } from '../../lib/errors.js';
import {
  startSession as startSessionFn,
  endSession as endSessionFn,
  recordEdit as recordEditFn,
  reportOutcome as reportOutcomeFn,
  recordTokenUsage as recordTokenUsageFn,
  recordToolCalls as recordToolCallsFn,
  recordCommits as recordCommitsFn,
  type ToolCallInput,
  type CommitInput,
  getSessionHistory,
  getSessionsInRange as getSessionsInRangeFn,
  getEditHistory as getEditHistoryFn,
  enrichSessionModel as enrichSessionModelFn,
  type EditEntry,
  type SessionRecord,
} from './sessions.js';
import {
  getAnalytics as getAnalyticsFn,
  getExtendedAnalytics as getExtendedAnalyticsFn,
} from './analytics/index.js';
import {
  enrichAnalyticsWithPricing,
  enrichDailyTrendsWithPricing,
  enrichPeriodComparisonCost,
} from '../../lib/pricing-enrich.js';
import { queryDailyTokenUsage, queryTokenAggregateForWindow } from './analytics/tokens.js';
import type { AnalyticsScope } from './analytics/scope.js';
import type { RpcCtx } from './rpc-ctx.js';

export async function rpcStartSession(
  ctx: RpcCtx,
  agentId: string,
  handle: string,
  framework: string,
  runtime: Record<string, unknown> | null = null,
  ownerId: string | null = null,
): Promise<DOResult<{ ok: true; session_id: string }> | DOError> {
  return ctx.op(
    agentId,
    ownerId,
    (resolved) => startSessionFn(ctx.sql, resolved, handle, framework, runtime, ctx.transact),
    {
      metric: () => 'sessions_started',
    },
  );
}

export async function rpcEndSession(
  ctx: RpcCtx,
  agentId: string,
  sessionId: string,
  ownerId: string | null = null,
): Promise<
  | DOResult<{ ok: true; outcome?: string | null; summary?: Record<string, unknown> | null }>
  | DOError
> {
  return ctx.op(agentId, ownerId, (resolved) => endSessionFn(ctx.sql, resolved, sessionId), {
    metric: (r) => (r.outcome ? `outcome:${r.outcome}` : null),
  });
}

export async function rpcRecordEdit(
  ctx: RpcCtx,
  agentId: string,
  filePath: string,
  linesAdded = 0,
  linesRemoved = 0,
  ownerId: string | null = null,
): Promise<{ ok: true; skipped?: boolean } | DOError> {
  return ctx.withMember(agentId, ownerId, (resolved) =>
    recordEditFn(ctx.sql, resolved, filePath, linesAdded, linesRemoved),
  );
}

export async function rpcReportOutcome(
  ctx: RpcCtx,
  agentId: string,
  outcome: string,
  summary: string | null = null,
  ownerId: string | null = null,
  outcomeTags?: string[] | null,
): Promise<DOResult<{ ok: true }> | DOError> {
  return ctx.withMember(agentId, ownerId, (resolved) =>
    reportOutcomeFn(ctx.sql, resolved, outcome, summary, outcomeTags),
  );
}

export async function rpcGetSessionHistory(
  ctx: RpcCtx,
  agentId: string,
  days: number,
  ownerId: string | null = null,
): Promise<ReturnType<typeof getSessionHistory> | DOError> {
  return ctx.withMember(agentId, ownerId, () => getSessionHistory(ctx.sql, days));
}

export async function rpcGetEditHistory(
  ctx: RpcCtx,
  agentId: string,
  days: number,
  filePath: string | null = null,
  handle: string | null = null,
  limit = 200,
  ownerId: string | null = null,
): Promise<{ ok: true; edits: EditEntry[] } | DOError> {
  return ctx.withMember(agentId, ownerId, () =>
    getEditHistoryFn(ctx.sql, days, filePath, handle, limit),
  );
}

export async function rpcGetAnalytics(
  ctx: RpcCtx,
  agentId: string,
  days: number,
  ownerId: string | null = null,
  extended = false,
  tzOffsetMinutes: number = 0,
  scope: AnalyticsScope = {},
): Promise<
  ReturnType<typeof getAnalyticsFn> | ReturnType<typeof getExtendedAnalyticsFn> | DOError
> {
  const raw = ctx.withMember(agentId, ownerId, () =>
    extended
      ? getExtendedAnalyticsFn(ctx.sql, scope, days, tzOffsetMinutes)
      : getAnalyticsFn(ctx.sql, scope, days, tzOffsetMinutes),
  );
  if (isDOError(raw)) return raw;
  // Enrich token_usage with cost from the isolate pricing cache. This hits
  // DatabaseDO at most once per TTL window (5 min) rather than per request.
  const enriched = await enrichAnalyticsWithPricing(raw, ctx.env);
  // Per-day cost on daily_trends: same pricing snapshot, one extra SQL
  // aggregate. Fills the Trend widget's cost and cost-per-edit lines with
  // honest per-day numbers instead of the "daily cost not captured"
  // placeholder. Reliability gates mirror the period total.
  const dailyTokens = queryDailyTokenUsage(ctx.sql, scope, days, tzOffsetMinutes);
  await enrichDailyTrendsWithPricing(enriched.daily_trends, dailyTokens, ctx.env);
  // Period-comparison cost: price both windows against the CURRENT pricing
  // snapshot so the cost-per-edit delta shown by CostPerEditWidget reflects
  // behavior change, not price drift. Previous-window aggregate falls to
  // empty when outside retention (30d default), which computeWindowCost
  // maps to a null cost - StatWidget's delta gate then skips rendering.
  const currentAgg = queryTokenAggregateForWindow(ctx.sql, scope, days, 0);
  const previousAgg = queryTokenAggregateForWindow(ctx.sql, scope, days * 2, days);
  await enrichPeriodComparisonCost(enriched, currentAgg, previousAgg, ctx.env);
  return enriched;
}

export async function rpcEnrichModel(
  ctx: RpcCtx,
  agentId: string,
  model: string,
  ownerId: string | null = null,
): Promise<{ ok: true } | DOError> {
  return ctx.withMember(agentId, ownerId, (resolved) =>
    enrichSessionModelFn(ctx.sql, resolved, model, ctx.boundRecordMetric, ctx.transact),
  );
}

export async function rpcRecordTokenUsage(
  ctx: RpcCtx,
  agentId: string,
  sessionId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
  ownerId: string | null = null,
): Promise<{ ok: true } | DOError> {
  return ctx.withMember(agentId, ownerId, (resolved) =>
    recordTokenUsageFn(
      ctx.sql,
      resolved,
      sessionId,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
    ),
  );
}

export async function rpcRecordToolCalls(
  ctx: RpcCtx,
  agentId: string,
  sessionId: string,
  handle: string,
  hostTool: string,
  calls: ToolCallInput[],
  ownerId: string | null = null,
): Promise<{ ok: true; recorded: number } | DOError> {
  return ctx.withMember(agentId, ownerId, (resolved) =>
    recordToolCallsFn(ctx.sql, resolved, sessionId, handle, hostTool, calls),
  );
}

export async function rpcRecordCommits(
  ctx: RpcCtx,
  agentId: string,
  sessionId: string | null,
  handle: string,
  hostTool: string,
  commits: CommitInput[],
  ownerId: string | null = null,
): Promise<{ ok: true; recorded: number } | DOError> {
  return ctx.withMember(agentId, ownerId, (resolved) =>
    recordCommitsFn(ctx.sql, resolved, sessionId, handle, hostTool, commits),
  );
}

export async function rpcGetSessionsInRange(
  ctx: RpcCtx,
  ownerId: string,
  fromDate: string,
  toDate: string,
  filters?: { hostTool?: string; handle?: string },
): Promise<
  { ok: true; sessions: SessionRecord[]; truncated: boolean; total_sessions: number } | DOError
> {
  return ctx.withOwner(ownerId, () => {
    const result = getSessionsInRangeFn(ctx.sql, fromDate, toDate, filters);
    return { ok: true as const, ...result };
  });
}
