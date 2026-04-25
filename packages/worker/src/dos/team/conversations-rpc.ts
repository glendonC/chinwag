// Conversation intelligence RPC bodies extracted from TeamDO.
//
// recordConversationEvents is the high-volume ingest path (batched, behind
// the standard #op wrapper for telemetry). The remaining methods are reads
// for per-session detail and aggregate rollups.

import type { DOError } from '../../types.js';
import {
  batchRecordConversationEvents as batchRecordConversationEventsFn,
  getConversationForSession as getConversationForSessionFn,
  getConversationAnalytics as getConversationAnalyticsFn,
  getSessionConversationStats as getSessionConversationStatsFn,
  type ConversationEventInput,
} from './conversations.js';
import type {
  ConversationAnalytics,
  SessionConversationStats,
} from '@chinmeister/shared/contracts/conversation.js';
import type { AnalyticsScope } from './analytics/scope.js';
import type { RpcCtx } from './rpc-ctx.js';

export async function rpcBatchRecordConversationEvents(
  ctx: RpcCtx,
  agentId: string,
  sessionId: string,
  handle: string,
  hostTool: string,
  events: ConversationEventInput[],
  ownerId: string | null = null,
): Promise<{ ok: true; count: number } | DOError> {
  return ctx.op(
    agentId,
    ownerId,
    () =>
      batchRecordConversationEventsFn(
        ctx.sql,
        sessionId,
        agentId,
        handle,
        hostTool,
        events,
        ctx.transact,
      ),
    {
      metric: () => 'conversation_events_recorded',
    },
  );
}

export async function rpcGetConversationForSession(
  ctx: RpcCtx,
  agentId: string,
  sessionId: string,
  ownerId: string | null = null,
): Promise<ReturnType<typeof getConversationForSessionFn> | DOError> {
  return ctx.withMember(agentId, ownerId, () => getConversationForSessionFn(ctx.sql, sessionId));
}

export async function rpcGetConversationAnalytics(
  ctx: RpcCtx,
  agentId: string,
  days: number,
  ownerId: string | null = null,
  scope: AnalyticsScope = {},
): Promise<ConversationAnalytics | DOError> {
  return ctx.withMember(agentId, ownerId, () => getConversationAnalyticsFn(ctx.sql, scope, days));
}

export async function rpcGetSessionConversationStats(
  ctx: RpcCtx,
  agentId: string,
  sessionIds: string[],
  ownerId: string | null = null,
): Promise<{ ok: true; stats: SessionConversationStats[] } | DOError> {
  return ctx.withMember(agentId, ownerId, () => ({
    ok: true as const,
    stats: getSessionConversationStatsFn(ctx.sql, sessionIds),
  }));
}
