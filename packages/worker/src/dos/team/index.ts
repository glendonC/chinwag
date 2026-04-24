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
// This file owns: the DurableObject class shell, WebSocket method entry
// points, instance-scoped caches (context, heartbeat debounce, cleanup
// clock), the identity/member/op/owner wrappers that every RPC flows
// through, and the public RPC surface itself.
//
// Deferred: per ANALYTICS_SPEC.md, a further split pulls the ~40 RPC
// method bodies out into per-domain *-rpc modules, leaving this file as
// a thin facade (~200 LoC). That refactor is mechanical but touches
// every call site and the hibernation-sensitive class boundary, so it's
// intentionally held for a dedicated session rather than bundled with
// unrelated work. See the research plan for the 6-step extraction order
// (wrappers → membership-handler → context-handler → commands-handler →
// per-domain RPC modules → final cleanup).

import { DurableObject } from 'cloudflare:workers';
import type { Env, DOResult, DOError, TeamContext } from '../../types.js';
import { isDOError } from '../../lib/errors.js';

import { ensureSchema } from './schema.js';
import { queryTeamContext, queryTeamSummary } from './context.js';
import { resolveOwnedAgentId } from './identity.js';
import { runCleanup, collectHandleBackfills, type OrphanSummary } from './cleanup.js';
import { join, leave, heartbeat as heartbeatFn } from './membership.js';
import {
  updateActivity as updateActivityFn,
  checkConflicts as checkConflictsFn,
  reportFile as reportFileFn,
} from './activity.js';
import {
  saveMemory as saveMemoryFn,
  searchMemories as searchMemoriesFn,
  updateMemory as updateMemoryFn,
  deleteMemory as deleteMemoryFn,
  deleteMemoriesBatch as deleteMemoriesBatchFn,
  type SearchFilters,
  type BatchDeleteFilter,
} from './memory.js';
import {
  consolidateMemories as consolidateMemoriesFn,
  listConsolidationProposals as listConsolidationProposalsFn,
  applyConsolidationProposal as applyConsolidationProposalFn,
  rejectConsolidationProposal as rejectConsolidationProposalFn,
  unmergeMemory as unmergeMemoryFn,
} from './consolidation.js';
import {
  runFormationPass as runFormationPassFn,
  runFormationOnRecent as runFormationOnRecentFn,
  listFormationObservations as listFormationObservationsFn,
  type FormationRecommendation,
} from './formation.js';
import {
  createCategory as createCategoryFn,
  listCategories as listCategoriesFn,
  updateCategory as updateCategoryFn,
  deleteCategory as deleteCategoryFn,
  getCategoryNames as getCategoryNamesFn,
  getPromotableTags as getPromotableTagsFn,
} from './categories.js';
import {
  claimFiles as claimFilesFn,
  checkFileConflicts as checkFileConflictsFn,
  releaseFiles as releaseFilesFn,
  getLockedFiles as getLockedFilesFn,
} from './locks.js';
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
  bumpActiveTime,
} from './sessions.js';
import type { EditEntry, SessionRecord } from './sessions.js';
import {
  getAnalytics as getAnalyticsFn,
  getExtendedAnalytics as getExtendedAnalyticsFn,
} from './analytics/index.js';
import { getBillingBlocksForOwner as getBillingBlocksForOwnerFn } from './analytics/billing-blocks.js';
import { sendMessage as sendMessageFn, getMessages as getMessagesFn } from './messages.js';
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
import {
  submitCommand as submitCommandFn,
  getPendingCommands as getPendingCommandsFn,
} from './commands.js';
import { normalizeRuntimeMetadata } from './runtime.js';
import {
  enrichAnalyticsWithPricing,
  enrichDailyTrendsWithPricing,
  enrichPeriodComparisonCost,
} from '../../lib/pricing-enrich.js';
import { queryDailyTokenUsage, queryTokenAggregateForWindow } from './analytics/tokens.js';
import {
  CONTEXT_CACHE_TTL_MS,
  CLEANUP_INTERVAL_MS,
  HEARTBEAT_BROADCAST_DEBOUNCE_MS,
  METRIC_KEYS,
} from '../../lib/constants.js';
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
import {
  type RpcCtx,
  withMember as withMemberFn,
  withOwner as withOwnerFn,
  op as opFn,
} from './rpc-context.js';
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

  /** Dependency bag for the WebSocket handlers — rebuilt per call so closures
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

  /** Dependency bag for RPC handlers. Same per-call literal pattern as
   *  `#wsCtx()` — keeps closures tied to live class state. */
  #rpcCtx(): RpcCtx {
    return {
      sql: this.sql,
      ensureSchema: () => this.#ensureSchema(),
      transact: this.#transact,
      resolveOwnedAgentId: (id, ownerId) => this.#resolveOwnedAgentId(id, ownerId),
      broadcastToWatchers: (event, opts) => this.#broadcastToWatchers(event, opts),
      recordMetric: (metric) => this.#recordMetric(metric),
    };
  }

  // -- Internal helpers --

  /** Agent IDs with an active 'role:agent' WebSocket connection. */
  #getConnectedAgentIds(): Set<string> {
    return getConnectedAgentIds(this.ctx);
  }

  /** All member IDs with any active WebSocket (agent, watcher, daemon).
   *  Used for cleanup eviction protection — any connected socket keeps
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
  //   2. Orphan close (this sweep — for MCP crashes / hard Ctrl+C)
  //   3. Historical backfill (this sweep — self-heals pre-fix drift and any
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
    // for the missing handles only. Idempotent — a handle that already has a
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
   * daily_metrics. No member resolution needed — the route already
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

  // -- RPC wrappers --
  //
  // Thin delegators over the free functions in rpc-context.ts. Kept as
  // private methods so the existing ~40 RPC method bodies keep their
  // `this.#withMember(...)` / `this.#withOwner(...)` / `this.#op(...)`
  // calls unchanged until per-domain extraction moves them out of the
  // class entirely.

  #withMember<T>(
    agentId: string,
    ownerId: string | null,
    fn: (resolved: string) => T,
  ): T | DOError {
    return withMemberFn(this.#rpcCtx(), agentId, ownerId, fn);
  }

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
    return opFn(this.#rpcCtx(), agentId, ownerId, run, side);
  }

  #withOwner<T>(ownerId: string, fn: () => T): T | DOError {
    return withOwnerFn(this.#rpcCtx(), ownerId, fn);
  }

  // --- Bound helper for submodules that need to record telemetry ---
  #boundRecordMetric = (metric: string): void => this.#recordMetric(metric);

  // -- Membership --

  async join(
    agentId: string,
    ownerId: string,
    ownerHandle: string,
    runtimeOrTool: string | Record<string, unknown> | null = 'unknown',
  ): Promise<DOResult<{ ok: true }>> {
    this.#ensureSchema();
    const result = join(
      this.sql,
      agentId,
      ownerId,
      ownerHandle,
      runtimeOrTool,
      this.#boundRecordMetric,
    );
    if (!isDOError(result)) {
      const tool = normalizeRuntimeMetadata(runtimeOrTool, agentId).hostTool;
      this.#broadcastToWatchers({
        type: 'member_joined',
        agent_id: agentId,
        handle: ownerHandle,
        tool: tool || 'unknown',
      });
    }
    return result;
  }

  async leave(agentId: string, ownerId: string | null = null): Promise<DOResult<{ ok: true }>> {
    this.#ensureSchema();
    const result = leave(this.sql, agentId, ownerId, this.#transact);
    if (!isDOError(result)) {
      this.#lastHeartbeatBroadcast.delete(agentId);
      this.#broadcastToWatchers({ type: 'member_left', agent_id: agentId });
    }
    return result;
  }

  async heartbeat(
    agentId: string,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return this.#withMember(agentId, ownerId, (resolved) => {
      const result = heartbeatFn(this.sql, resolved);
      if (!isDOError(result)) {
        const now = Date.now();
        const last = this.#lastHeartbeatBroadcast.get(resolved) || 0;
        if (now - last >= HEARTBEAT_BROADCAST_DEBOUNCE_MS) {
          this.#lastHeartbeatBroadcast.set(resolved, now);
          this.#broadcastToWatchers(
            { type: 'heartbeat', agent_id: resolved, ts: now },
            { invalidateCache: false },
          );
        }
      }
      return result;
    });
  }

  // -- Activity --

  async updateActivity(
    agentId: string,
    files: string[],
    summary: string,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return this.#op(
      agentId,
      ownerId,
      (resolved) => updateActivityFn(this.sql, resolved, files, summary, this.#transact),
      {
        broadcast: (_r, resolved) => ({ type: 'activity', agent_id: resolved, files, summary }),
      },
    );
  }

  async checkConflicts(
    agentId: string,
    files: string[],
    ownerId: string | null = null,
    source: 'hook' | 'advisory' = 'advisory',
  ): Promise<ReturnType<typeof checkConflictsFn> | DOError> {
    return this.#withMember(agentId, ownerId, (resolved) =>
      checkConflictsFn(
        this.sql,
        resolved,
        files,
        this.#boundRecordMetric,
        this.#getConnectedAgentIds(),
        source,
      ),
    );
  }

  async reportFile(
    agentId: string,
    filePath: string,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return this.#op(
      agentId,
      ownerId,
      (resolved) => reportFileFn(this.sql, resolved, filePath, this.#transact),
      {
        broadcast: (_r, resolved) => ({ type: 'file', agent_id: resolved, file: filePath }),
      },
    );
  }

  // -- Context (composite queries -- logic in context.ts) --

  async getContext(
    agentId: string,
    ownerId: string | null = null,
  ): Promise<Record<string, unknown> | DOError> {
    return this.#withMember(agentId, ownerId, (resolved) => {
      // Always bump calling agent's heartbeat
      this.sql.exec(
        "UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?",
        resolved,
      );

      // Per-agent messages (always fresh -- has target_agent filter, can't be cached team-wide)
      const messages = this.sql
        .exec(
          `SELECT handle AS from_handle, host_tool AS from_tool, host_tool AS from_host_tool, agent_surface AS from_agent_surface, text, created_at
         FROM messages
         WHERE created_at > datetime('now', '-1 hour')
           AND (target_agent IS NULL OR target_agent = ?)
         ORDER BY created_at DESC LIMIT 10`,
          resolved,
        )
        .toArray();

      // Daemon status — always fresh (computed from live WebSocket connections)
      const daemon = {
        connected: this.#hasExecutorConnected(),
        available_tools: this.#getAvailableSpawnTools(),
      };

      // Return cached team-wide context if fresh
      const cached = this.#contextCache.get();
      if (cached) {
        return { ...cached, messages, daemon };
      }

      this.#maybeCleanup();

      const connectedIds = this.#getConnectedAgentIds();
      const teamContext = queryTeamContext(this.sql, connectedIds);

      this.#contextCache.set(teamContext);

      return { ...teamContext, messages, daemon };
    });
  }

  // -- Sessions (observability) --

  async startSession(
    agentId: string,
    handle: string,
    framework: string,
    runtime: Record<string, unknown> | null = null,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true; session_id: string }> | DOError> {
    return this.#op(
      agentId,
      ownerId,
      (resolved) => startSessionFn(this.sql, resolved, handle, framework, runtime, this.#transact),
      {
        metric: () => 'sessions_started',
      },
    );
  }

  async endSession(
    agentId: string,
    sessionId: string,
    ownerId: string | null = null,
  ): Promise<
    | DOResult<{ ok: true; outcome?: string | null; summary?: Record<string, unknown> | null }>
    | DOError
  > {
    return this.#op(agentId, ownerId, (resolved) => endSessionFn(this.sql, resolved, sessionId), {
      metric: (r) => (r.outcome ? `outcome:${r.outcome}` : null),
    });
  }

  async recordEdit(
    agentId: string,
    filePath: string,
    linesAdded = 0,
    linesRemoved = 0,
    ownerId: string | null = null,
  ): Promise<{ ok: true; skipped?: boolean } | DOError> {
    return this.#withMember(agentId, ownerId, (resolved) =>
      recordEditFn(this.sql, resolved, filePath, linesAdded, linesRemoved),
    );
  }

  async reportOutcome(
    agentId: string,
    outcome: string,
    summary: string | null = null,
    ownerId: string | null = null,
    outcomeTags?: string[] | null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return this.#withMember(agentId, ownerId, (resolved) =>
      reportOutcomeFn(this.sql, resolved, outcome, summary, outcomeTags),
    );
  }

  async getHistory(
    agentId: string,
    days: number,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof getSessionHistory> | DOError> {
    return this.#withMember(agentId, ownerId, () => getSessionHistory(this.sql, days));
  }

  async getEditHistory(
    agentId: string,
    days: number,
    filePath: string | null = null,
    handle: string | null = null,
    limit = 200,
    ownerId: string | null = null,
  ): Promise<{ ok: true; edits: EditEntry[] } | DOError> {
    return this.#withMember(agentId, ownerId, () =>
      getEditHistoryFn(this.sql, days, filePath, handle, limit),
    );
  }

  async getAnalytics(
    agentId: string,
    days: number,
    ownerId: string | null = null,
    extended = false,
    tzOffsetMinutes: number = 0,
  ): Promise<
    ReturnType<typeof getAnalyticsFn> | ReturnType<typeof getExtendedAnalyticsFn> | DOError
  > {
    const raw = this.#withMember(agentId, ownerId, () =>
      extended
        ? getExtendedAnalyticsFn(this.sql, days, tzOffsetMinutes)
        : getAnalyticsFn(this.sql, days, tzOffsetMinutes),
    );
    if (isDOError(raw)) return raw;
    // Enrich token_usage with cost from the isolate pricing cache. This hits
    // DatabaseDO at most once per TTL window (5 min) rather than per request.
    const enriched = await enrichAnalyticsWithPricing(raw, this.env);
    // Per-day cost on daily_trends: same pricing snapshot, one extra SQL
    // aggregate. Fills the Trend widget's cost and cost-per-edit lines with
    // honest per-day numbers instead of the "daily cost not captured"
    // placeholder. Reliability gates mirror the period total.
    const dailyTokens = queryDailyTokenUsage(this.sql, days, tzOffsetMinutes);
    await enrichDailyTrendsWithPricing(enriched.daily_trends, dailyTokens, this.env);
    // Period-comparison cost: price both windows against the CURRENT pricing
    // snapshot so the cost-per-edit delta shown by CostPerEditWidget reflects
    // behavior change, not price drift. Previous-window aggregate falls to
    // empty when outside retention (30d default), which computeWindowCost
    // maps to a null cost — StatWidget's delta gate then skips rendering.
    const currentAgg = queryTokenAggregateForWindow(this.sql, days, 0);
    const previousAgg = queryTokenAggregateForWindow(this.sql, days * 2, days);
    await enrichPeriodComparisonCost(enriched, currentAgg, previousAgg, this.env);
    return enriched;
  }

  async enrichModel(
    agentId: string,
    model: string,
    ownerId: string | null = null,
  ): Promise<{ ok: true } | DOError> {
    return this.#withMember(agentId, ownerId, (resolved) =>
      enrichSessionModelFn(this.sql, resolved, model, this.#boundRecordMetric, this.#transact),
    );
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
    return this.#withMember(agentId, ownerId, (resolved) =>
      recordTokenUsageFn(
        this.sql,
        resolved,
        sessionId,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
      ),
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
    return this.#withMember(agentId, ownerId, (resolved) =>
      recordToolCallsFn(this.sql, resolved, sessionId, handle, hostTool, calls),
    );
  }

  async recordCommits(
    agentId: string,
    sessionId: string | null,
    handle: string,
    hostTool: string,
    commits: CommitInput[],
    ownerId: string | null = null,
  ): Promise<{ ok: true; recorded: number } | DOError> {
    return this.#withMember(agentId, ownerId, (resolved) =>
      recordCommitsFn(this.sql, resolved, sessionId, handle, hostTool, commits),
    );
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
    return this.#op(
      agentId,
      ownerId,
      () =>
        batchRecordConversationEventsFn(
          this.sql,
          sessionId,
          agentId,
          handle,
          hostTool,
          events,
          this.#transact,
        ),
      {
        metric: () => 'conversation_events_recorded',
      },
    );
  }

  async getConversation(
    agentId: string,
    sessionId: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof getConversationForSessionFn> | DOError> {
    return this.#withMember(agentId, ownerId, () =>
      getConversationForSessionFn(this.sql, sessionId),
    );
  }

  async getConversationAnalytics(
    agentId: string,
    days: number,
    ownerId: string | null = null,
  ): Promise<ConversationAnalytics | DOError> {
    return this.#withMember(agentId, ownerId, () => getConversationAnalyticsFn(this.sql, days));
  }

  async getSessionConversationStats(
    agentId: string,
    sessionIds: string[],
    ownerId: string | null = null,
  ): Promise<{ ok: true; stats: SessionConversationStats[] } | DOError> {
    return this.#withMember(agentId, ownerId, () => ({
      ok: true as const,
      stats: getSessionConversationStatsFn(this.sql, sessionIds),
    }));
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
    // DUPLICATE results carry `error: string`, so #op's isDOError guard skips
    // the broadcast for them automatically — no explicit filter needed here.
    return this.#op(
      agentId,
      ownerId,
      (resolved) =>
        saveMemoryFn(
          this.sql,
          resolved,
          text,
          tags,
          categories,
          handle,
          runtime,
          this.#boundRecordMetric,
          this.#transact,
          textHash,
          embedding,
        ),
      {
        broadcast: () => ({ type: 'memory', text, tags }),
      },
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
    return this.#withMember(agentId, ownerId, (resolved) => {
      const result = searchMemoriesFn(this.sql, { query, tags, categories, limit, ...filters });
      this.#recordMetric(METRIC_KEYS.MEMORIES_SEARCHED);
      // Bump active_min on memory searches too. An agent doing pure research
      // (grep memory, read, grep memory, read) would otherwise register zero
      // active time even though it's working.
      bumpActiveTime(this.sql, resolved);
      // Increment per-session memory search counter
      this.sql.exec(
        `UPDATE sessions SET memories_searched = memories_searched + 1 WHERE agent_id = ? AND ended_at IS NULL`,
        resolved,
      );
      if ('ok' in result && result.memories && result.memories.length > 0) {
        this.#recordMetric(METRIC_KEYS.MEMORIES_SEARCH_HITS);
        this.sql.exec(
          `UPDATE sessions SET memories_search_hits = memories_search_hits + 1 WHERE agent_id = ? AND ended_at IS NULL`,
          resolved,
        );
      }
      return result;
    });
  }

  async updateMemory(
    agentId: string,
    memoryId: string,
    text: string | undefined,
    tags: string[] | undefined,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return this.#withMember(agentId, ownerId, (resolved) =>
      updateMemoryFn(this.sql, resolved, memoryId, text, tags),
    );
  }

  async deleteMemory(
    agentId: string,
    memoryId: string,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return this.#withMember(agentId, ownerId, () => deleteMemoryFn(this.sql, memoryId));
  }

  async deleteMemoriesBatch(
    agentId: string,
    filter: BatchDeleteFilter,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true; deleted: number }> | DOError> {
    return this.#withMember(agentId, ownerId, () =>
      deleteMemoriesBatchFn(this.sql, filter, this.#transact),
    );
  }

  // -- Memory Consolidation (review queue, propose-only, reversible) --

  async runConsolidation(): Promise<ReturnType<typeof consolidateMemoriesFn>> {
    return consolidateMemoriesFn(this.sql);
  }

  async listConsolidationProposals(
    agentId: string,
    limit: number = 50,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof listConsolidationProposalsFn> | DOError> {
    return this.#withMember(agentId, ownerId, () => listConsolidationProposalsFn(this.sql, limit));
  }

  async applyConsolidationProposal(
    agentId: string,
    proposalId: string,
    reviewerHandle: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof applyConsolidationProposalFn> | DOError> {
    return this.#withMember(agentId, ownerId, () =>
      applyConsolidationProposalFn(this.sql, proposalId, reviewerHandle),
    );
  }

  async rejectConsolidationProposal(
    agentId: string,
    proposalId: string,
    reviewerHandle: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof rejectConsolidationProposalFn> | DOError> {
    return this.#withMember(agentId, ownerId, () =>
      rejectConsolidationProposalFn(this.sql, proposalId, reviewerHandle),
    );
  }

  async unmergeMemory(
    agentId: string,
    memoryId: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof unmergeMemoryFn> | DOError> {
    return this.#withMember(agentId, ownerId, () => unmergeMemoryFn(this.sql, memoryId));
  }

  // -- Formation (shadow-mode auditor: classifies but never applies) --

  async runFormationOnRecent(
    limit: number = 20,
  ): Promise<{ ok: true; processed: number; skipped: number }> {
    const result = await runFormationOnRecentFn(this.sql, this.env, limit);
    return { ok: true, ...result };
  }

  async runFormationOnMemory(memoryId: string): Promise<{ ok: true }> {
    await runFormationPassFn(this.sql, this.env, memoryId);
    return { ok: true };
  }

  async listFormationObservations(
    agentId: string,
    filter: { recommendation?: FormationRecommendation; limit?: number } = {},
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof listFormationObservationsFn> | DOError> {
    return this.#withMember(agentId, ownerId, () => listFormationObservationsFn(this.sql, filter));
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
    return this.#withMember(agentId, ownerId, () =>
      createCategoryFn(this.sql, name, description, color, embedding),
    );
  }

  async listCategories(
    agentId: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof listCategoriesFn> | DOError> {
    return this.#withMember(agentId, ownerId, () => listCategoriesFn(this.sql));
  }

  async getCategoryNames(
    agentId: string,
    ownerId: string | null = null,
  ): Promise<{ ok: true; names: string[] } | DOError> {
    return this.#withMember(agentId, ownerId, () => ({
      ok: true as const,
      names: getCategoryNamesFn(this.sql),
    }));
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
    return this.#withMember(agentId, ownerId, () =>
      updateCategoryFn(this.sql, categoryId, name, description, color, embedding),
    );
  }

  async deleteCategory(
    agentId: string,
    categoryId: string,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return this.#withMember(agentId, ownerId, () => deleteCategoryFn(this.sql, categoryId));
  }

  async getPromotableTags(
    agentId: string,
    threshold: number,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof getPromotableTagsFn> | DOError> {
    return this.#withMember(agentId, ownerId, () => getPromotableTagsFn(this.sql, threshold));
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
    return this.#op(
      agentId,
      ownerId,
      (resolved) =>
        claimFilesFn(this.sql, resolved, files, handle, runtimeOrTool, ownerId!, options),
      {
        broadcast: (_r, resolved) => ({
          type: 'lock_change',
          action: 'claim',
          agent_id: resolved,
          files,
        }),
      },
    );
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
    return this.#withMember(agentId, ownerId, (resolved) => ({
      ok: true,
      blocked: checkFileConflictsFn(this.sql, resolved, files),
    }));
  }

  async releaseFiles(
    agentId: string,
    files: string[] | null | undefined,
    ownerId: string | null = null,
  ): Promise<{ ok: true } | DOError> {
    return this.#op(
      agentId,
      ownerId,
      (resolved) => releaseFilesFn(this.sql, resolved, files, ownerId),
      {
        broadcast: (_r, resolved) => ({
          type: 'lock_change',
          action: 'release',
          agent_id: resolved,
          files,
        }),
      },
    );
  }

  async getLockedFiles(
    agentId: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof getLockedFilesFn> | DOError> {
    return this.#withMember(agentId, ownerId, () =>
      getLockedFilesFn(this.sql, this.#getConnectedAgentIds()),
    );
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
    return this.#op(
      agentId,
      ownerId,
      (resolved) =>
        sendMessageFn(
          this.sql,
          resolved,
          handle,
          runtimeOrTool,
          text,
          targetAgent,
          this.#boundRecordMetric,
        ),
      {
        broadcast: () => ({ type: 'message', from_handle: handle, text }),
      },
    );
  }

  async getMessages(
    agentId: string,
    since: string | null | undefined,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof getMessagesFn> | DOError> {
    return this.#withMember(agentId, ownerId, (resolved) =>
      getMessagesFn(this.sql, resolved, since),
    );
  }

  // -- Commands (daemon relay) --

  async submitCommand(
    agentId: string,
    ownerId: string,
    senderHandle: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<{ ok: true; id: string; warning?: string } | DOError> {
    return this.#withMember(agentId, ownerId, () => {
      const result = submitCommandFn(
        this.sql,
        type,
        payload,
        ownerId,
        senderHandle,
        this.#boundRecordMetric,
      );
      if (isDOError(result)) return result;

      this.#broadcastToExecutors({
        type: 'command',
        id: result.id,
        command_type: type,
        payload,
      });
      this.#broadcastToWatchers({
        type: 'command_status',
        id: result.id,
        status: 'pending',
        command_type: type,
        sender_handle: senderHandle,
      });

      const warning = this.#hasExecutorConnected() ? undefined : 'no_executor_connected';
      return { ...result, ...(warning ? { warning } : {}) };
    });
  }

  async getCommands(
    agentId: string,
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof getPendingCommandsFn> | DOError> {
    return this.#withMember(agentId, ownerId, () => getPendingCommandsFn(this.sql));
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
    return this.#withOwner(ownerId, () => {
      const result = getSessionsInRangeFn(this.sql, fromDate, toDate, filters);
      return { ok: true as const, ...result };
    });
  }

  // -- Extended analytics (cross-project dashboard) --

  async getAnalyticsForOwner(
    ownerId: string,
    days: number,
    tzOffsetMinutes: number = 0,
  ): Promise<ReturnType<typeof getExtendedAnalyticsFn> | DOError> {
    const gate = this.#withOwner(ownerId, () =>
      getExtendedAnalyticsFn(this.sql, days, tzOffsetMinutes),
    );
    if (isDOError(gate)) return gate;
    const enriched = await enrichAnalyticsWithPricing(gate, this.env);
    const dailyTokens = queryDailyTokenUsage(this.sql, days, tzOffsetMinutes);
    await enrichDailyTrendsWithPricing(enriched.daily_trends, dailyTokens, this.env);
    // Same period-comparison cost enrichment as getAnalytics. Each team
    // ships its own cost/edits in period_comparison; the cross-team route
    // then sums them null-stickily and re-derives cost_per_edit on the
    // merged totals (daily-trends pattern) instead of averaging ratios.
    const currentAgg = queryTokenAggregateForWindow(this.sql, days, 0);
    const previousAgg = queryTokenAggregateForWindow(this.sql, days * 2, days);
    await enrichPeriodComparisonCost(enriched, currentAgg, previousAgg, this.env);
    return enriched;
  }

  // -- Summary (lightweight, for cross-project dashboard) --

  async getSummary(ownerId: string): Promise<ReturnType<typeof queryTeamSummary> | DOError> {
    return this.#withOwner(ownerId, () => {
      this.#maybeCleanup();
      return queryTeamSummary(this.sql);
    });
  }

  // -- Billing blocks (5h Anthropic rate-limit windows) --

  /**
   * Return the caller's billing-block history for this team's sessions.
   * Scoped by `ownerId` (the caller's user id) so a single user gets
   * their own window state regardless of which agent they were using —
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
    return this.#withOwner(ownerId, () => getBillingBlocksForOwnerFn(this.sql, ownerId));
  }
}

// Re-export path utility for consumers
export { normalizePath } from '../../lib/text-utils.js';
