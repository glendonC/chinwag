// Team Durable Object — one instance per team.
// Manages team membership, activity tracking, file conflict detection,
// shared project memory, and session history (observability).
//
// Business logic is split into submodules:
//   schema.js    — DDL, migrations, index creation
//   context.js   — composite read queries (getContext, getSummary)
//   membership.js, activity.js, memory.js, locks.js, sessions.js, messages.js — domain logic
//   runtime.js   — agent ID / host tool inference
//
// This file owns the class shell, WebSocket handling, cleanup, identity
// resolution, caching, and the thin RPC wrappers that tie it all together.

import { DurableObject } from 'cloudflare:workers';
import { toSQLDateTime } from '../../lib/text-utils.js';
import { ensureSchema } from './schema.js';
import { queryTeamContext, queryTeamSummary } from './context.js';
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
} from './memory.js';
import {
  claimFiles as claimFilesFn,
  releaseFiles as releaseFilesFn,
  getLockedFiles as getLockedFilesFn,
} from './locks.js';
import {
  startSession as startSessionFn,
  endSession as endSessionFn,
  recordEdit as recordEditFn,
  getSessionHistory,
  enrichSessionModel as enrichSessionModelFn,
} from './sessions.js';
import { sendMessage as sendMessageFn, getMessages as getMessagesFn } from './messages.js';
import {
  HEARTBEAT_STALE_WINDOW_S,
  SESSION_RETENTION_DAYS,
  CONTEXT_CACHE_TTL_MS,
  CLEANUP_INTERVAL_MS,
  HEARTBEAT_BROADCAST_DEBOUNCE_MS,
} from '../../lib/constants.js';

export class TeamDO extends DurableObject {
  #schemaReady = false;
  #lastCleanup = 0;
  #lastHeartbeatBroadcast = new Map();
  #contextCache = null;
  #contextCacheExpire = 0;

  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  // ── Schema ──

  #ensureSchema() {
    ensureSchema(this.sql, this.#schemaReady);
    this.#schemaReady = true;
  }

  // ── WebSocket support (Hibernation API) ──
  // Two roles: 'agent' (MCP servers — connection IS presence) and
  // 'watcher' (dashboards — observe only, no presence signal).
  // Tags: [resolvedAgentId, 'role:agent'] or [resolvedAgentId, 'role:watcher']

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') {
      return new Response('Not found', { status: 404 });
    }

    if (request.headers.get('X-Chinwag-Verified') !== '1') {
      return new Response('Forbidden', { status: 403 });
    }

    const agentId = url.searchParams.get('agentId');
    if (!agentId) {
      return new Response('Missing agentId', { status: 400 });
    }

    this.#ensureSchema();

    const resolved = this.#resolveOwnedAgentId(agentId);
    if (!resolved) {
      return new Response('Not a member of this team', { status: 403 });
    }

    const role = url.searchParams.get('role') === 'agent' ? 'agent' : 'watcher';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server, [resolved, `role:${role}`]);

    // Agents: bump heartbeat on connect (WS keeps them alive going forward)
    if (role === 'agent') {
      this.sql.exec(
        "UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?",
        resolved,
      );
      this.#broadcastToWatchers({ type: 'status_change', agent_id: resolved, status: 'active' });
    }

    // Send initial full context
    try {
      const ctx = await this.getContext(resolved);
      server.send(JSON.stringify({ type: 'context', data: ctx }));
    } catch (err) {
      console.error('Failed to send initial context:', err);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, rawMessage) {
    // Guard: if the WS has no tags, it was never properly accepted — ignore
    let tags;
    try {
      tags = this.ctx.getTags(ws);
    } catch {
      return;
    }
    const agentId = tags.find((t) => !t.startsWith('role:'));
    if (!agentId) {
      // Unauthenticated or untagged WebSocket — log and ignore
      console.log(
        JSON.stringify({
          event: 'ws_unauth_message',
          message_preview: String(rawMessage).slice(0, 200),
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    const isAgent = tags.includes('role:agent');

    try {
      const data = JSON.parse(rawMessage);

      if (data.type === 'ping') {
        this.#ensureSchema();
        if (data.lastToolUseAt) {
          const parsed = new Date(data.lastToolUseAt);
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
        const result = updateActivityFn(this.sql, agentId, data.files || [], data.summary || '');
        if (!result.error) {
          this.#broadcastToWatchers({
            type: 'activity',
            agent_id: agentId,
            files: data.files,
            summary: data.summary,
          });
        }
      } else if (data.type === 'file' && isAgent) {
        this.#ensureSchema();
        const result = reportFileFn(this.sql, agentId, data.file);
        if (!result.error) {
          this.#broadcastToWatchers({ type: 'file', agent_id: agentId, file: data.file });
        }
      }
    } catch (err) {
      console.log(
        JSON.stringify({
          event: 'ws_message_error',
          agent_id: agentId,
          message_preview: String(rawMessage).slice(0, 200),
          error: err?.message || String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  async webSocketClose(ws) {
    let tags;
    try {
      tags = this.ctx.getTags(ws);
    } catch {
      return;
    }
    const isAgent = tags.includes('role:agent');
    const agentId = tags.find((t) => !t.startsWith('role:'));

    if (isAgent && agentId) {
      this.#ensureSchema();
      // Release locks — agent is gone, don't block others
      releaseFilesFn(this.sql, agentId, null);
      this.#broadcastToWatchers({ type: 'status_change', agent_id: agentId, status: 'offline' });
      this.#broadcastToWatchers({ type: 'lock_change', action: 'release_all', agent_id: agentId });
    }
  }

  async webSocketError(ws) {
    // Log the error for observability; webSocketClose fires after for actual cleanup
    let agentId = 'unknown';
    try {
      const tags = this.ctx.getTags(ws);
      agentId = tags.find((t) => !t.startsWith('role:')) || 'unknown';
    } catch {
      /* tags unavailable */
    }
    console.log(
      JSON.stringify({
        event: 'ws_error',
        agent_id: agentId,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  // ── Internal helpers ──

  /** Agent IDs with an active 'role:agent' WebSocket connection. */
  #getConnectedAgentIds() {
    return new Set(
      this.ctx
        .getWebSockets('role:agent')
        .flatMap((ws) => this.ctx.getTags(ws))
        .filter((tag) => !tag.startsWith('role:')),
    );
  }

  #invalidateContextCache() {
    this.#contextCache = null;
    this.#contextCacheExpire = 0;
  }

  #broadcastToWatchers(event) {
    this.#invalidateContextCache();
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;
    const data = JSON.stringify(event);
    for (const ws of sockets) {
      try {
        ws.send(data);
      } catch (err) {
        let wsAgent = 'unknown';
        try {
          const t = this.ctx.getTags(ws);
          wsAgent = t.find((tag) => !tag.startsWith('role:')) || 'unknown';
        } catch {
          /* tags unavailable on dead socket */
        }
        console.log(
          JSON.stringify({
            event: 'ws_broadcast_error',
            agent_id: wsAgent,
            error: err?.message || String(err),
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }
  }

  // Evict stale members and prune old sessions — at most once per minute.
  // Preserves agents with active WebSocket connections regardless of heartbeat age.
  #maybeCleanup() {
    const now = Date.now();
    if (now - this.#lastCleanup < CLEANUP_INTERVAL_MS) return;
    this.#lastCleanup = now;

    // Clamp future heartbeats (clock skew) — any last_heartbeat ahead of now
    // is reset to now so stale-window comparisons remain correct.
    this.sql.exec(
      "UPDATE members SET last_heartbeat = datetime('now') WHERE last_heartbeat > datetime('now')",
    );

    // Agents with live WebSocket connections must not be evicted.
    // Snapshot this AFTER clamping heartbeats so the eviction queries
    // below see a consistent view.
    const wsAlive = [...this.#getConnectedAgentIds()];
    const wsPlaceholders = wsAlive.length ? wsAlive.map(() => '?').join(',') : "'__none__'";
    const wsParams = wsAlive.length ? wsAlive : [];

    this.sql.exec(
      `DELETE FROM activities WHERE agent_id IN (
        SELECT agent_id FROM members
        WHERE last_heartbeat < datetime('now', '-' || ? || ' seconds')
          AND agent_id NOT IN (${wsPlaceholders})
      )`,
      HEARTBEAT_STALE_WINDOW_S,
      ...wsParams,
    );
    this.sql.exec(
      `DELETE FROM members
       WHERE last_heartbeat < datetime('now', '-' || ? || ' seconds')
         AND agent_id NOT IN (${wsPlaceholders})`,
      HEARTBEAT_STALE_WINDOW_S,
      ...wsParams,
    );
    this.sql.exec(
      `DELETE FROM sessions WHERE started_at < datetime('now', '-' || ? || ' days')`,
      SESSION_RETENTION_DAYS,
    );
    // Expire messages older than 1 hour
    this.sql.exec("DELETE FROM messages WHERE created_at < datetime('now', '-1 hour')");
    // Auto-release locks for stale agents (WS-connected agents keep their locks)
    this.sql.exec(
      `DELETE FROM locks WHERE agent_id NOT IN (
        SELECT agent_id FROM members
        WHERE last_heartbeat > datetime('now', '-' || ? || ' seconds')
          OR agent_id IN (${wsPlaceholders})
      )`,
      HEARTBEAT_STALE_WINDOW_S,
      ...wsParams,
    );
    // Auto-close orphaned sessions
    this.sql.exec(
      `UPDATE sessions SET ended_at = datetime('now')
       WHERE ended_at IS NULL
       AND agent_id NOT IN (
         SELECT agent_id FROM members
         WHERE last_heartbeat > datetime('now', '-' || ? || ' seconds')
           OR agent_id IN (${wsPlaceholders})
       )`,
      HEARTBEAT_STALE_WINDOW_S,
      ...wsParams,
    );
    // Prune stale telemetry
    this.sql.exec("DELETE FROM telemetry WHERE last_at < datetime('now', '-30 days')");
  }

  #recordMetric(metric) {
    this.sql.exec(
      `INSERT INTO telemetry (metric, count, last_at) VALUES (?, 1, datetime('now'))
       ON CONFLICT(metric) DO UPDATE SET count = count + 1, last_at = datetime('now')`,
      metric,
    );
  }

  // ── Identity resolution ──

  #findExactMember(agentId) {
    const rows = this.sql
      .exec('SELECT agent_id, owner_id FROM members WHERE agent_id = ?', agentId)
      .toArray();
    return rows[0] || null;
  }

  #findPrefixedMember(agentId) {
    const rows = this.sql
      .exec(
        "SELECT agent_id, owner_id FROM members WHERE agent_id LIKE ? || ':%' ORDER BY last_heartbeat DESC LIMIT 1",
        agentId,
      )
      .toArray();
    return rows[0] || null;
  }

  #findLatestMemberForOwner(ownerId) {
    const rows = this.sql
      .exec(
        'SELECT agent_id, owner_id FROM members WHERE owner_id = ? ORDER BY last_heartbeat DESC LIMIT 1',
        ownerId,
      )
      .toArray();
    return rows[0] || null;
  }

  #resolveOwnedAgentId(agentId, ownerId = null) {
    const exact = this.#findExactMember(agentId);
    if (exact) {
      return !ownerId || exact.owner_id === ownerId ? exact.agent_id : null;
    }

    const prefixed = this.#findPrefixedMember(agentId);
    if (prefixed) {
      return !ownerId || prefixed.owner_id === ownerId ? prefixed.agent_id : null;
    }

    // Legacy callers may still send the authenticated user id instead of X-Agent-Id.
    if (ownerId && agentId === ownerId) {
      const latest = this.#findLatestMemberForOwner(ownerId);
      return latest?.agent_id || null;
    }

    return null;
  }

  // --- Bound helper for submodules that need to record telemetry ---
  #boundRecordMetric = (metric) => this.#recordMetric(metric);

  // ── Membership ──

  async join(agentId, ownerId, ownerHandle, runtimeOrTool = 'unknown') {
    this.#ensureSchema();
    const result = join(
      this.sql,
      agentId,
      ownerId,
      ownerHandle,
      runtimeOrTool,
      this.#boundRecordMetric,
    );
    if (!result.error) {
      const tool = typeof runtimeOrTool === 'object' ? runtimeOrTool?.host_tool : runtimeOrTool;
      this.#broadcastToWatchers({
        type: 'member_joined',
        agent_id: agentId,
        handle: ownerHandle,
        tool: tool || 'unknown',
      });
    }
    return result;
  }

  async leave(agentId, ownerId = null) {
    this.#ensureSchema();
    const result = leave(this.sql, agentId, ownerId);
    if (!result.error) {
      this.#broadcastToWatchers({ type: 'member_left', agent_id: agentId });
    }
    return result;
  }

  async heartbeat(agentId, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    const result = heartbeatFn(this.sql, resolved);
    if (!result.error) {
      const now = Date.now();
      const last = this.#lastHeartbeatBroadcast.get(resolved) || 0;
      if (now - last >= HEARTBEAT_BROADCAST_DEBOUNCE_MS) {
        this.#lastHeartbeatBroadcast.set(resolved, now);
        this.#broadcastToWatchers({ type: 'heartbeat', agent_id: resolved, ts: now });
      }
    }
    return result;
  }

  // ── Activity ──

  async updateActivity(agentId, files, summary, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    const result = updateActivityFn(this.sql, resolved, files, summary);
    if (!result.error) {
      this.#broadcastToWatchers({ type: 'activity', agent_id: resolved, files, summary });
    }
    return result;
  }

  async checkConflicts(agentId, files, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    return checkConflictsFn(
      this.sql,
      resolved,
      files,
      this.#boundRecordMetric,
      this.#getConnectedAgentIds(),
    );
  }

  async reportFile(agentId, filePath, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    const result = reportFileFn(this.sql, resolved, filePath);
    if (!result.error) {
      this.#broadcastToWatchers({ type: 'file', agent_id: resolved, file: filePath });
    }
    return result;
  }

  // ── Context (composite queries — logic in context.js) ──

  async getContext(agentId, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };

    // Always bump calling agent's heartbeat
    this.sql.exec(
      "UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?",
      resolved,
    );

    // Per-agent messages (always fresh — has target_agent filter, can't be cached team-wide)
    const messages = this.sql
      .exec(
        `SELECT from_handle, from_tool, from_host_tool, from_agent_surface, text, created_at
       FROM messages
       WHERE created_at > datetime('now', '-1 hour')
         AND (target_agent IS NULL OR target_agent = ?)
       ORDER BY created_at DESC LIMIT 10`,
        resolved,
      )
      .toArray();

    // Return cached team-wide context if fresh
    const now = Date.now();
    if (this.#contextCache && now < this.#contextCacheExpire) {
      return { ...this.#contextCache, messages };
    }

    this.#maybeCleanup();

    const connectedIds = this.#getConnectedAgentIds();
    const teamContext = queryTeamContext(this.sql, connectedIds);

    this.#contextCache = teamContext;
    this.#contextCacheExpire = Date.now() + CONTEXT_CACHE_TTL_MS;

    return { ...teamContext, messages };
  }

  // ── Sessions (observability) ──

  async startSession(agentId, handle, framework, runtimeOrOwnerId = null, ownerId = null) {
    this.#ensureSchema();
    const runtime =
      runtimeOrOwnerId && typeof runtimeOrOwnerId === 'object' ? runtimeOrOwnerId : null;
    const resolvedOwnerId = runtime ? ownerId : runtimeOrOwnerId;
    const resolved = this.#resolveOwnedAgentId(agentId, resolvedOwnerId);
    if (!resolved) return { error: 'Not a member of this team' };
    return startSessionFn(this.sql, resolved, handle, framework, runtime);
  }

  async endSession(agentId, sessionId, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    return endSessionFn(this.sql, resolved, sessionId);
  }

  async recordEdit(agentId, filePath, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    return recordEditFn(this.sql, resolved, filePath);
  }

  async getHistory(agentId, days, ownerId = null) {
    this.#ensureSchema();
    if (!this.#resolveOwnedAgentId(agentId, ownerId)) return { error: 'Not a member of this team' };
    return getSessionHistory(this.sql, days);
  }

  async enrichModel(agentId, model, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    return enrichSessionModelFn(this.sql, resolved, model, this.#boundRecordMetric);
  }

  // ── Memory ──

  async saveMemory(agentId, text, tags, handle, runtimeOrOwnerId = null, ownerId = null) {
    this.#ensureSchema();
    const runtime =
      runtimeOrOwnerId && typeof runtimeOrOwnerId === 'object' ? runtimeOrOwnerId : null;
    const resolvedOwnerId = runtime ? ownerId : runtimeOrOwnerId;
    const resolved = this.#resolveOwnedAgentId(agentId, resolvedOwnerId);
    if (!resolved) return { error: 'Not a member of this team' };
    const result = saveMemoryFn(
      this.sql,
      resolved,
      text,
      tags,
      handle,
      runtime,
      this.#boundRecordMetric,
    );
    if (!result.error) {
      this.#broadcastToWatchers({ type: 'memory', text, tags });
    }
    return result;
  }

  async searchMemories(agentId, query, tags, limit = 20, ownerId = null) {
    this.#ensureSchema();
    if (!this.#resolveOwnedAgentId(agentId, ownerId)) return { error: 'Not a member of this team' };
    return searchMemoriesFn(this.sql, query, tags, limit);
  }

  async updateMemory(agentId, memoryId, text, tags, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    return updateMemoryFn(this.sql, resolved, memoryId, text, tags);
  }

  async deleteMemory(agentId, memoryId, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    return deleteMemoryFn(this.sql, memoryId);
  }

  // ── File Locks ──

  async claimFiles(agentId, files, handle, runtimeOrTool, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    const result = claimFilesFn(this.sql, resolved, files, handle, runtimeOrTool);
    if (!result.error) {
      this.#broadcastToWatchers({
        type: 'lock_change',
        action: 'claim',
        agent_id: resolved,
        files,
      });
    }
    return result;
  }

  async releaseFiles(agentId, files, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    const result = releaseFilesFn(this.sql, resolved, files);
    if (!result.error) {
      this.#broadcastToWatchers({
        type: 'lock_change',
        action: 'release',
        agent_id: resolved,
        files,
      });
    }
    return result;
  }

  async getLockedFiles(agentId, ownerId = null) {
    this.#ensureSchema();
    if (!this.#resolveOwnedAgentId(agentId, ownerId)) return { error: 'Not a member of this team' };
    return getLockedFilesFn(this.sql, this.#getConnectedAgentIds());
  }

  // ── Messages ──

  async sendMessage(agentId, handle, runtimeOrTool, text, targetAgent, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    const result = sendMessageFn(
      this.sql,
      resolved,
      handle,
      runtimeOrTool,
      text,
      targetAgent,
      this.#boundRecordMetric,
    );
    if (!result.error) {
      this.#broadcastToWatchers({ type: 'message', from_handle: handle, text });
    }
    return result;
  }

  async getMessages(agentId, since, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    return getMessagesFn(this.sql, resolved, since);
  }

  // ── Summary (lightweight, for cross-project dashboard) ──

  async getSummary(agentId, ownerId = null) {
    this.#ensureSchema();
    if (!this.#resolveOwnedAgentId(agentId, ownerId)) return { error: 'Not a member of this team' };
    this.#maybeCleanup();
    return queryTeamSummary(this.sql);
  }
}

// Re-export path utility for consumers
export { normalizePath } from '../../lib/text-utils.js';
