// Team Durable Object -- one instance per team.
// Manages team membership, activity tracking, file conflict detection,
// shared project memory, and session history (observability).
//
// Business logic is split into submodules:
//   schema.ts      -- DDL, migrations, index creation
//   context.ts     -- composite read queries (getContext, getSummary)
//   identity.ts    -- agent ID resolution and ownership verification
//   cleanup.ts     -- stale member eviction and data pruning
//   membership.ts, activity.ts, memory.ts, locks.ts, sessions.ts, messages.ts -- domain logic
//   runtime.ts     -- agent ID / host tool inference
//
// This file owns the class shell, WebSocket handling, caching, and the
// thin RPC wrappers that tie it all together.

import { DurableObject } from 'cloudflare:workers';
import type { Env, DOResult, DOError, TeamContext } from '../../types.js';
import { getErrorMessage, isDOError } from '../../lib/errors.js';
import { createLogger } from '../../lib/logger.js';
import { toSQLDateTime } from '../../lib/text-utils.js';

const log = createLogger('TeamDO');
import { ensureSchema } from './schema.js';
import { queryTeamContext, queryTeamSummary } from './context.js';
import { resolveOwnedAgentId } from './identity.js';
import { runCleanup } from './cleanup.js';
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
  createCategory as createCategoryFn,
  listCategories as listCategoriesFn,
  updateCategory as updateCategoryFn,
  deleteCategory as deleteCategoryFn,
  getCategoryNames as getCategoryNamesFn,
  getPromotableTags as getPromotableTagsFn,
} from './categories.js';
import {
  claimFiles as claimFilesFn,
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
} from './sessions.js';
import type { EditEntry, SessionRecord } from './sessions.js';
import {
  getAnalytics as getAnalyticsFn,
  getExtendedAnalytics as getExtendedAnalyticsFn,
} from './analytics.js';
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
} from '@chinwag/shared/contracts/conversation.js';
import {
  submitCommand as submitCommandFn,
  claimCommand as claimCommandFn,
  completeCommand as completeCommandFn,
  getPendingCommands as getPendingCommandsFn,
} from './commands.js';
import { normalizeRuntimeMetadata } from './runtime.js';
import { enrichAnalyticsWithPricing } from './pricing-enrich.js';
import {
  CONTEXT_CACHE_TTL_MS,
  CLEANUP_INTERVAL_MS,
  HEARTBEAT_BROADCAST_DEBOUNCE_MS,
  METRIC_KEYS,
} from '../../lib/constants.js';

export class TeamDO extends DurableObject<Env> {
  sql: SqlStorage;
  #schemaReady = false;
  #lastCleanup = 0;
  #lastHeartbeatBroadcast = new Map<string, number>();

  #contextCache: (TeamContext & { ok: true }) | null = null;
  #contextCacheExpire = 0;

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
    const url = new URL(request.url);
    if (url.pathname !== '/ws') {
      return new Response('Not found', { status: 404 });
    }

    if (request.headers.get('X-Chinwag-Verified') !== '1') {
      return new Response('Forbidden', { status: 403 });
    }

    const agentId = url.searchParams.get('agentId');
    const ownerId = url.searchParams.get('ownerId');
    if (!agentId || !ownerId) {
      return new Response('Missing agentId or ownerId', { status: 400 });
    }

    this.#ensureSchema();

    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) {
      return new Response('Not a member of this team', { status: 403 });
    }

    const roleParam = url.searchParams.get('role');
    const role = roleParam === 'agent' ? 'agent' : roleParam === 'daemon' ? 'daemon' : 'watcher';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Agents and daemons can report available spawn tools via query string — stored as
    // WebSocket tags so they survive DO hibernation and can be queried for context responses.
    const tags = [resolved, `role:${role}`];
    if (role === 'agent' || role === 'daemon') {
      const toolsParam = url.searchParams.get('tools');
      if (toolsParam) {
        for (const t of toolsParam.split(',')) {
          const trimmed = t.trim();
          if (trimmed) tags.push(`spawn:${trimmed}`);
        }
      }
    }

    this.ctx.acceptWebSocket(server, tags);

    // Agents and daemons: bump heartbeat on connect (WS keeps them alive going forward)
    if (role === 'agent' || role === 'daemon') {
      this.sql.exec(
        "UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?",
        resolved,
      );
      this.#broadcastToWatchers({ type: 'status_change', agent_id: resolved, status: 'active' });
    }

    // Spawn capability connect: notify watchers about available tools
    const hasSpawnCapability = tags.some((t) => t.startsWith('spawn:'));
    if (hasSpawnCapability) {
      this.#broadcastToWatchers({
        type: 'daemon_status',
        connected: true,
        available_tools: this.#getAvailableSpawnTools(),
      });
    }

    // Send initial full context -- on failure, send error frame so client knows
    try {
      const ctx = await this.getContext(resolved);
      server.send(JSON.stringify({ type: 'context', data: ctx }));
    } catch (err) {
      log.error('failed to send initial context', { error: getErrorMessage(err) });
      try {
        server.send(JSON.stringify({ type: 'error', message: 'Failed to load initial context' }));
      } catch {
        // Client may have already disconnected
      }
    }

    // Executors (any socket with spawn capability): deliver pending commands
    if (hasSpawnCapability) {
      try {
        const pending = getPendingCommandsFn(this.sql);
        for (const cmd of pending.commands) {
          const c = cmd as Record<string, unknown>;
          if (c.status === 'pending') {
            server.send(
              JSON.stringify({
                type: 'command',
                id: c.id,
                command_type: c.type,
                payload: JSON.parse((c.payload as string) || '{}'),
              }),
            );
          }
        }
      } catch (err) {
        log.error('failed to send pending commands to daemon', { error: getErrorMessage(err) });
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    // Guard: if the WS has no tags, it was never properly accepted -- ignore
    let tags: string[];
    try {
      tags = this.ctx.getTags(ws);
    } catch (err) {
      log.error('webSocketMessage: failed to read tags', { error: getErrorMessage(err) });
      return;
    }
    const agentId = tags.find((t) => !t.startsWith('role:'));
    if (!agentId) {
      // Unauthenticated or untagged WebSocket -- log and ignore
      log.warn('untagged WebSocket message', {
        event: 'ws_unauth_message',
        messagePreview: String(rawMessage).slice(0, 200),
      });
      return;
    }

    const isAgent = tags.includes('role:agent');

    try {
      const data = JSON.parse(rawMessage as string) as Record<string, unknown>;

      if (data.type === 'ping') {
        this.#ensureSchema();
        if (data.lastToolUseAt) {
          const parsed = new Date(data.lastToolUseAt as string);
          if (!isNaN(parsed.getTime())) {
            const ts = toSQLDateTime(parsed);
            this.sql.exec(
              "UPDATE members SET last_heartbeat = datetime('now'), last_tool_use = ? WHERE agent_id = ?",
              ts,
              agentId,
            );
          } else {
            this.sql.exec(
              "UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?",
              agentId,
            );
          }
        } else {
          this.sql.exec(
            "UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?",
            agentId,
          );
        }
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (data.type === 'activity' && isAgent) {
        this.#ensureSchema();
        const result = updateActivityFn(
          this.sql,
          agentId,
          (data.files as string[]) || [],
          (data.summary as string) || '',
          this.#transact,
        );
        if (!isDOError(result)) {
          this.#broadcastToWatchers({
            type: 'activity',
            agent_id: agentId,
            files: data.files,
            summary: data.summary,
          });
        }
      } else if (data.type === 'file' && isAgent) {
        this.#ensureSchema();
        const result = reportFileFn(this.sql, agentId, data.file as string, this.#transact);
        if (!isDOError(result)) {
          this.#broadcastToWatchers({ type: 'file', agent_id: agentId, file: data.file });
        }
      } else if (data.type === 'claim_command' && tags.some((t) => t.startsWith('spawn:'))) {
        this.#ensureSchema();
        const commandId = typeof data.id === 'string' ? data.id : '';
        if (commandId) {
          const result = claimCommandFn(this.sql, commandId, agentId);
          ws.send(JSON.stringify({ type: 'claim_result', id: commandId, ...result }));
          if (!isDOError(result)) {
            this.#broadcastToWatchers({
              type: 'command_status',
              id: commandId,
              status: 'claimed',
              claimed_by: agentId,
            });
          }
        }
      } else if (data.type === 'command_result' && tags.some((t) => t.startsWith('spawn:'))) {
        this.#ensureSchema();
        const commandId = typeof data.id === 'string' ? data.id : '';
        const cmdStatus = data.status === 'completed' ? 'completed' : 'failed';
        const resultData =
          typeof data.result === 'object' && data.result
            ? (data.result as Record<string, unknown>)
            : {};
        if (commandId) {
          const result = completeCommandFn(this.sql, commandId, agentId, cmdStatus, resultData);
          if (!isDOError(result)) {
            this.#broadcastToWatchers({
              type: 'command_status',
              id: commandId,
              status: cmdStatus,
              result: resultData,
            });
          }
        }
      }
    } catch (err) {
      log.error('WebSocket message processing failed', {
        event: 'ws_message_error',
        agentId,
        messagePreview: String(rawMessage).slice(0, 200),
        error: getErrorMessage(err),
      });
      try {
        ws.send(JSON.stringify({ type: 'error', message: 'Message processing failed' }));
      } catch {
        // Client may have disconnected
      }
    }
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    let tags: string[];
    try {
      tags = this.ctx.getTags(ws);
    } catch (err) {
      log.error('webSocketClose: failed to read tags on closing socket', {
        error: getErrorMessage(err),
      });
      // Tags lost -- cannot identify agent. This is rare (DO restart mid-close).
      // Stale locks/members will be cleaned up by #maybeCleanup's heartbeat eviction.
      return;
    }
    const isAgent = tags.includes('role:agent');
    const closingHasSpawn = tags.some((t) => t.startsWith('spawn:'));
    const agentId = tags.find((t) => !t.startsWith('role:') && !t.startsWith('spawn:'));

    // Spawn capability disconnect: recompute available tools for watchers
    if (closingHasSpawn && agentId) {
      const remaining = this.#getExecutorSockets().filter((s) => s !== ws);
      this.#broadcastToWatchers({
        type: 'daemon_status',
        connected: remaining.length > 0,
        available_tools: this.#getAvailableSpawnTools(),
      });
    }

    if (isAgent && agentId) {
      this.#ensureSchema();
      this.#lastHeartbeatBroadcast.delete(agentId);
      // Release locks -- agent is gone, don't block others
      let locksReleased = true;
      try {
        releaseFilesFn(this.sql, agentId, null);
      } catch (err) {
        locksReleased = false;
        log.error('webSocketClose: lock release failed', {
          agentId,
          error: getErrorMessage(err),
        });
      }
      // Always broadcast status_change (agent is offline regardless)
      this.#broadcastToWatchers({ type: 'status_change', agent_id: agentId, status: 'offline' });
      // Only broadcast lock release if it actually happened
      if (locksReleased) {
        this.#broadcastToWatchers({
          type: 'lock_change',
          action: 'release_all',
          agent_id: agentId,
        });
      }
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    // Log the error for observability; webSocketClose fires after for actual cleanup
    let agentId = 'unknown';
    try {
      const tags = this.ctx.getTags(ws);
      agentId = tags.find((t) => !t.startsWith('role:')) || 'unknown';
    } catch (err) {
      log.error('webSocketError: failed to read tags', { error: getErrorMessage(err) });
    }
    log.warn('WebSocket error', { event: 'ws_error', agentId });
  }

  // -- Internal helpers --

  /** Agent IDs with an active 'role:agent' WebSocket connection. */
  #getConnectedAgentIds(): Set<string> {
    return new Set(
      this.ctx
        .getWebSockets('role:agent')
        .flatMap((ws) => this.ctx.getTags(ws))
        .filter((tag) => !tag.startsWith('role:') && !tag.startsWith('spawn:')),
    );
  }

  /** All member IDs with any active WebSocket (agent, watcher, daemon).
   *  Used for cleanup eviction protection — any connected socket keeps
   *  the member row alive regardless of role. */
  #getAllConnectedMemberIds(): Set<string> {
    return new Set(
      this.ctx
        .getWebSockets()
        .flatMap((ws) => this.ctx.getTags(ws))
        .filter((tag) => !tag.startsWith('role:') && !tag.startsWith('spawn:')),
    );
  }

  #invalidateContextCache(): void {
    this.#contextCache = null;
    this.#contextCacheExpire = 0;
  }

  #broadcastToWatchers(event: Record<string, unknown>, { invalidateCache = true } = {}): void {
    if (invalidateCache) this.#invalidateContextCache();
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;
    const data = JSON.stringify(event);
    let failures = 0;
    for (const ws of sockets) {
      try {
        ws.send(data);
      } catch {
        failures++;
      }
    }
    if (failures > 0) {
      log.warn('broadcast partial failure', { totalClients: sockets.length, failures });
    }
  }

  // -- Daemon command relay helpers --

  /** All connected sockets with spawn capability (any role, identified by spawn:* tags). */
  #getExecutorSockets(): WebSocket[] {
    const executors: WebSocket[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      try {
        if (this.ctx.getTags(ws).some((t) => t.startsWith('spawn:'))) {
          executors.push(ws);
        }
      } catch {
        /* socket may be closing */
      }
    }
    return executors;
  }

  #broadcastToExecutors(event: Record<string, unknown>): void {
    const sockets = this.#getExecutorSockets();
    if (!sockets.length) return;
    const data = JSON.stringify(event);
    for (const ws of sockets) {
      try {
        ws.send(data);
      } catch {
        /* client may have disconnected */
      }
    }
  }

  #hasExecutorConnected(): boolean {
    return this.#getExecutorSockets().length > 0;
  }

  /** Collect available spawn tools from all connected daemon WebSocket tags. */
  #getAvailableSpawnTools(): string[] {
    const tools = new Set<string>();
    for (const ws of this.#getExecutorSockets()) {
      try {
        for (const tag of this.ctx.getTags(ws)) {
          if (tag.startsWith('spawn:')) tools.add(tag.slice(6));
        }
      } catch {
        /* socket may be closing */
      }
    }
    return [...tools];
  }

  // Evict stale members and prune old sessions -- at most once per minute.
  #maybeCleanup(): void {
    const now = Date.now();
    if (now - this.#lastCleanup < CLEANUP_INTERVAL_MS) return;
    this.#lastCleanup = now;
    runCleanup(this.sql, this.#getAllConnectedMemberIds(), this.#transact);
  }

  #recordMetric(metric: string): void {
    // Lifetime counter
    this.sql.exec(
      `INSERT INTO telemetry (metric, count, last_at) VALUES (?, 1, datetime('now'))
       ON CONFLICT(metric) DO UPDATE SET count = count + 1, last_at = datetime('now')`,
      metric,
    );
    // Daily bucket for trend analysis
    this.sql.exec(
      `INSERT INTO daily_metrics (date, metric, count) VALUES (date('now'), ?, 1)
       ON CONFLICT(date, metric) DO UPDATE SET count = count + 1`,
      metric,
    );
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
    return this.#withMember(agentId, ownerId, (resolved) => {
      const result = updateActivityFn(this.sql, resolved, files, summary, this.#transact);
      if (!isDOError(result)) {
        this.#broadcastToWatchers({ type: 'activity', agent_id: resolved, files, summary });
      }
      return result;
    });
  }

  async checkConflicts(
    agentId: string,
    files: string[],
    ownerId: string | null = null,
  ): Promise<ReturnType<typeof checkConflictsFn> | DOError> {
    return this.#withMember(agentId, ownerId, (resolved) =>
      checkConflictsFn(
        this.sql,
        resolved,
        files,
        this.#boundRecordMetric,
        this.#getConnectedAgentIds(),
      ),
    );
  }

  async reportFile(
    agentId: string,
    filePath: string,
    ownerId: string | null = null,
  ): Promise<DOResult<{ ok: true }> | DOError> {
    return this.#withMember(agentId, ownerId, (resolved) => {
      const result = reportFileFn(this.sql, resolved, filePath, this.#transact);
      if (!isDOError(result)) {
        this.#broadcastToWatchers({ type: 'file', agent_id: resolved, file: filePath });
      }
      return result;
    });
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
      const now = Date.now();
      if (this.#contextCache && now < this.#contextCacheExpire) {
        return { ...this.#contextCache, messages, daemon };
      }

      this.#maybeCleanup();

      const connectedIds = this.#getConnectedAgentIds();
      const teamContext = queryTeamContext(this.sql, connectedIds);

      this.#contextCache = teamContext;
      this.#contextCacheExpire = Date.now() + CONTEXT_CACHE_TTL_MS;

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
    return this.#withMember(agentId, ownerId, (resolved) => {
      const result = startSessionFn(this.sql, resolved, handle, framework, runtime, this.#transact);
      if (!isDOError(result)) {
        this.#recordMetric('sessions_started');
      }
      return result;
    });
  }

  async endSession(
    agentId: string,
    sessionId: string,
    ownerId: string | null = null,
  ): Promise<
    | DOResult<{ ok: true; outcome?: string | null; summary?: Record<string, unknown> | null }>
    | DOError
  > {
    return this.#withMember(agentId, ownerId, (resolved) => {
      const result = endSessionFn(this.sql, resolved, sessionId);
      if (!isDOError(result) && result.outcome) {
        this.#recordMetric(`outcome:${result.outcome}`);
      }
      return result;
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
  ): Promise<
    ReturnType<typeof getAnalyticsFn> | ReturnType<typeof getExtendedAnalyticsFn> | DOError
  > {
    const raw = this.#withMember(agentId, ownerId, () =>
      extended ? getExtendedAnalyticsFn(this.sql, days) : getAnalyticsFn(this.sql, days),
    );
    if (isDOError(raw)) return raw;
    // Enrich token_usage with cost from the isolate pricing cache. This hits
    // DatabaseDO at most once per TTL window (5 min) rather than per request.
    return enrichAnalyticsWithPricing(raw, this.env);
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
    return this.#withMember(agentId, ownerId, () => {
      const result = batchRecordConversationEventsFn(
        this.sql,
        sessionId,
        agentId,
        handle,
        hostTool,
        events,
        this.#transact,
      );
      this.#recordMetric('conversation_events_recorded');
      return result;
    });
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
    return this.#withMember(agentId, ownerId, (resolved) => {
      const result = saveMemoryFn(
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
      );
      if (!isDOError(result) && !('code' in result && result.code === 'DUPLICATE')) {
        this.#broadcastToWatchers({ type: 'memory', text, tags });
      }
      return result;
    });
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
      // Increment per-session memory search counter
      this.sql.exec(
        `UPDATE sessions SET memories_searched = memories_searched + 1 WHERE agent_id = ? AND ended_at IS NULL`,
        resolved,
      );
      if ('ok' in result && result.memories && result.memories.length > 0) {
        this.#recordMetric(METRIC_KEYS.MEMORIES_SEARCH_HITS);
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
  ): Promise<ReturnType<typeof claimFilesFn> | DOError> {
    return this.#withMember(agentId, ownerId, (resolved) => {
      const result = claimFilesFn(this.sql, resolved, files, handle, runtimeOrTool, ownerId!);
      if (!isDOError(result)) {
        this.#broadcastToWatchers({
          type: 'lock_change',
          action: 'claim',
          agent_id: resolved,
          files,
        });
      }
      return result;
    });
  }

  async releaseFiles(
    agentId: string,
    files: string[] | null | undefined,
    ownerId: string | null = null,
  ): Promise<{ ok: true } | DOError> {
    return this.#withMember(agentId, ownerId, (resolved) => {
      const result = releaseFilesFn(this.sql, resolved, files, ownerId);
      if (!isDOError(result)) {
        this.#broadcastToWatchers({
          type: 'lock_change',
          action: 'release',
          agent_id: resolved,
          files,
        });
      }
      return result;
    });
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
    return this.#withMember(agentId, ownerId, (resolved) => {
      const result = sendMessageFn(
        this.sql,
        resolved,
        handle,
        runtimeOrTool,
        text,
        targetAgent,
        this.#boundRecordMetric,
      );
      if (!isDOError(result)) {
        this.#broadcastToWatchers({ type: 'message', from_handle: handle, text });
      }
      return result;
    });
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
  ): Promise<{ ok: true; sessions: SessionRecord[] } | DOError> {
    this.#ensureSchema();
    const ownerRow = this.sql
      .exec('SELECT 1 FROM members WHERE owner_id = ? LIMIT 1', ownerId)
      .toArray();
    if (ownerRow.length === 0) return { error: 'Not a member of this team', code: 'NOT_MEMBER' };
    return { ok: true, sessions: getSessionsInRangeFn(this.sql, fromDate, toDate) };
  }

  // -- Extended analytics (cross-project dashboard) --

  async getAnalyticsForOwner(
    ownerId: string,
    days: number,
  ): Promise<ReturnType<typeof getExtendedAnalyticsFn> | DOError> {
    this.#ensureSchema();
    const ownerRow = this.sql
      .exec('SELECT 1 FROM members WHERE owner_id = ? LIMIT 1', ownerId)
      .toArray();
    if (ownerRow.length === 0) return { error: 'Not a member of this team', code: 'NOT_MEMBER' };
    const raw = getExtendedAnalyticsFn(this.sql, days);
    return enrichAnalyticsWithPricing(raw, this.env);
  }

  // -- Summary (lightweight, for cross-project dashboard) --

  async getSummary(ownerId: string): Promise<ReturnType<typeof queryTeamSummary> | DOError> {
    this.#ensureSchema();
    // Dashboard summary: check that this user owns at least one agent in the team
    const ownerRow = this.sql
      .exec('SELECT 1 FROM members WHERE owner_id = ? LIMIT 1', ownerId)
      .toArray();
    if (ownerRow.length === 0) return { error: 'Not a member of this team', code: 'NOT_MEMBER' };
    this.#maybeCleanup();
    return queryTeamSummary(this.sql);
  }
}

// Re-export path utility for consumers
export { normalizePath } from '../../lib/text-utils.js';
