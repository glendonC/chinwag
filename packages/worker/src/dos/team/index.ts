// Team Durable Object -- one instance per team.
// Manages team membership, activity tracking, file conflict detection,
// shared project memory, and session history (observability).
//
// Business logic is split into submodules (one concept per file):
//   schema.ts         -- DDL, migrations, index creation
//   context.ts        -- composite read queries (getContext, getSummary)
//   identity.ts       -- agent ID resolution and ownership verification
//   cleanup.ts        -- stale member eviction and data pruning
//   membership.ts     -- join / leave / heartbeat
//   activity.ts       -- update-activity / check-conflicts / report-file
//   sessions.ts       -- session lifecycle + edits, outcomes, tokens, tool-calls, commits
//   conversations.ts  -- conversation event ingestion + per-session stats
//   memory.ts         -- shared memory save/search/update/delete
//   categories.ts     -- memory category CRUD and promotion
//   locks.ts          -- file claim/release/query
//   messages.ts       -- inter-agent messaging
//   commands.ts       -- command queue for managed agents
//   analytics/        -- 14 domain modules + orchestrator (index.ts)
//   runtime.ts        -- agent ID / host tool inference
//   presence.ts       -- WebSocket presence helpers
//   broadcast.ts      -- delta broadcast helpers
//   telemetry.ts      -- per-team metric counters
//   context-cache.ts  -- TTL cache for the composite team context read
//   websocket.ts      -- hibernation-API lifecycle handlers
//
// Per-domain RPC bodies live in sibling *-rpc.ts modules and run against
// an RpcCtx (see rpc-ctx.ts) built fresh by the class on each call:
//   membership-rpc.ts    -- join / leave / heartbeat bodies
//   context-rpc.ts       -- getContext / getSummary bodies
//   activity-rpc.ts      -- updateActivity / checkConflicts / reportFile
//   session-rpc.ts       -- session lifecycle, edit/token/tool/commit/analytics
//   memory-rpc.ts        -- save/search/update/delete bodies
//   consolidation-rpc.ts -- review-queue bodies
//   formation-rpc.ts     -- shadow-mode auditor bodies
//   categories-rpc.ts    -- memory category CRUD bodies
//   locks-rpc.ts         -- file claim/release/query bodies
//   messages-rpc.ts      -- inter-agent messaging bodies
//   commands-rpc.ts      -- daemon-relay queue bodies
//   conversations-rpc.ts -- conversation event ingest + reads
//   analytics-rpc.ts     -- owner-scoped extended analytics + billing blocks
//   data-export-rpc.ts   -- per-user export / erasure (GDPR)
//
// This file owns: the DurableObject class shell, WebSocket method entry
// points, instance-scoped caches (context, heartbeat debounce, cleanup
// clock), the identity/member/op/owner wrappers that every RPC flows
// through, the #rpcCtx() builder that hands those wrappers to the *-rpc
// modules, and the public RPC surface itself (one-line delegations).

import { DurableObject } from 'cloudflare:workers';
import type { Env, DOResult, DOError, TeamContext } from '../../types.js';
import { isDOError } from '../../lib/errors.js';

import { ensureSchema } from './schema.js';
import { type queryTeamSummary } from './context.js';
import { resolveOwnedAgentId } from './identity.js';
import { runCleanup, collectHandleBackfills, type OrphanSummary } from './cleanup.js';
import type { RpcCtx } from './rpc-ctx.js';
import { rpcJoin, rpcLeave, rpcHeartbeat } from './membership-rpc.js';
import { rpcGetContext, rpcGetSummary } from './context-rpc.js';
import { rpcUpdateActivity, rpcCheckConflicts, rpcReportFile } from './activity-rpc.js';
import type { checkConflicts as checkConflictsFn } from './activity.js';
import {
  rpcSaveMemory,
  rpcSearchMemories,
  rpcUpdateMemory,
  rpcDeleteMemory,
  rpcDeleteMemoriesBatch,
} from './memory-rpc.js';
import type {
  saveMemory as saveMemoryFn,
  searchMemories as searchMemoriesFn,
  SearchFilters,
  BatchDeleteFilter,
} from './memory.js';
import {
  rpcConsolidateMemories,
  rpcListConsolidationProposals,
  rpcApplyConsolidationProposal,
  rpcRejectConsolidationProposal,
  rpcUnmergeMemory,
} from './consolidation-rpc.js';
import type {
  consolidateMemories as consolidateMemoriesFn,
  listConsolidationProposals as listConsolidationProposalsFn,
  applyConsolidationProposal as applyConsolidationProposalFn,
  rejectConsolidationProposal as rejectConsolidationProposalFn,
  unmergeMemory as unmergeMemoryFn,
} from './consolidation.js';
import {
  rpcRunFormationOnRecent,
  rpcRunFormationPass,
  rpcListFormationObservations,
} from './formation-rpc.js';
import type {
  listFormationObservations as listFormationObservationsFn,
  FormationRecommendation,
} from './formation.js';
import {
  rpcCreateCategory,
  rpcListCategories,
  rpcUpdateCategory,
  rpcDeleteCategory,
  rpcGetCategoryNames,
  rpcGetPromotableTags,
} from './categories-rpc.js';
import type {
  listCategories as listCategoriesFn,
  getPromotableTags as getPromotableTagsFn,
} from './categories.js';
import {
  rpcClaimFiles,
  rpcCheckFileConflicts,
  rpcReleaseFiles,
  rpcGetLockedFiles,
} from './locks-rpc.js';
import type {
  claimFiles as claimFilesFn,
  checkFileConflicts as checkFileConflictsFn,
  getLockedFiles as getLockedFilesFn,
} from './locks.js';
import {
  rpcStartSession,
  rpcEndSession,
  rpcRecordEdit,
  rpcReportOutcome,
  rpcRecordTokenUsage,
  rpcRecordToolCalls,
  rpcRecordCommits,
  rpcGetSessionHistory,
  rpcGetEditHistory,
  rpcGetAnalytics,
  rpcEnrichModel,
  rpcGetSessionsInRange,
} from './session-rpc.js';
import type {
  ToolCallInput,
  CommitInput,
  getSessionHistory,
  EditEntry,
  SessionRecord,
} from './sessions.js';
import type {
  getAnalytics as getAnalyticsFn,
  getExtendedAnalytics as getExtendedAnalyticsFn,
} from './analytics/index.js';
import { rpcGetAnalyticsForOwner, rpcGetBillingBlocks } from './analytics-rpc.js';
import type { getBillingBlocksForOwner as getBillingBlocksForOwnerFn } from './analytics/billing-blocks.js';
import { rpcExportUserData, rpcDeleteUserData } from './data-export-rpc.js';
import type { UserDataExport, UserDataDeletionResult } from './data-export.js';
import { rpcSendMessage, rpcGetMessages } from './messages-rpc.js';
import type { getMessages as getMessagesFn } from './messages.js';
import {
  rpcBatchRecordConversationEvents,
  rpcGetConversationForSession,
  rpcGetConversationAnalytics,
  rpcGetSessionConversationStats,
} from './conversations-rpc.js';
import type {
  getConversationForSession as getConversationForSessionFn,
  ConversationEventInput,
} from './conversations.js';
import type {
  ConversationAnalytics,
  SessionConversationStats,
} from '@chinmeister/shared/contracts/conversation.js';
import { rpcSubmitCommand, rpcGetPendingCommands } from './commands-rpc.js';
import type { getPendingCommands as getPendingCommandsFn } from './commands.js';
import type { AnalyticsScope } from './analytics/scope.js';
import { CONTEXT_CACHE_TTL_MS, CLEANUP_INTERVAL_MS } from '../../lib/constants.js';
import {
  getConnectedAgentIds,
  getAllConnectedMemberIds,
  getAvailableSpawnTools,
  hasExecutorConnected,
} from './presence.js';
import { broadcastToWatchers, broadcastToExecutors } from './broadcast.js';
import { recordMetric as recordMetricFn } from './telemetry.js';
import { ContextCache } from './context-cache.js';
import { handleFetch, handleMessage, handleClose, handleError, type WsCtx } from './websocket.js';
import { getDB } from '../../lib/env.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('TeamDO');

export class TeamDO extends DurableObject<Env> {
  sql: SqlStorage;
  #schemaReady = false;
  #lastCleanup = 0;
  #lastHeartbeatBroadcast = new Map<string, number>();

  #contextCache = new ContextCache<TeamContext & { ok: true }>(CONTEXT_CACHE_TTL_MS);

  #transact: <T>(fn: () => T) => T;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.#transact = <T>(fn: () => T): T => ctx.storage.transactionSync(fn);
  }

  // -- Schema --

  #ensureSchema(): void {
    ensureSchema(this.sql, this.#schemaReady, this.#transact);
    this.#schemaReady = true;
  }

  // -- WebSocket support (Hibernation API) --
  // Three roles: 'agent' (MCP servers -- connection IS presence),
  // 'daemon' (background services -- persistent, no user interaction), and
  // 'watcher' (dashboards -- observe only, no presence signal).
  // Tags: [resolvedAgentId, 'role:agent|daemon|watcher']

  async fetch(request: Request): Promise<Response> {
    return handleFetch(this.#wsCtx(), request);
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    return handleMessage(this.#wsCtx(), ws, rawMessage);
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    return handleClose(this.#wsCtx(), ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    return handleError(this.#wsCtx(), ws);
  }

  /** Dependency bag for the WebSocket handlers - rebuilt per call so closures
   *  stay tied to live class state. Cheap: just a literal. */
  #wsCtx(): WsCtx {
    return {
      sql: this.sql,
      ctx: this.ctx,
      ensureSchema: () => this.#ensureSchema(),
      transact: this.#transact,
      resolveOwnedAgentId: (id, ownerId) => this.#resolveOwnedAgentId(id, ownerId),
      broadcastToWatchers: (event, opts) => this.#broadcastToWatchers(event, opts),
      getContext: (agentId) => this.getContext(agentId),
      lastHeartbeatBroadcast: this.#lastHeartbeatBroadcast,
    };
  }

  // -- Internal helpers --

  /** Agent IDs with an active 'role:agent' WebSocket connection. */
  #getConnectedAgentIds(): Set<string> {
    return getConnectedAgentIds(this.ctx);
  }

  /** All member IDs with any active WebSocket (agent, watcher, daemon).
   *  Used for cleanup eviction protection - any connected socket keeps
   *  the member row alive regardless of role. */
  #getAllConnectedMemberIds(): Set<string> {
    return getAllConnectedMemberIds(this.ctx);
  }

  #broadcastToWatchers(event: Record<string, unknown>, { invalidateCache = true } = {}): void {
    broadcastToWatchers(this.ctx, event, {
      invalidateCache: invalidateCache ? () => this.#contextCache.invalidate() : undefined,
    });
  }

  // -- Daemon command relay helpers --

  #broadcastToExecutors(event: Record<string, unknown>): void {
    broadcastToExecutors(this.ctx, event);
  }

  #hasExecutorConnected(): boolean {
    return hasExecutorConnected(this.ctx);
  }

  /** Collect available spawn tools from all connected daemon WebSocket tags. */
  #getAvailableSpawnTools(): string[] {
    return getAvailableSpawnTools(this.ctx);
  }

  // Evict stale members and prune old sessions -- at most once per minute.
  // Three write-through paths feed DatabaseDO.updateUserMetrics so lifetime
  // percentile ranks stay complete:
  //   1. Clean session end (activity.ts route handler)
  //   2. Orphan close (this sweep - for MCP crashes / hard Ctrl+C)
  //   3. Historical backfill (this sweep - self-heals pre-fix drift and any
  //      future rollup-path bug that leaves user_metrics holes)
  // Without these, getUserGlobalRank returns rank:null and every percentile
  // widget silently reads zeros.
  #maybeCleanup(): void {
    const now = Date.now();
    if (now - this.#lastCleanup < CLEANUP_INTERVAL_MS) return;
    this.#lastCleanup = now;
    const orphans = runCleanup(this.sql, this.#getAllConnectedMemberIds(), this.#transact);
    this.#flushUserMetricsBackfill(orphans);
  }

  async #flushUserMetricsBackfill(orphans: OrphanSummary[]): Promise<void> {
    const db = getDB(this.env);

    // Path 2: new orphans just closed by the sweep.
    for (const { handle, summary } of orphans) {
      db.updateUserMetrics(handle, summary).catch((err: unknown) => {
        log.warn('updateUserMetrics failed for orphaned session', {
          handle,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Path 3: self-healing backfill for handles that have closed sessions but
    // no user_metrics row. One RPC to check existence, then per-session emits
    // for the missing handles only. Idempotent - a handle that already has a
    // row is skipped, so re-running across sweeps converges at zero work.
    try {
      const candidates = this.sql
        .exec(`SELECT DISTINCT handle FROM sessions WHERE ended_at IS NOT NULL AND handle != ''`)
        .toArray() as Array<{ handle: string }>;
      if (candidates.length === 0) return;

      const existing = await db.existingMetricsHandles(candidates.map((r) => r.handle));
      const existingSet = new Set(existing);
      const backfills = collectHandleBackfills(this.sql, existingSet);
      for (const { handle, summary } of backfills) {
        db.updateUserMetrics(handle, summary).catch((err: unknown) => {
          log.warn('updateUserMetrics backfill failed', {
            handle,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (err) {
      log.warn('user_metrics backfill sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  #recordMetric(metric: string): void {
    recordMetricFn(this.sql, metric);
  }

  /**
   * Public surface for telemetry-only RPC calls. Route handlers that
   * decide to record a metric without invoking a write path (e.g. the
   * secret detector blocking a save) call this. Cheap; just bumps
   * daily_metrics. No member resolution needed - the route already
   * authenticated the caller.
   */
  async recordTelemetry(metric: string): Promise<{ ok: true }> {
    this.#ensureSchema();
    this.#recordMetric(metric);
    return { ok: true };
  }

  // -- Identity resolution (delegated to identity.ts) --

  #resolveOwnedAgentId(agentId: string, ownerId: string | null = null): string | null {
    return resolveOwnedAgentId(this.sql, agentId, ownerId);
  }

  /**
   * Common RPC wrapper: ensure schema, resolve agent, run callback.
   * Eliminates the repeated NOT_MEMBER check across 18+ RPC methods.
   */
  #withMember<T>(
    agentId: string,
    ownerId: string | null,
    fn: (resolved: string) => T,
  ): T | DOError {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team', code: 'NOT_MEMBER' };
    return fn(resolved);
  }

  /**
   * Member-scoped RPC wrapper that layers optional side effects on top of
   * `#withMember`. Pattern used by ~18 RPC methods:
   *
   *   1. ensureSchema + NOT_MEMBER check (via #withMember)
   *   2. Run `run(resolvedAgentId)` to produce a domain result.
   *   3. If the result is NOT a DOError, fire the optional `broadcast` hook
   *      (delta event to connected watchers) and/or the `metric` hook (bump a
   *      telemetry counter). Error returns skip both by design - we never
   *      broadcast a state change that didn't happen.
   *
   * Generic note: `isDOError(result)` narrows at runtime, but TS can't
   * propagate the negation through generic `R`, so we cast once to
   * `Exclude<R, DOError>` after the guard. The cast is safe because the guard
   * just ran; it stays local to this helper so call sites keep a clean
   * `R | DOError` signature.
   */
  #op<R>(
    agentId: string,
    ownerId: string | null,
    run: (resolved: string) => R,
    side: {
      broadcast?: (result: Exclude<R, DOError>, resolved: string) => Record<string, unknown> | null;
      broadcastOpts?: { invalidateCache?: boolean };
      metric?: (result: Exclude<R, DOError>) => string | null;
    } = {},
  ): R | DOError {
    return this.#withMember(agentId, ownerId, (resolved) => {
      const result = run(resolved);
      if (isDOError(result)) return result;
      const success = result as Exclude<R, DOError>;
      const event = side.broadcast?.(success, resolved);
      if (event) this.#broadcastToWatchers(event, side.broadcastOpts);
      const metric = side.metric?.(success);
      if (metric) this.#recordMetric(metric);
      return result;
    });
  }

  /**
   * Owner-scoped RPC wrapper for endpoints that do not resolve a specific
   * agent (dashboard/summary calls). Gates on the persistent roster
   * (`team_owners`), not presence (`members`) - an idle user with no live
   * agents is still a roster member and must be able to read summary data.
   * The roster row is added by `join` and removed only on explicit leave;
   * cleanup never touches it.
   */
  #withOwner<T>(ownerId: string, fn: () => T): T | DOError {
    this.#ensureSchema();
    const row = this.sql
      .exec('SELECT 1 FROM team_owners WHERE owner_id = ? LIMIT 1', ownerId)
      .toArray();
    if (row.length === 0) return { error: 'Not a member of this team', code: 'NOT_MEMBER' };
    return fn();
  }

  // --- Bound helper for submodules that need to record telemetry ---
  #boundRecordMetric = (metric: string): void => this.#recordMetric(metric);

  /** Dependency bag for the per-domain *-rpc modules - rebuilt per call so
   *  closures stay tied to live class state. Cheap: just an object literal
   *  with already-bound function references. */
  #rpcCtx(): RpcCtx {
    return {
      sql: this.sql,
      env: this.env,
      transact: this.#transact,
      ensureSchema: () => this.#ensureSchema(),
      recordMetric: (m) => this.#recordMetric(m),
      boundRecordMetric: this.#boundRecordMetric,
      withMember: (id, owner, fn) => this.#withMember(id, owner, fn),
      withOwner: (id, fn) => this.#withOwner(id, fn),
      op: (id, owner, run, side) => this.#op(id, owner, run, side),
      broadcastToWatchers: (e, o) => this.#broadcastToWatchers(e, o),
      broadcastToExecutors: (e) => this.#broadcastToExecutors(e),
      hasExecutorConnected: () => this.#hasExecutorConnected(),
      getAvailableSpawnTools: () => this.#getAvailableSpawnTools(),
      getConnectedAgentIds: () => this.#getConnectedAgentIds(),
      contextCache: this.#contextCache,
      lastHeartbeatBroadcast: this.#lastHeartbeatBroadcast,
      maybeCleanup: () => this.#maybeCleanup(),
    };
  }

  // -- Membership --

  async join(
    agentId: string,
    ownerId: string,
    ownerHandle: string,
    runtimeOrTool: string | Record<string, unknown> | null = 'unknown',
  ): Promise<DOResult<{ ok: true }>> {
    return rpcJoin(this.#rpcCtx(), agentId, ownerId, ownerHandle, runtimeOrTool);
  }

  async leave(agentId: string, ownerId: string | null = null): Promise<DOResult<{ ok: true }>> {
    return rpcLeave(this.#rpcCtx(), agentId, ownerId);
  }

  async heartbeat(
    agentId: string,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return rpcHeartbeat(this.#rpcCtx(), agentId, ownerId);
  }

  // -- Activity --

  async updateActivity(
    agentId: string,
    files: string[],
    summary: string,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return rpcUpdateActivity(this.#rpcCtx(), agentId, files, summary, ownerId);
  }

  async checkConflicts(
    agentId: string,
    files: string[],
    ownerId: string | null = null,
    source: 'hook' | 'advisory' = 'advisory',
  ): Promise<ReturnType<typeof checkConflictsFn> | DOError> {
    return rpcCheckConflicts(this.#rpcCtx(), agentId, files, ownerId, source);
  }

  async reportFile(
    agentId: string,
    filePath: string,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return rpcReportFile(this.#rpcCtx(), agentId, filePath, ownerId);
  }

  // -- Context (composite queries -- logic in context.ts) --

  async getContext(
    agentId: string,
    ownerId: string | null = null,
  ): Promise<Record<string, unknown> | DOError> {
    return rpcGetContext(this.#rpcCtx(), agentId, ownerId);
  }

  // -- Sessions (observability) --

  async startSession(
    agentId: string,
    handle: string,
    framework: string,
    runtime: Record<string, unknown> | null = null,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true; session_id: string }> | DOError> {
    return rpcStartSession(this.#rpcCtx(), agentId, handle, framework, runtime, ownerId);
  }

  async endSession(
    agentId: string,
    sessionId: string,
    ownerId: string | null = null,
  ): Promise<
    | DOResult<{ ok: true; outcome?: string | null; summary?: Record<string, unknown> | null }>
    | DOError
  > {
    return rpcEndSession(this.#rpcCtx(), agentId, sessionId, ownerId);
  }

  async recordEdit(
    agentId: string,
    filePath: string,
    linesAdded = 0,
    linesRemoved = 0,
    ownerId: string | null = null,
  ): Promise<{ ok: true; skipped?: boolean } | DOError> {
    return rpcRecordEdit(this.#rpcCtx(), agentId, filePath, linesAdded, linesRemoved, ownerId);
  }

  async reportOutcome(
    agentId: string,
    outcome: string,
    summary: string | null = null,
    ownerId: string | null = null,
    outcomeTags?: string[] | null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return rpcReportOutcome(this.#rpcCtx(), agentId, outcome, summary, ownerId, outcomeTags);
  }

  async getHistory(
    agentId: string,
    days: number,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof getSessionHistory> | DOError> {
    return rpcGetSessionHistory(this.#rpcCtx(), agentId, days, ownerId);
  }

  async getEditHistory(
    agentId: string,
    days: number,
    filePath: string | null = null,
    handle: string | null = null,
    limit = 200,
    ownerId: string | null = null,
  ): Promise<{ ok: true; edits: EditEntry[] } | DOError> {
    return rpcGetEditHistory(this.#rpcCtx(), agentId, days, filePath, handle, limit, ownerId);
  }

  async getAnalytics(
    agentId: string,
    days: number,
    ownerId: string | null = null,
    extended = false,
    tzOffsetMinutes: number = 0,
    scope: AnalyticsScope = {},
  ): Promise<
    ReturnType<typeof getAnalyticsFn> | ReturnType<typeof getExtendedAnalyticsFn> | DOError
  > {
    return rpcGetAnalytics(
      this.#rpcCtx(),
      agentId,
      days,
      ownerId,
      extended,
      tzOffsetMinutes,
      scope,
    );
  }

  async enrichModel(
    agentId: string,
    model: string,
    ownerId: string | null = null,
  ): Promise<{ ok: true } | DOError> {
    return rpcEnrichModel(this.#rpcCtx(), agentId, model, ownerId);
  }

  async recordTokenUsage(
    agentId: string,
    sessionId: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
    cacheCreationTokens: number,
    ownerId: string | null = null,
  ): Promise<{ ok: true } | DOError> {
    return rpcRecordTokenUsage(
      this.#rpcCtx(),
      agentId,
      sessionId,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      ownerId,
    );
  }

  async recordToolCalls(
    agentId: string,
    sessionId: string,
    handle: string,
    hostTool: string,
    calls: ToolCallInput[],
    ownerId: string | null = null,
  ): Promise<{ ok: true; recorded: number } | DOError> {
    return rpcRecordToolCalls(this.#rpcCtx(), agentId, sessionId, handle, hostTool, calls, ownerId);
  }

  async recordCommits(
    agentId: string,
    sessionId: string | null,
    handle: string,
    hostTool: string,
    commits: CommitInput[],
    ownerId: string | null = null,
  ): Promise<{ ok: true; recorded: number } | DOError> {
    return rpcRecordCommits(this.#rpcCtx(), agentId, sessionId, handle, hostTool, commits, ownerId);
  }

  // -- Conversation intelligence --

  async recordConversationEvents(
    agentId: string,
    sessionId: string,
    handle: string,
    hostTool: string,
    events: ConversationEventInput[],
    ownerId: string | null = null,
  ): Promise<{ ok: true; count: number } | DOError> {
    return rpcBatchRecordConversationEvents(
      this.#rpcCtx(),
      agentId,
      sessionId,
      handle,
      hostTool,
      events,
      ownerId,
    );
  }

  async getConversation(
    agentId: string,
    sessionId: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof getConversationForSessionFn> | DOError> {
    return rpcGetConversationForSession(this.#rpcCtx(), agentId, sessionId, ownerId);
  }

  async getConversationAnalytics(
    agentId: string,
    days: number,
    ownerId: string | null = null,
    scope: AnalyticsScope = {},
  ): Promise<ConversationAnalytics | DOError> {
    return rpcGetConversationAnalytics(this.#rpcCtx(), agentId, days, ownerId, scope);
  }

  async getSessionConversationStats(
    agentId: string,
    sessionIds: string[],
    ownerId: string | null = null,
  ): Promise<{ ok: true; stats: SessionConversationStats[] } | DOError> {
    return rpcGetSessionConversationStats(this.#rpcCtx(), agentId, sessionIds, ownerId);
  }

  // -- Memory --

  async saveMemory(
    agentId: string,
    text: string,
    tags: string[],
    categories: string[] | null = null,
    handle: string,
    runtime: Record<string, unknown> | null = null,
    ownerId: string | null = null,
    textHash: string | null = null,
    embedding: ArrayBuffer | null = null,
  ): Promise<ReturnType<typeof saveMemoryFn> | DOError> {
    return rpcSaveMemory(
      this.#rpcCtx(),
      agentId,
      text,
      tags,
      categories,
      handle,
      runtime,
      ownerId,
      textHash,
      embedding,
    );
  }

  async searchMemories(
    agentId: string,
    query: string | null,
    tags: string[] | null,
    categories: string[] | null = null,
    limit = 20,
    ownerId: string | null = null,
    filters: Omit<SearchFilters, 'query' | 'tags' | 'categories' | 'limit'> = {},
  ): Promise<ReturnType<typeof searchMemoriesFn> | DOError> {
    return rpcSearchMemories(
      this.#rpcCtx(),
      agentId,
      query,
      tags,
      categories,
      limit,
      ownerId,
      filters,
    );
  }

  async updateMemory(
    agentId: string,
    memoryId: string,
    text: string | undefined,
    tags: string[] | undefined,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return rpcUpdateMemory(this.#rpcCtx(), agentId, memoryId, text, tags, ownerId);
  }

  async deleteMemory(
    agentId: string,
    memoryId: string,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return rpcDeleteMemory(this.#rpcCtx(), agentId, memoryId, ownerId);
  }

  async deleteMemoriesBatch(
    agentId: string,
    filter: BatchDeleteFilter,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true; deleted: number }> | DOError> {
    return rpcDeleteMemoriesBatch(this.#rpcCtx(), agentId, filter, ownerId);
  }

  // -- Memory Consolidation (review queue, propose-only, reversible) --

  async runConsolidation(): Promise<ReturnType<typeof consolidateMemoriesFn>> {
    return rpcConsolidateMemories(this.#rpcCtx());
  }

  async listConsolidationProposals(
    agentId: string,
    limit: number = 50,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof listConsolidationProposalsFn> | DOError> {
    return rpcListConsolidationProposals(this.#rpcCtx(), agentId, limit, ownerId);
  }

  async applyConsolidationProposal(
    agentId: string,
    proposalId: string,
    reviewerHandle: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof applyConsolidationProposalFn> | DOError> {
    return rpcApplyConsolidationProposal(
      this.#rpcCtx(),
      agentId,
      proposalId,
      reviewerHandle,
      ownerId,
    );
  }

  async rejectConsolidationProposal(
    agentId: string,
    proposalId: string,
    reviewerHandle: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof rejectConsolidationProposalFn> | DOError> {
    return rpcRejectConsolidationProposal(
      this.#rpcCtx(),
      agentId,
      proposalId,
      reviewerHandle,
      ownerId,
    );
  }

  async unmergeMemory(
    agentId: string,
    memoryId: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof unmergeMemoryFn> | DOError> {
    return rpcUnmergeMemory(this.#rpcCtx(), agentId, memoryId, ownerId);
  }

  // -- Formation (shadow-mode auditor: classifies but never applies) --

  async runFormationOnRecent(
    limit: number = 20,
  ): Promise<{ ok: true; processed: number; skipped: number }> {
    return rpcRunFormationOnRecent(this.#rpcCtx(), limit);
  }

  async runFormationOnMemory(memoryId: string): Promise<{ ok: true }> {
    return rpcRunFormationPass(this.#rpcCtx(), memoryId);
  }

  async listFormationObservations(
    agentId: string,
    filter: { recommendation?: FormationRecommendation; limit?: number } = {},
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof listFormationObservationsFn> | DOError> {
    return rpcListFormationObservations(this.#rpcCtx(), agentId, filter, ownerId);
  }

  // -- Memory Categories --

  async createCategory(
    agentId: string,
    name: string,
    description: string,
    color: string | null = null,
    embedding: ArrayBuffer | null = null,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true; id: string }> | DOError> {
    return rpcCreateCategory(this.#rpcCtx(), agentId, name, description, color, embedding, ownerId);
  }

  async listCategories(
    agentId: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof listCategoriesFn> | DOError> {
    return rpcListCategories(this.#rpcCtx(), agentId, ownerId);
  }

  async getCategoryNames(
    agentId: string,
    ownerId: string | null = null,
  ): Promise<{ ok: true; names: string[] } | DOError> {
    return rpcGetCategoryNames(this.#rpcCtx(), agentId, ownerId);
  }

  async updateCategory(
    agentId: string,
    categoryId: string,
    name: string | undefined,
    description: string | undefined,
    color: string | undefined,
    embedding: ArrayBuffer | null | undefined,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return rpcUpdateCategory(
      this.#rpcCtx(),
      agentId,
      categoryId,
      name,
      description,
      color,
      embedding,
      ownerId,
    );
  }

  async deleteCategory(
    agentId: string,
    categoryId: string,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return rpcDeleteCategory(this.#rpcCtx(), agentId, categoryId, ownerId);
  }

  async getPromotableTags(
    agentId: string,
    threshold: number,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof getPromotableTagsFn> | DOError> {
    return rpcGetPromotableTags(this.#rpcCtx(), agentId, threshold, ownerId);
  }

  // -- File Locks --

  async claimFiles(
    agentId: string,
    files: string[],
    handle: string,
    runtimeOrTool: string | Record<string, unknown> | null | undefined,
    ownerId: string | null = null,
    options: { ttlSeconds?: number } = {},
  ): Promise<ReturnType<typeof claimFilesFn> | DOError> {
    return rpcClaimFiles(this.#rpcCtx(), agentId, files, handle, runtimeOrTool, ownerId, options);
  }

  /**
   * Read-only conflict check for a batch of concrete paths. Used by the
   * pre-commit hook and any would-be-editor that wants to know whether
   * proceeding would collide with a peer's lock (exact-path or glob
   * umbrella) without actually claiming. Globs in the input are skipped.
   */
  async checkFileConflicts(
    agentId: string,
    files: string[],
    ownerId: string | null = null,
  ): Promise<{ ok: true; blocked: ReturnType<typeof checkFileConflictsFn> } | DOError> {
    return rpcCheckFileConflicts(this.#rpcCtx(), agentId, files, ownerId);
  }

  async releaseFiles(
    agentId: string,
    files: string[] | null | undefined,
    ownerId: string | null = null,
  ): Promise<{ ok: true } | DOError> {
    return rpcReleaseFiles(this.#rpcCtx(), agentId, files, ownerId);
  }

  async getLockedFiles(
    agentId: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof getLockedFilesFn> | DOError> {
    return rpcGetLockedFiles(this.#rpcCtx(), agentId, ownerId);
  }

  // -- Messages --

  async sendMessage(
    agentId: string,
    handle: string,
    runtimeOrTool: string | Record<string, unknown> | null | undefined,
    text: string,
    targetAgent: string | null | undefined,
    ownerId: string | null = null,
  ): Promise<{ ok: true; id: string } | DOError> {
    return rpcSendMessage(
      this.#rpcCtx(),
      agentId,
      handle,
      runtimeOrTool,
      text,
      targetAgent,
      ownerId,
    );
  }

  async getMessages(
    agentId: string,
    since: string | null | undefined,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof getMessagesFn> | DOError> {
    return rpcGetMessages(this.#rpcCtx(), agentId, since, ownerId);
  }

  // -- Commands (daemon relay) --

  async submitCommand(
    agentId: string,
    ownerId: string,
    senderHandle: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<{ ok: true; id: string; warning?: string } | DOError> {
    return rpcSubmitCommand(this.#rpcCtx(), agentId, ownerId, senderHandle, type, payload);
  }

  async getCommands(
    agentId: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof getPendingCommandsFn> | DOError> {
    return rpcGetPendingCommands(this.#rpcCtx(), agentId, ownerId);
  }

  // -- Session timeline (individual session records for swimlane visualization) --

  async getSessionsInRange(
    ownerId: string,
    fromDate: string,
    toDate: string,
    filters?: { hostTool?: string; handle?: string },
  ): Promise<
    { ok: true; sessions: SessionRecord[]; truncated: boolean; total_sessions: number } | DOError
  > {
    return rpcGetSessionsInRange(this.#rpcCtx(), ownerId, fromDate, toDate, filters);
  }

  // -- Extended analytics (cross-project dashboard) --

  async getAnalyticsForOwner(
    ownerId: string,
    days: number,
    tzOffsetMinutes: number = 0,
    scope: AnalyticsScope = {},
  ): Promise<ReturnType<typeof getExtendedAnalyticsFn> | DOError> {
    return rpcGetAnalyticsForOwner(this.#rpcCtx(), ownerId, days, tzOffsetMinutes, scope);
  }

  // -- Summary (lightweight, for cross-project dashboard) --

  async getSummary(ownerId: string): Promise<ReturnType<typeof queryTeamSummary> | DOError> {
    return rpcGetSummary(this.#rpcCtx(), ownerId);
  }

  // -- Billing blocks (5h Anthropic rate-limit windows) --

  /**
   * Return the caller's billing-block history for this team's sessions.
   * Scoped by `ownerId` (the caller's user id) so a single user gets
   * their own window state regardless of which agent they were using -
   * the Anthropic limit is billed to the account, not the session.
   *
   * When chinmeister eventually grows a cross-team aggregator for Pro
   * windows, this DO method is the per-team primitive it should call.
   * Today, multi-team users get per-team views; the algorithm itself
   * works on any pre-collected event stream so merging across teams is
   * a route-level concern, not a DO change.
   */
  async getBillingBlocks(
    ownerId: string,
  ): Promise<ReturnType<typeof getBillingBlocksForOwnerFn> | DOError> {
    return rpcGetBillingBlocks(this.#rpcCtx(), ownerId);
  }

  // -- Per-user data export and erasure (GDPR Art. 15 / Art. 17) --
  //
  // Both methods take the caller's handle (not just owner_id) because every
  // per-user table in the team schema carries handle as the user-facing
  // identifier. Owner_id is used to gate the call (the caller must be on
  // the team) but the filter is by handle.

  async exportUserData(
    ownerId: string,
    handle: string,
  ): Promise<DOResult<{ ok: true; data: UserDataExport }>> {
    return rpcExportUserData(this.#rpcCtx(), ownerId, handle);
  }

  async deleteUserData(
    ownerId: string,
    handle: string,
  ): Promise<DOResult<{ ok: true; result: UserDataDeletionResult }>> {
    return rpcDeleteUserData(this.#rpcCtx(), ownerId, handle);
  }
}

// Re-export path utility for consumers
export { normalizePath } from '../../lib/text-utils.js';
