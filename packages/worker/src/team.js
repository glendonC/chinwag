// Team Durable Object — one instance per team.
// Manages team membership, activity tracking, file conflict detection,
// shared project memory, and session history (observability).

import { DurableObject } from 'cloudflare:workers';

// --- Tuning constants ---
const HEARTBEAT_ACTIVE_SECONDS = 60;    // Heartbeat within this window = "active"
const HEARTBEAT_STALE_SECONDS = 300;    // No heartbeat for this long = evicted
const MEMORY_DECAY_GRACE_DAYS = 7;      // Memories stay at full relevance for this long
const MEMORY_DECAY_RATE = 0.1;          // Relevance drops by this per day after grace period
const MEMORY_MIN_SCORE = 0.1;           // Floor — memories below this are excluded from queries
const MEMORY_MAX_COUNT = 100;           // Max memories per team before pruning
const ACTIVITY_MAX_FILES = 50;          // Max files tracked per agent activity
const SESSION_RETENTION_DAYS = 30;      // How long session history is kept
export const VALID_CATEGORIES = ['gotcha', 'pattern', 'config', 'decision', 'reference'];

export class TeamDO extends DurableObject {
  #schemaReady = false;
  #lastCleanup = 0;

  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  #ensureSchema() {
    if (this.#schemaReady) return;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS members (
        agent_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        owner_handle TEXT NOT NULL,
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
        category TEXT NOT NULL,
        source_agent TEXT NOT NULL,
        source_handle TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        relevance_score REAL DEFAULT 1.0
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        owner_handle TEXT NOT NULL,
        framework TEXT DEFAULT 'unknown',
        started_at TEXT DEFAULT (datetime('now')),
        ended_at TEXT,
        edit_count INTEGER DEFAULT 0,
        files_touched TEXT DEFAULT '[]',
        conflicts_hit INTEGER DEFAULT 0,
        memories_saved INTEGER DEFAULT 0
      );
    `);

    this.#schemaReady = true;
  }

  // Evict stale members and prune old sessions — at most once per minute.
  // Keeps getContext fast when polled frequently by channels/dashboards.
  #maybeCleanup() {
    const now = Date.now();
    if (now - this.#lastCleanup < 60_000) return;
    this.#lastCleanup = now;

    this.sql.exec(`DELETE FROM activities WHERE agent_id IN (
      SELECT agent_id FROM members
      WHERE last_heartbeat < datetime('now', '-${HEARTBEAT_STALE_SECONDS} seconds')
    )`);
    this.sql.exec(
      `DELETE FROM members WHERE last_heartbeat < datetime('now', '-${HEARTBEAT_STALE_SECONDS} seconds')`
    );
    this.sql.exec(
      `DELETE FROM sessions WHERE started_at < datetime('now', '-${SESSION_RETENTION_DAYS} days')`
    );
  }

  #isMember(agentId) {
    return this.sql.exec('SELECT 1 FROM members WHERE agent_id = ?', agentId).toArray().length > 0;
  }

  // --- Membership ---

  async join(agentId, ownerId, ownerHandle) {
    this.#ensureSchema();
    this.sql.exec(
      `INSERT INTO members (agent_id, owner_id, owner_handle, joined_at, last_heartbeat)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(agent_id) DO UPDATE SET
         owner_id = excluded.owner_id,
         owner_handle = excluded.owner_handle,
         last_heartbeat = datetime('now')`,
      agentId, ownerId, ownerHandle
    );
    return { ok: true };
  }

  async leave(agentId) {
    this.#ensureSchema();
    this.sql.exec('DELETE FROM activities WHERE agent_id = ?', agentId);
    this.sql.exec('DELETE FROM members WHERE agent_id = ?', agentId);
    return { ok: true };
  }

  async heartbeat(agentId) {
    this.#ensureSchema();
    this.sql.exec("UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?", agentId);
    const row = this.sql.exec('SELECT changes() as c').toArray();
    if (row[0].c === 0) return { error: 'Not a member of this team' };
    return { ok: true };
  }

  // --- Activity ---

  async updateActivity(agentId, files, summary) {
    this.#ensureSchema();
    if (!this.#isMember(agentId)) return { error: 'Not a member of this team' };

    const normalized = files.map(normalizePath);

    this.sql.exec(
      `INSERT INTO activities (agent_id, files, summary, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(agent_id) DO UPDATE SET
         files = excluded.files,
         summary = excluded.summary,
         updated_at = datetime('now')`,
      agentId, JSON.stringify(normalized), summary
    );
    this.sql.exec("UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?", agentId);
    return { ok: true };
  }

  async checkConflicts(agentId, files) {
    this.#ensureSchema();
    if (!this.#isMember(agentId)) return { error: 'Not a member of this team' };

    const others = this.sql.exec(
      `SELECT m.agent_id, m.owner_handle, a.files, a.summary
       FROM members m
       LEFT JOIN activities a ON a.agent_id = m.agent_id
       WHERE m.agent_id != ?
         AND m.last_heartbeat > datetime('now', '-${HEARTBEAT_ACTIVE_SECONDS} seconds')`,
      agentId
    ).toArray();

    const myFiles = new Set(files.map(normalizePath));
    const conflicts = [];

    for (const row of others) {
      if (!row.files) continue;
      const theirFiles = JSON.parse(row.files);
      const overlap = theirFiles.filter(f => myFiles.has(f));
      if (overlap.length > 0) {
        conflicts.push({
          owner_handle: row.owner_handle,
          files: overlap,
          summary: row.summary || '',
        });
      }
    }

    // Record conflicts in active session for the requesting agent
    if (conflicts.length > 0) {
      this.sql.exec(
        `UPDATE sessions SET conflicts_hit = conflicts_hit + 1
         WHERE agent_id = ? AND ended_at IS NULL`,
        agentId
      );
    }

    return { conflicts };
  }

  async reportFile(agentId, filePath) {
    this.#ensureSchema();
    if (!this.#isMember(agentId)) return { error: 'Not a member of this team' };

    const normalized = normalizePath(filePath);

    const existing = this.sql.exec(
      'SELECT files FROM activities WHERE agent_id = ?', agentId
    ).toArray();

    let files = [];
    if (existing.length > 0 && existing[0].files) {
      files = JSON.parse(existing[0].files);
    }

    if (!files.includes(normalized)) {
      files.push(normalized);
      if (files.length > ACTIVITY_MAX_FILES) files = files.slice(-ACTIVITY_MAX_FILES);
    }

    this.sql.exec(
      `INSERT INTO activities (agent_id, files, summary, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(agent_id) DO UPDATE SET
         files = excluded.files,
         updated_at = datetime('now')`,
      agentId, JSON.stringify(files), `Editing ${normalized}`
    );
    this.sql.exec("UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?", agentId);
    return { ok: true };
  }

  // --- Context ---

  async getContext(agentId) {
    this.#ensureSchema();
    if (!this.#isMember(agentId)) return { error: 'Not a member of this team' };

    this.#maybeCleanup();

    const members = this.sql.exec(
      `SELECT m.owner_handle, a.files, a.summary, a.updated_at,
              s.framework, s.started_at as session_started,
              ROUND((julianday('now') - julianday(s.started_at)) * 24 * 60) as session_minutes,
              CASE WHEN m.last_heartbeat > datetime('now', '-${HEARTBEAT_ACTIVE_SECONDS} seconds')
                THEN 'active' ELSE 'offline' END as status
       FROM members m
       LEFT JOIN activities a ON a.agent_id = m.agent_id
       LEFT JOIN sessions s ON s.agent_id = m.agent_id AND s.ended_at IS NULL`
    ).toArray();

    const memories = this.sql.exec(
      `SELECT text, category, source_handle, created_at,
              MAX(${MEMORY_MIN_SCORE},
                1.0 - (MAX(0, julianday('now') - julianday(created_at) - ${MEMORY_DECAY_GRACE_DAYS}) * ${MEMORY_DECAY_RATE})
              ) as relevance
       FROM memories
       WHERE MAX(${MEMORY_MIN_SCORE},
               1.0 - (MAX(0, julianday('now') - julianday(created_at) - ${MEMORY_DECAY_GRACE_DAYS}) * ${MEMORY_DECAY_RATE})
             ) > ${MEMORY_MIN_SCORE}
       ORDER BY relevance DESC, created_at DESC
       LIMIT 10`
    ).toArray();

    const recentSessions = this.sql.exec(`
      SELECT owner_handle, framework, started_at, ended_at,
             edit_count, files_touched, conflicts_hit, memories_saved,
             ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60) as duration_minutes
      FROM sessions
      WHERE started_at > datetime('now', '-24 hours')
      ORDER BY started_at DESC
      LIMIT 20
    `).toArray();

    return {
      members: members.map(m => ({
        handle: m.owner_handle,
        status: m.status,
        framework: m.framework || null,
        session_minutes: m.session_minutes || null,
        activity: m.files ? {
          files: JSON.parse(m.files),
          summary: m.summary,
          updated_at: m.updated_at,
        } : null,
      })),
      memories,
      recentSessions: recentSessions.map(s => ({
        ...s,
        files_touched: JSON.parse(s.files_touched || '[]'),
      })),
    };
  }

  // --- Sessions (observability) ---

  async startSession(agentId, handle, framework) {
    this.#ensureSchema();
    if (!this.#isMember(agentId)) return { error: 'Not a member of this team' };

    // End any existing open session for this agent
    this.sql.exec(
      `UPDATE sessions SET ended_at = datetime('now') WHERE agent_id = ? AND ended_at IS NULL`,
      agentId
    );

    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO sessions (id, agent_id, owner_handle, framework, started_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      id, agentId, handle, framework || 'unknown'
    );
    return { ok: true, session_id: id };
  }

  async endSession(agentId, sessionId) {
    this.#ensureSchema();
    this.sql.exec(
      `UPDATE sessions SET ended_at = datetime('now') WHERE id = ? AND agent_id = ? AND ended_at IS NULL`,
      sessionId, agentId
    );
    const changed = this.sql.exec('SELECT changes() as c').toArray();
    if (changed[0].c === 0) return { error: 'Session not found or not owned by this agent' };
    return { ok: true };
  }

  async recordEdit(agentId, filePath) {
    this.#ensureSchema();
    const normalized = normalizePath(filePath);

    // Find the active session for this agent
    const sessions = this.sql.exec(
      'SELECT id, files_touched FROM sessions WHERE agent_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
      agentId
    ).toArray();

    if (sessions.length === 0) return { ok: true, skipped: true }; // No active session — caller can log if needed

    const session = sessions[0];
    let files = JSON.parse(session.files_touched || '[]');
    if (!files.includes(normalized)) {
      files.push(normalized);
      if (files.length > ACTIVITY_MAX_FILES) files = files.slice(-ACTIVITY_MAX_FILES);
    }

    this.sql.exec(
      `UPDATE sessions SET edit_count = edit_count + 1, files_touched = ? WHERE id = ?`,
      JSON.stringify(files), session.id
    );
    return { ok: true };
  }

  async getHistory(agentId, days) {
    this.#ensureSchema();
    if (!this.#isMember(agentId)) return { error: 'Not a member of this team' };
    const sessions = this.sql.exec(
      `SELECT owner_handle, framework, started_at, ended_at,
             edit_count, files_touched, conflicts_hit, memories_saved,
             ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60) as duration_minutes
       FROM sessions
       WHERE started_at > datetime('now', '-' || ? || ' days')
       ORDER BY started_at DESC
       LIMIT 50`,
      days
    ).toArray();

    return {
      sessions: sessions.map(s => ({
        ...s,
        files_touched: JSON.parse(s.files_touched || '[]'),
      })),
    };
  }

  // --- Memory ---

  async saveMemory(agentId, text, category, handle) {
    this.#ensureSchema();
    if (!this.#isMember(agentId)) return { error: 'Not a member of this team' };

    if (!VALID_CATEGORIES.includes(category)) {
      return { error: `Category must be one of: ${VALID_CATEGORIES.join(', ')}` };
    }

    const normalized = text.trim().toLowerCase();
    const existing = this.sql.exec(
      'SELECT id FROM memories WHERE LOWER(TRIM(text)) = ?', normalized
    ).toArray();

    if (existing.length > 0) {
      this.sql.exec(
        `UPDATE memories SET relevance_score = 1.0, created_at = datetime('now') WHERE id = ?`,
        existing[0].id
      );
      return { ok: true, deduplicated: true };
    }

    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO memories (id, text, category, source_agent, source_handle, created_at, relevance_score)
       VALUES (?, ?, ?, ?, ?, datetime('now'), 1.0)`,
      id, text, category, agentId, handle || 'unknown'
    );

    this.sql.exec(`
      DELETE FROM memories WHERE id NOT IN (
        SELECT id FROM memories ORDER BY relevance_score DESC, created_at DESC LIMIT ${MEMORY_MAX_COUNT}
      )
    `);

    // Record in active session
    this.sql.exec(
      `UPDATE sessions SET memories_saved = memories_saved + 1
       WHERE agent_id = ? AND ended_at IS NULL`,
      agentId
    );

    return { ok: true, id };
  }

  // --- Summary (lightweight, for cross-project dashboard) ---

  async getSummary(agentId) {
    this.#ensureSchema();
    if (!this.#isMember(agentId)) return { error: 'Not a member of this team' };
    this.#maybeCleanup();

    const active = this.sql.exec(
      `SELECT COUNT(*) as c FROM members
       WHERE last_heartbeat > datetime('now', '-${HEARTBEAT_ACTIVE_SECONDS} seconds')`
    ).toArray();

    const total = this.sql.exec('SELECT COUNT(*) as c FROM members').toArray();

    // Conflict count: files claimed by 2+ active agents
    const activities = this.sql.exec(
      `SELECT a.files FROM activities a
       JOIN members m ON m.agent_id = a.agent_id
       WHERE m.last_heartbeat > datetime('now', '-${HEARTBEAT_ACTIVE_SECONDS} seconds')`
    ).toArray();

    const fileCounts = new Map();
    for (const row of activities) {
      if (!row.files) continue;
      for (const f of JSON.parse(row.files)) {
        fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
      }
    }
    const conflictCount = [...fileCounts.values()].filter(c => c > 1).length;

    const memories = this.sql.exec('SELECT COUNT(*) as c FROM memories').toArray();
    const live = this.sql.exec('SELECT COUNT(*) as c FROM sessions WHERE ended_at IS NULL').toArray();
    const recent = this.sql.exec(
      "SELECT COUNT(*) as c FROM sessions WHERE started_at > datetime('now', '-24 hours')"
    ).toArray();

    return {
      active_agents: active[0]?.c || 0,
      total_members: total[0]?.c || 0,
      conflict_count: conflictCount,
      memory_count: memories[0]?.c || 0,
      live_sessions: live[0]?.c || 0,
      recent_sessions_24h: recent[0]?.c || 0,
    };
  }
}

// Strip leading ./ and trailing /, collapse // — so "src/index.js" and "./src/index.js" match
function normalizePath(p) {
  return p.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
}
