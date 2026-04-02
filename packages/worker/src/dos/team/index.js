// Team Durable Object — one instance per team.
// Manages team membership, activity tracking, file conflict detection,
// shared project memory, and session history (observability).
//
// Business logic is split into submodules; this file owns the class shell,
// schema, cleanup, identity resolution, and the two composite queries
// (getContext / getSummary) that touch every table.

import { DurableObject } from 'cloudflare:workers';
import { join, leave, heartbeat as heartbeatFn } from './membership.js';
import { updateActivity as updateActivityFn, checkConflicts as checkConflictsFn, reportFile as reportFileFn } from './activity.js';
import { saveMemory as saveMemoryFn, searchMemories as searchMemoriesFn, updateMemory as updateMemoryFn, deleteMemory as deleteMemoryFn } from './memory.js';
import { claimFiles as claimFilesFn, releaseFiles as releaseFilesFn, getLockedFiles as getLockedFilesFn } from './locks.js';
import { startSession as startSessionFn, endSession as endSessionFn, recordEdit as recordEditFn, getSessionHistory, enrichSessionModel as enrichSessionModelFn } from './sessions.js';
import { sendMessage as sendMessageFn, getMessages as getMessagesFn } from './messages.js';
import { inferHostToolFromAgentId } from './runtime.js';

// --- Tuning constants ---
const HEARTBEAT_ACTIVE_SECONDS = 60;    // Heartbeat within this window = "active"
const HEARTBEAT_STALE_SECONDS = 300;    // No heartbeat for this long = evicted
const SESSION_RETENTION_DAYS = 30;      // How long session history is kept

export class TeamDO extends DurableObject {
  #schemaReady = false;
  #lastCleanup = 0;
  #lastHeartbeatBroadcast = new Map();

  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  // --- WebSocket support (Hibernation API) ---
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
      this.sql.exec("UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?", resolved);
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
    try {
      const data = JSON.parse(rawMessage);
      const tags = this.ctx.getTags(ws);
      const agentId = tags.find(t => !t.startsWith('role:'));
      const isAgent = tags.includes('role:agent');

      if (data.type === 'ping') {
        // Bump heartbeat so SQL queries that check last_heartbeat stay current
        if (agentId) {
          this.#ensureSchema();
          this.sql.exec("UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?", agentId);
        }
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (data.type === 'activity' && isAgent && agentId) {
        this.#ensureSchema();
        const result = updateActivityFn(this.sql, agentId, data.files || [], data.summary || '');
        if (!result.error) {
          this.#broadcastToWatchers({ type: 'activity', agent_id: agentId, files: data.files, summary: data.summary });
        }
      } else if (data.type === 'file' && isAgent && agentId) {
        this.#ensureSchema();
        const result = reportFileFn(this.sql, agentId, data.file);
        if (!result.error) {
          this.#broadcastToWatchers({ type: 'file', agent_id: agentId, file: data.file });
        }
      }
    } catch { /* ignore malformed messages */ }
  }

  async webSocketClose(ws) {
    const tags = this.ctx.getTags(ws);
    const isAgent = tags.includes('role:agent');
    const agentId = tags.find(t => !t.startsWith('role:'));

    if (isAgent && agentId) {
      this.#ensureSchema();
      // Release locks — agent is gone, don't block others
      releaseFilesFn(this.sql, agentId, null);
      this.#broadcastToWatchers({ type: 'status_change', agent_id: agentId, status: 'offline' });
      this.#broadcastToWatchers({ type: 'lock_change', action: 'release_all', agent_id: agentId });
    }
  }

  async webSocketError(ws) {
    // webSocketClose fires after — cleanup happens there
  }

  /** Agent IDs with an active 'role:agent' WebSocket connection. */
  #getConnectedAgentIds() {
    return new Set(
      this.ctx.getWebSockets('role:agent')
        .flatMap(ws => this.ctx.getTags(ws))
        .filter(tag => !tag.startsWith('role:'))
    );
  }

  #broadcastToWatchers(event) {
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;
    const data = JSON.stringify(event);
    for (const ws of sockets) {
      try { ws.send(data); } catch { /* dead connection */ }
    }
  }

  #ensureSchema() {
    const migrations = [
      ["ALTER TABLE members ADD COLUMN host_tool TEXT DEFAULT 'unknown'", "UPDATE members SET host_tool = tool WHERE host_tool IS NULL"],
      ["ALTER TABLE members ADD COLUMN agent_surface TEXT", null],
      ["ALTER TABLE members ADD COLUMN transport TEXT", null],
      ["ALTER TABLE locks ADD COLUMN host_tool TEXT DEFAULT 'unknown'", "UPDATE locks SET host_tool = tool WHERE host_tool IS NULL"],
      ["ALTER TABLE locks ADD COLUMN agent_surface TEXT", null],
      ["ALTER TABLE messages ADD COLUMN from_host_tool TEXT DEFAULT 'unknown'", "UPDATE messages SET from_host_tool = from_tool WHERE from_host_tool IS NULL"],
      ["ALTER TABLE messages ADD COLUMN from_agent_surface TEXT", null],
      ["ALTER TABLE memories ADD COLUMN source_host_tool TEXT DEFAULT 'unknown'", "UPDATE memories SET source_host_tool = source_tool WHERE source_host_tool IS NULL"],
      ["ALTER TABLE memories ADD COLUMN source_agent_surface TEXT", null],
      ["ALTER TABLE sessions ADD COLUMN host_tool TEXT DEFAULT 'unknown'", "UPDATE sessions SET host_tool = CASE WHEN instr(agent_id, ':') > 0 THEN substr(agent_id, 1, instr(agent_id, ':') - 1) ELSE 'unknown' END WHERE host_tool IS NULL"],
      ["ALTER TABLE sessions ADD COLUMN agent_surface TEXT", null],
      ["ALTER TABLE sessions ADD COLUMN transport TEXT", null],
      ["ALTER TABLE sessions ADD COLUMN agent_model TEXT", null],
      ["ALTER TABLE members ADD COLUMN agent_model TEXT", null],
      ["ALTER TABLE members ADD COLUMN signal_level INTEGER DEFAULT 1", null],
      ["ALTER TABLE memories ADD COLUMN source_model TEXT", null],
    ];
    for (const [alter, backfill] of migrations) {
      try {
        this.sql.exec(alter);
        if (backfill) this.sql.exec(backfill);
      } catch {}
    }

    if (this.#schemaReady) return;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS members (
        agent_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        owner_handle TEXT NOT NULL,
        tool TEXT DEFAULT 'unknown',
        host_tool TEXT DEFAULT 'unknown',
        agent_surface TEXT,
        transport TEXT,
        agent_model TEXT,
        joined_at TEXT DEFAULT (datetime('now')),
        last_heartbeat TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS activities (
        agent_id TEXT PRIMARY KEY,
        files TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        source_agent TEXT NOT NULL,
        source_handle TEXT,
        source_tool TEXT DEFAULT 'unknown',
        source_host_tool TEXT DEFAULT 'unknown',
        source_agent_surface TEXT,
        source_model TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        owner_handle TEXT NOT NULL,
        framework TEXT DEFAULT 'unknown',
        host_tool TEXT DEFAULT 'unknown',
        agent_surface TEXT,
        transport TEXT,
        agent_model TEXT,
        started_at TEXT DEFAULT (datetime('now')),
        ended_at TEXT,
        edit_count INTEGER DEFAULT 0,
        files_touched TEXT DEFAULT '[]',
        conflicts_hit INTEGER DEFAULT 0,
        memories_saved INTEGER DEFAULT 0
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS locks (
        file_path TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        owner_handle TEXT NOT NULL,
        tool TEXT DEFAULT 'unknown',
        host_tool TEXT DEFAULT 'unknown',
        agent_surface TEXT,
        claimed_at TEXT DEFAULT (datetime('now'))
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        from_agent TEXT NOT NULL,
        from_handle TEXT NOT NULL,
        from_tool TEXT DEFAULT 'unknown',
        from_host_tool TEXT DEFAULT 'unknown',
        from_agent_surface TEXT,
        target_agent TEXT,
        text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS telemetry (
        metric TEXT PRIMARY KEY,
        count INTEGER DEFAULT 0,
        last_at TEXT DEFAULT (datetime('now'))
      );
    `);

    this.sql.exec('CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id, ended_at)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS idx_locks_agent ON locks(agent_id)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at)');

    this.#schemaReady = true;
  }

  // Evict stale members and prune old sessions — at most once per minute.
  // Keeps getContext fast when polled frequently by channels/dashboards.
  #maybeCleanup() {
    const now = Date.now();
    if (now - this.#lastCleanup < 60_000) return;
    this.#lastCleanup = now;

    this.sql.exec(
      `DELETE FROM activities WHERE agent_id IN (
        SELECT agent_id FROM members
        WHERE last_heartbeat < datetime('now', '-' || ? || ' seconds')
      )`,
      HEARTBEAT_STALE_SECONDS
    );
    this.sql.exec(
      `DELETE FROM members WHERE last_heartbeat < datetime('now', '-' || ? || ' seconds')`,
      HEARTBEAT_STALE_SECONDS
    );
    this.sql.exec(
      `DELETE FROM sessions WHERE started_at < datetime('now', '-' || ? || ' days')`,
      SESSION_RETENTION_DAYS
    );
    // Expire messages older than 1 hour
    this.sql.exec("DELETE FROM messages WHERE created_at < datetime('now', '-1 hour')");
    // Auto-release locks for stale agents
    this.sql.exec(
      `DELETE FROM locks WHERE agent_id NOT IN (
        SELECT agent_id FROM members
        WHERE last_heartbeat > datetime('now', '-' || ? || ' seconds')
      )`,
      HEARTBEAT_STALE_SECONDS
    );
    // Auto-close orphaned sessions (agent stopped heartbeating)
    this.sql.exec(
      `UPDATE sessions SET ended_at = datetime('now')
       WHERE ended_at IS NULL
       AND agent_id NOT IN (
         SELECT agent_id FROM members
         WHERE last_heartbeat > datetime('now', '-' || ? || ' seconds')
       )`,
      HEARTBEAT_STALE_SECONDS
    );
  }

  #recordMetric(metric) {
    this.sql.exec(
      `INSERT INTO telemetry (metric, count, last_at) VALUES (?, 1, datetime('now'))
       ON CONFLICT(metric) DO UPDATE SET count = count + 1, last_at = datetime('now')`,
      metric
    );
  }

  #findExactMember(agentId) {
    const rows = this.sql.exec(
      'SELECT agent_id, owner_id FROM members WHERE agent_id = ?',
      agentId
    ).toArray();
    return rows[0] || null;
  }

  #findPrefixedMember(agentId) {
    const rows = this.sql.exec(
      "SELECT agent_id, owner_id FROM members WHERE agent_id LIKE ? || ':%' ORDER BY last_heartbeat DESC LIMIT 1",
      agentId
    ).toArray();
    return rows[0] || null;
  }

  #findLatestMemberForOwner(ownerId) {
    const rows = this.sql.exec(
      "SELECT agent_id, owner_id FROM members WHERE owner_id = ? ORDER BY last_heartbeat DESC LIMIT 1",
      ownerId
    ).toArray();
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

  #isMember(agentId, ownerId = null) {
    return Boolean(this.#resolveOwnedAgentId(agentId, ownerId));
  }

  // --- Bound helper for submodules that need to record telemetry ---
  #boundRecordMetric = (metric) => this.#recordMetric(metric);

  // --- Membership ---

  async join(agentId, ownerId, ownerHandle, runtimeOrTool = 'unknown') {
    this.#ensureSchema();
    const result = join(this.sql, agentId, ownerId, ownerHandle, runtimeOrTool, this.#boundRecordMetric);
    if (!result.error) {
      const tool = typeof runtimeOrTool === 'object' ? runtimeOrTool?.host_tool : runtimeOrTool;
      this.#broadcastToWatchers({ type: 'member_joined', agent_id: agentId, handle: ownerHandle, tool: tool || 'unknown' });
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

  async heartbeat(agentId, ownerId = null, signalLevel = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    const result = heartbeatFn(this.sql, resolved, signalLevel);
    if (!result.error) {
      const now = Date.now();
      const last = this.#lastHeartbeatBroadcast.get(resolved) || 0;
      if (now - last >= 3000) {
        this.#lastHeartbeatBroadcast.set(resolved, now);
        this.#broadcastToWatchers({ type: 'heartbeat', agent_id: resolved, ts: now });
      }
    }
    return result;
  }

  // --- Activity ---

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
    return checkConflictsFn(this.sql, resolved, files, this.#boundRecordMetric);
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

  // --- Context (composite query across all tables) ---

  async getContext(agentId, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };

    // Keep the calling agent's heartbeat fresh (for SQL queries in checkConflicts/getLocks)
    this.sql.exec("UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?", resolved);

    this.#maybeCleanup();

    // Primary presence: WebSocket connection state. Fallback: heartbeat timestamp.
    const connectedIds = this.#getConnectedAgentIds();

    const members = this.sql.exec(
      `SELECT m.agent_id, m.owner_handle, m.tool, m.host_tool, m.agent_surface, m.transport, m.agent_model,
              m.signal_level, a.files, a.summary, a.updated_at,
              s.framework, s.started_at as session_started,
              ROUND((julianday('now') - julianday(s.started_at)) * 24 * 60) as session_minutes,
              ROUND((julianday('now') - julianday(a.updated_at)) * 86400) as seconds_since_update,
              ROUND((julianday('now') - julianday(a.updated_at)) * 1440) as minutes_since_update,
              CASE WHEN m.last_heartbeat > datetime('now', '-' || ? || ' seconds')
                THEN 1 ELSE 0 END as heartbeat_active
       FROM members m
       LEFT JOIN activities a ON a.agent_id = m.agent_id
       LEFT JOIN sessions s ON s.agent_id = m.agent_id AND s.ended_at IS NULL`,
      HEARTBEAT_ACTIVE_SECONDS
    ).toArray();

    const memories = this.sql.exec(
      `SELECT id, text, tags, source_handle, source_tool, source_host_tool, source_agent_surface, source_model, created_at, updated_at
       FROM memories
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 20`
    ).toArray().map(m => ({ ...m, tags: JSON.parse(m.tags || '[]') }));

    const recentSessions = this.sql.exec(`
      SELECT agent_id, owner_handle, framework, host_tool, agent_surface, transport, agent_model, started_at, ended_at,
             edit_count, files_touched, conflicts_hit, memories_saved,
             ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60) as duration_minutes
      FROM sessions
      WHERE started_at > datetime('now', '-24 hours')
      ORDER BY started_at DESC
      LIMIT 20
    `).toArray();

    const memberList = members.map(m => {
      // WebSocket connection = active. Heartbeat fallback for hooks/HTTP-only agents.
      const status = connectedIds.has(m.agent_id) ? 'active'
        : m.heartbeat_active ? 'active' : 'offline';
      return {
        agent_id: m.agent_id,
        handle: m.owner_handle,
        tool: m.tool || m.host_tool || 'unknown',
        host_tool: m.host_tool || m.tool || 'unknown',
        agent_surface: m.agent_surface || null,
        transport: m.transport || null,
        agent_model: m.agent_model || null,
        status,
        framework: m.framework || null,
        session_minutes: m.session_minutes || null,
        seconds_since_update: m.seconds_since_update ?? null,
        minutes_since_update: m.minutes_since_update ?? null,
        signal_tier: connectedIds.has(m.agent_id) ? 'websocket'
          : m.signal_level >= 2 ? 'hook+mcp' : m.signal_level === 0 ? 'heartbeat-only' : 'mcp',
        activity: m.files ? {
          files: JSON.parse(m.files),
          summary: m.summary,
          updated_at: m.updated_at,
        } : null,
      };
    });

    // Server-side conflict detection — single source of truth
    const conflicts = [];
    const fileOwners = new Map();
    for (const m of memberList) {
      if (m.status !== 'active' || !m.activity?.files) continue;
      for (const f of m.activity.files) {
        if (!fileOwners.has(f)) fileOwners.set(f, []);
        fileOwners.get(f).push({ handle: m.handle, tool: m.tool });
      }
    }
    for (const [file, owners] of fileOwners) {
      if (owners.length > 1) {
        conflicts.push({
          file,
          agents: owners.map(o => o.tool !== 'unknown' ? `${o.handle} (${o.tool})` : o.handle),
        });
      }
    }

    // Active file locks
    const locks = this.sql.exec(
      `SELECT l.file_path, l.owner_handle, l.tool, l.host_tool, l.agent_surface,
              ROUND((julianday('now') - julianday(l.claimed_at)) * 1440) as minutes_held
       FROM locks l
       JOIN members m ON m.agent_id = l.agent_id
       WHERE m.last_heartbeat > datetime('now', '-' || ? || ' seconds')`,
      HEARTBEAT_ACTIVE_SECONDS
    ).toArray();

    // Recent messages (last 10 within the hour, visible to this agent)
    const messages = this.sql.exec(
      `SELECT from_handle, from_tool, from_host_tool, from_agent_surface, text, created_at
       FROM messages
       WHERE created_at > datetime('now', '-1 hour')
         AND (target_agent IS NULL OR target_agent = ?)
       ORDER BY created_at DESC LIMIT 10`,
      resolved
    ).toArray();

    // Telemetry — tool usage breakdown + key metrics
    const toolMetrics = this.sql.exec(
      "SELECT metric, count FROM telemetry WHERE metric LIKE 'tool:%' ORDER BY count DESC LIMIT 10"
    ).toArray();
    const tools_configured = toolMetrics.map(t => ({
      tool: t.metric.replace('tool:', ''),
      joins: t.count,
    }));

    const hostMetrics = this.sql.exec(
      "SELECT metric, count FROM telemetry WHERE metric LIKE 'host:%' ORDER BY count DESC LIMIT 10"
    ).toArray();
    const hosts_configured = hostMetrics.map(t => ({
      host_tool: t.metric.replace('host:', ''),
      joins: t.count,
    }));

    const surfaceMetrics = this.sql.exec(
      "SELECT metric, count FROM telemetry WHERE metric LIKE 'surface:%' ORDER BY count DESC LIMIT 10"
    ).toArray();
    const surfaces_seen = surfaceMetrics.map(t => ({
      agent_surface: t.metric.replace('surface:', ''),
      joins: t.count,
    }));

    const modelMetrics = this.sql.exec(
      "SELECT metric, count FROM telemetry WHERE metric LIKE 'model:%' ORDER BY count DESC LIMIT 10"
    ).toArray();
    const models_seen = modelMetrics.map(t => ({
      model: t.metric.replace('model:', ''),
      count: t.count,
    }));

    const keyMetrics = this.sql.exec(
      "SELECT metric, count FROM telemetry WHERE metric NOT LIKE 'tool:%'"
    ).toArray();
    const usage = {};
    for (const m of keyMetrics) usage[m.metric] = m.count;

    return {
      members: memberList,
      conflicts,
      locks,
      memories,
      messages,
      tools_configured,
      hosts_configured,
      surfaces_seen,
      models_seen,
      usage,
      recentSessions: recentSessions.map(s => {
        const toolFromAgent = s.host_tool || inferHostToolFromAgentId(s.agent_id);
        return {
          ...s,
          tool: toolFromAgent && toolFromAgent !== 'unknown' ? toolFromAgent : null,
          host_tool: s.host_tool || toolFromAgent || 'unknown',
          agent_surface: s.agent_surface || null,
          transport: s.transport || null,
          agent_model: s.agent_model || null,
          files_touched: JSON.parse(s.files_touched || '[]'),
        };
      }),
    };
  }

  // --- Sessions (observability) ---

  async startSession(agentId, handle, framework, runtimeOrOwnerId = null, ownerId = null) {
    this.#ensureSchema();
    const runtime = runtimeOrOwnerId && typeof runtimeOrOwnerId === 'object' ? runtimeOrOwnerId : null;
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

  // --- Memory ---

  async saveMemory(agentId, text, tags, handle, runtimeOrOwnerId = null, ownerId = null) {
    this.#ensureSchema();
    const runtime = runtimeOrOwnerId && typeof runtimeOrOwnerId === 'object' ? runtimeOrOwnerId : null;
    const resolvedOwnerId = runtime ? ownerId : runtimeOrOwnerId;
    const resolved = this.#resolveOwnedAgentId(agentId, resolvedOwnerId);
    if (!resolved) return { error: 'Not a member of this team' };
    const result = saveMemoryFn(this.sql, resolved, text, tags, handle, runtime, this.#boundRecordMetric);
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

  // --- File Locks ---

  async claimFiles(agentId, files, handle, runtimeOrTool, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    const result = claimFilesFn(this.sql, resolved, files, handle, runtimeOrTool);
    if (!result.error) {
      this.#broadcastToWatchers({ type: 'lock_change', action: 'claim', agent_id: resolved, files });
    }
    return result;
  }

  async releaseFiles(agentId, files, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    const result = releaseFilesFn(this.sql, resolved, files);
    if (!result.error) {
      this.#broadcastToWatchers({ type: 'lock_change', action: 'release', agent_id: resolved, files });
    }
    return result;
  }

  async getLockedFiles(agentId, ownerId = null) {
    this.#ensureSchema();
    if (!this.#resolveOwnedAgentId(agentId, ownerId)) return { error: 'Not a member of this team' };
    return getLockedFilesFn(this.sql);
  }

  // --- Messages ---

  async sendMessage(agentId, handle, runtimeOrTool, text, targetAgent, ownerId = null) {
    this.#ensureSchema();
    const resolved = this.#resolveOwnedAgentId(agentId, ownerId);
    if (!resolved) return { error: 'Not a member of this team' };
    const result = sendMessageFn(this.sql, resolved, handle, runtimeOrTool, text, targetAgent, this.#boundRecordMetric);
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

  // --- Summary (lightweight, for cross-project dashboard) ---

  async getSummary(agentId, ownerId = null) {
    this.#ensureSchema();
    if (!this.#resolveOwnedAgentId(agentId, ownerId)) return { error: 'Not a member of this team' };
    this.#maybeCleanup();

    const active = this.sql.exec(
      `SELECT COUNT(*) as c FROM members
       WHERE last_heartbeat > datetime('now', '-' || ? || ' seconds')`,
      HEARTBEAT_ACTIVE_SECONDS
    ).toArray();

    const total = this.sql.exec('SELECT COUNT(*) as c FROM members').toArray();

    // Conflict count: files claimed by 2+ active agents
    const activities = this.sql.exec(
      `SELECT a.files FROM activities a
       JOIN members m ON m.agent_id = a.agent_id
       WHERE m.last_heartbeat > datetime('now', '-' || ? || ' seconds')`,
      HEARTBEAT_ACTIVE_SECONDS
    ).toArray();

    const fileCounts = new Map();
    for (const row of activities) {
      if (!row.files) continue;
      for (const f of JSON.parse(row.files)) {
        fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
      }
    }
    const conflictCount = [...fileCounts.values()].filter(c => c > 1).length;

    const memoriesCount = this.sql.exec('SELECT COUNT(*) as c FROM memories').toArray();
    const live = this.sql.exec('SELECT COUNT(*) as c FROM sessions WHERE ended_at IS NULL').toArray();
    const recent = this.sql.exec(
      "SELECT COUNT(*) as c FROM sessions WHERE started_at > datetime('now', '-24 hours')"
    ).toArray();

    // Telemetry — tool usage breakdown
    const toolMetrics = this.sql.exec(
      "SELECT metric, count FROM telemetry WHERE metric LIKE 'tool:%' ORDER BY count DESC LIMIT 10"
    ).toArray();
    const tools_configured = toolMetrics.map(t => ({
      tool: t.metric.replace('tool:', ''),
      joins: t.count,
    }));

    const hostMetrics = this.sql.exec(
      "SELECT metric, count FROM telemetry WHERE metric LIKE 'host:%' ORDER BY count DESC LIMIT 10"
    ).toArray();
    const hosts_configured = hostMetrics.map(t => ({
      host_tool: t.metric.replace('host:', ''),
      joins: t.count,
    }));

    const surfaceMetrics = this.sql.exec(
      "SELECT metric, count FROM telemetry WHERE metric LIKE 'surface:%' ORDER BY count DESC LIMIT 10"
    ).toArray();
    const surfaces_seen = surfaceMetrics.map(t => ({
      agent_surface: t.metric.replace('surface:', ''),
      joins: t.count,
    }));

    const modelMetricsSummary = this.sql.exec(
      "SELECT metric, count FROM telemetry WHERE metric LIKE 'model:%' ORDER BY count DESC LIMIT 10"
    ).toArray();
    const models_seen = modelMetricsSummary.map(t => ({
      model: t.metric.replace('model:', ''),
      count: t.count,
    }));

    const keyMetrics = this.sql.exec(
      "SELECT metric, count FROM telemetry WHERE metric NOT LIKE 'tool:%'"
    ).toArray();
    const usage = {};
    for (const m of keyMetrics) usage[m.metric] = m.count;

    return {
      active_agents: active[0]?.c || 0,
      total_members: total[0]?.c || 0,
      conflict_count: conflictCount,
      memory_count: memoriesCount[0]?.c || 0,
      live_sessions: live[0]?.c || 0,
      recent_sessions_24h: recent[0]?.c || 0,
      tools_configured,
      hosts_configured,
      surfaces_seen,
      models_seen,
      usage,
    };
  }
}

// Re-export path utility for consumers
export { normalizePath } from '../../lib/text-utils.js';
