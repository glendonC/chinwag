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
        tool TEXT DEFAULT 'unknown',
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

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS locks (
        file_path TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        owner_handle TEXT NOT NULL,
        tool TEXT DEFAULT 'unknown',
        claimed_at TEXT DEFAULT (datetime('now'))
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        from_agent TEXT NOT NULL,
        from_handle TEXT NOT NULL,
        from_tool TEXT DEFAULT 'unknown',
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

    // Additive migration: add tool column if missing (safe for existing DOs)
    try { this.sql.exec("ALTER TABLE members ADD COLUMN tool TEXT DEFAULT 'unknown'"); } catch { /* already exists */ }

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

  #isMember(agentId, ownerId = null) {
    // Direct match by agent_id (tool-specific IDs like "cursor:abc123")
    const row = this.sql.exec('SELECT owner_id FROM members WHERE agent_id = ?', agentId).toArray();
    if (row.length > 0) {
      // If ownerId provided, verify the agent belongs to this user (prevents spoofing)
      return ownerId ? row[0].owner_id === ownerId : true;
    }
    // Fallback: check by owner_id (backward compat for CLI/old clients sending user UUID)
    const byOwner = ownerId || agentId;
    return this.sql.exec('SELECT 1 FROM members WHERE owner_id = ?', byOwner).toArray().length > 0;
  }

  // --- Membership ---

  async join(agentId, ownerId, ownerHandle, tool = 'unknown') {
    this.#ensureSchema();
    this.sql.exec(
      `INSERT INTO members (agent_id, owner_id, owner_handle, tool, joined_at, last_heartbeat)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(agent_id) DO UPDATE SET
         owner_id = excluded.owner_id,
         owner_handle = excluded.owner_handle,
         tool = excluded.tool,
         last_heartbeat = datetime('now')`,
      agentId, ownerId, ownerHandle, tool
    );
    this.#recordMetric('joins');
    this.#recordMetric(`tool:${tool}`);
    return { ok: true };
  }

  async leave(agentId) {
    this.#ensureSchema();
    this.sql.exec('DELETE FROM locks WHERE agent_id = ?', agentId);
    this.sql.exec('DELETE FROM activities WHERE agent_id = ?', agentId);
    this.sql.exec('DELETE FROM members WHERE agent_id = ?', agentId);
    const changed = this.sql.exec('SELECT changes() as c').toArray();
    // Fallback: if specific agent_id not found, remove all agents for this owner
    // (handles legacy callers sending user UUID as agentId)
    if (changed[0].c === 0) {
      this.sql.exec('DELETE FROM locks WHERE agent_id IN (SELECT agent_id FROM members WHERE owner_id = ?)', agentId);
      this.sql.exec('DELETE FROM activities WHERE agent_id IN (SELECT agent_id FROM members WHERE owner_id = ?)', agentId);
      this.sql.exec('DELETE FROM members WHERE owner_id = ?', agentId);
    }
    return { ok: true };
  }

  async heartbeat(agentId, ownerId = null) {
    this.#ensureSchema();
    this.sql.exec("UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?", agentId);
    const row = this.sql.exec('SELECT changes() as c').toArray();
    if (row[0].c === 0) return { error: 'Not a member of this team' };
    return { ok: true };
  }

  // --- Activity ---

  async updateActivity(agentId, files, summary, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

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

  async checkConflicts(agentId, files, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

    const others = this.sql.exec(
      `SELECT m.agent_id, m.owner_handle, m.tool, a.files, a.summary
       FROM members m
       LEFT JOIN activities a ON a.agent_id = m.agent_id
       WHERE m.agent_id != ?
         AND m.last_heartbeat > datetime('now', '-' || ? || ' seconds')`,
      agentId, HEARTBEAT_ACTIVE_SECONDS
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
          tool: row.tool || 'unknown',
          files: overlap,
          summary: row.summary || '',
        });
      }
    }

    // Check file locks — files locked by other agents are also conflicts
    const lockedFiles = [];
    const fileList = [...myFiles];
    if (fileList.length > 0) {
      const placeholders = fileList.map(() => '?').join(',');
      const lockRows = this.sql.exec(
        `SELECT file_path, owner_handle, tool, claimed_at FROM locks
         WHERE file_path IN (${placeholders}) AND agent_id != ?`,
        ...fileList, agentId
      ).toArray();
      for (const lock of lockRows) {
        lockedFiles.push({
          file: lock.file_path,
          held_by: lock.owner_handle,
          tool: lock.tool || 'unknown',
          claimed_at: lock.claimed_at,
        });
      }
    }

    this.#recordMetric('conflict_checks');
    // Record conflicts in active session for the requesting agent
    if (conflicts.length > 0 || lockedFiles.length > 0) {
      this.#recordMetric('conflicts_found');
      this.sql.exec(
        `UPDATE sessions SET conflicts_hit = conflicts_hit + 1
         WHERE agent_id = ? AND ended_at IS NULL`,
        agentId
      );
    }

    return { conflicts, locked: lockedFiles };
  }

  async reportFile(agentId, filePath, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

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

  async getContext(agentId, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

    this.#maybeCleanup();

    const members = this.sql.exec(
      `SELECT m.agent_id, m.owner_handle, m.tool, a.files, a.summary, a.updated_at,
              s.framework, s.started_at as session_started,
              ROUND((julianday('now') - julianday(s.started_at)) * 24 * 60) as session_minutes,
              ROUND((julianday('now') - julianday(a.updated_at)) * 1440) as minutes_since_update,
              CASE WHEN m.last_heartbeat > datetime('now', '-' || ? || ' seconds')
                THEN 'active' ELSE 'offline' END as status
       FROM members m
       LEFT JOIN activities a ON a.agent_id = m.agent_id
       LEFT JOIN sessions s ON s.agent_id = m.agent_id AND s.ended_at IS NULL`,
      HEARTBEAT_ACTIVE_SECONDS
    ).toArray();

    const memories = this.sql.exec(
      `SELECT id, text, category, source_handle, created_at,
              MAX(?,
                1.0 - (MAX(0, julianday('now') - julianday(created_at) - ?) * ?)
              ) as relevance
       FROM memories
       WHERE MAX(?,
               1.0 - (MAX(0, julianday('now') - julianday(created_at) - ?) * ?)
             ) > ?
       ORDER BY relevance DESC, created_at DESC
       LIMIT 10`,
      MEMORY_MIN_SCORE, MEMORY_DECAY_GRACE_DAYS, MEMORY_DECAY_RATE,
      MEMORY_MIN_SCORE, MEMORY_DECAY_GRACE_DAYS, MEMORY_DECAY_RATE,
      MEMORY_MIN_SCORE
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

    const memberList = members.map(m => ({
      agent_id: m.agent_id,
      handle: m.owner_handle,
      tool: m.tool || 'unknown',
      status: m.status,
      framework: m.framework || null,
      session_minutes: m.session_minutes || null,
      minutes_since_update: m.minutes_since_update ?? null,
      activity: m.files ? {
        files: JSON.parse(m.files),
        summary: m.summary,
        updated_at: m.updated_at,
      } : null,
    }));

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
      `SELECT l.file_path, l.owner_handle, l.tool,
              ROUND((julianday('now') - julianday(l.claimed_at)) * 1440) as minutes_held
       FROM locks l
       JOIN members m ON m.agent_id = l.agent_id
       WHERE m.last_heartbeat > datetime('now', '-' || ? || ' seconds')`,
      HEARTBEAT_ACTIVE_SECONDS
    ).toArray();

    // Recent messages (last 10 within the hour, visible to this agent)
    const messages = this.sql.exec(
      `SELECT from_handle, from_tool, text, created_at
       FROM messages
       WHERE created_at > datetime('now', '-1 hour')
         AND (target_agent IS NULL OR target_agent = ?)
       ORDER BY created_at DESC LIMIT 10`,
      agentId
    ).toArray();

    return {
      members: memberList,
      conflicts,
      locks,
      memories,
      messages,
      recentSessions: recentSessions.map(s => ({
        ...s,
        files_touched: JSON.parse(s.files_touched || '[]'),
      })),
    };
  }

  // --- Sessions (observability) ---

  async startSession(agentId, handle, framework, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

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

  async endSession(agentId, sessionId, ownerId = null) {
    this.#ensureSchema();
    this.sql.exec(
      `UPDATE sessions SET ended_at = datetime('now') WHERE id = ? AND agent_id = ? AND ended_at IS NULL`,
      sessionId, agentId
    );
    const changed = this.sql.exec('SELECT changes() as c').toArray();
    if (changed[0].c === 0) return { error: 'Session not found or not owned by this agent' };
    return { ok: true };
  }

  async recordEdit(agentId, filePath, ownerId = null) {
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

  async getHistory(agentId, days, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };
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

  async saveMemory(agentId, text, category, handle, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

    if (!VALID_CATEGORIES.includes(category)) {
      return { error: `Category must be one of: ${VALID_CATEGORIES.join(', ')}` };
    }

    // Fuzzy dedup: check word-level similarity against recent memories
    const newWords = extractWords(text);
    const candidates = this.sql.exec(
      'SELECT id, text FROM memories ORDER BY created_at DESC LIMIT 50'
    ).toArray();

    for (const candidate of candidates) {
      const candidateWords = extractWords(candidate.text);
      if (wordSimilarity(newWords, candidateWords) > 0.7) {
        // High similarity — boost existing memory instead of creating duplicate
        this.sql.exec(
          `UPDATE memories SET relevance_score = MIN(relevance_score + 0.5, 2.0), created_at = datetime('now') WHERE id = ?`,
          candidate.id
        );
        return { ok: true, deduplicated: true, matched_id: candidate.id };
      }
    }

    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO memories (id, text, category, source_agent, source_handle, created_at, relevance_score)
       VALUES (?, ?, ?, ?, ?, datetime('now'), 1.0)`,
      id, text, category, agentId, handle || 'unknown'
    );

    this.sql.exec(
      `DELETE FROM memories WHERE id NOT IN (
        SELECT id FROM memories ORDER BY relevance_score DESC, created_at DESC LIMIT ?
      )`,
      MEMORY_MAX_COUNT
    );

    // Record in active session
    this.sql.exec(
      `UPDATE sessions SET memories_saved = memories_saved + 1
       WHERE agent_id = ? AND ended_at IS NULL`,
      agentId
    );
    this.#recordMetric('memories_saved');

    return { ok: true, id };
  }

  async searchMemories(agentId, query, category, limit = 20, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

    const cappedLimit = Math.min(Math.max(1, limit), 50);
    let sql, params;

    if (query && category) {
      sql = `SELECT id, text, category, source_handle, created_at, relevance_score
             FROM memories WHERE text LIKE ? AND category = ?
             ORDER BY relevance_score DESC, created_at DESC LIMIT ?`;
      params = [`%${query}%`, category, cappedLimit];
    } else if (query) {
      sql = `SELECT id, text, category, source_handle, created_at, relevance_score
             FROM memories WHERE text LIKE ?
             ORDER BY relevance_score DESC, created_at DESC LIMIT ?`;
      params = [`%${query}%`, cappedLimit];
    } else if (category) {
      sql = `SELECT id, text, category, source_handle, created_at, relevance_score
             FROM memories WHERE category = ?
             ORDER BY relevance_score DESC, created_at DESC LIMIT ?`;
      params = [category, cappedLimit];
    } else {
      sql = `SELECT id, text, category, source_handle, created_at, relevance_score
             FROM memories ORDER BY relevance_score DESC, created_at DESC LIMIT ?`;
      params = [cappedLimit];
    }

    const rows = this.sql.exec(sql, ...params).toArray();
    return { memories: rows };
  }

  async updateMemory(agentId, memoryId, text, category, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

    if (text !== undefined && (typeof text !== 'string' || !text.trim())) {
      return { error: 'text must be a non-empty string' };
    }
    if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
      return { error: `Category must be one of: ${VALID_CATEGORIES.join(', ')}` };
    }

    // Verify memory exists
    const existing = this.sql.exec('SELECT id FROM memories WHERE id = ?', memoryId).toArray();
    if (existing.length === 0) return { error: 'Memory not found' };

    if (text !== undefined && category !== undefined) {
      this.sql.exec('UPDATE memories SET text = ?, category = ?, relevance_score = 1.0 WHERE id = ?',
        text.trim(), category, memoryId);
    } else if (text !== undefined) {
      this.sql.exec('UPDATE memories SET text = ?, relevance_score = 1.0 WHERE id = ?',
        text.trim(), memoryId);
    } else if (category !== undefined) {
      this.sql.exec('UPDATE memories SET category = ? WHERE id = ?', category, memoryId);
    }

    return { ok: true };
  }

  async deleteMemory(agentId, memoryId, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

    this.sql.exec('DELETE FROM memories WHERE id = ?', memoryId);
    const changed = this.sql.exec('SELECT changes() as c').toArray();
    if (changed[0].c === 0) return { error: 'Memory not found' };
    return { ok: true };
  }

  // --- File Locks (advisory locking for conflict resolution) ---

  async claimFiles(agentId, files, handle, tool, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

    const normalized = files.map(normalizePath);
    const claimed = [];
    const blocked = [];

    for (const file of normalized) {
      // Check if already locked by another agent
      const existing = this.sql.exec(
        'SELECT agent_id, owner_handle, tool, claimed_at FROM locks WHERE file_path = ?', file
      ).toArray();

      if (existing.length > 0 && existing[0].agent_id !== agentId) {
        const lock = existing[0];
        blocked.push({
          file,
          held_by: lock.owner_handle,
          tool: lock.tool || 'unknown',
          claimed_at: lock.claimed_at,
        });
        continue;
      }

      // Claim or refresh the lock
      this.sql.exec(
        `INSERT INTO locks (file_path, agent_id, owner_handle, tool, claimed_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(file_path) DO UPDATE SET
           agent_id = excluded.agent_id,
           owner_handle = excluded.owner_handle,
           tool = excluded.tool,
           claimed_at = datetime('now')`,
        file, agentId, handle || 'unknown', tool || 'unknown'
      );
      claimed.push(file);
    }

    return { ok: true, claimed, blocked };
  }

  async releaseFiles(agentId, files, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

    if (!files || files.length === 0) {
      // Release all locks for this agent
      this.sql.exec('DELETE FROM locks WHERE agent_id = ?', agentId);
    } else {
      const normalized = files.map(normalizePath);
      for (const file of normalized) {
        this.sql.exec('DELETE FROM locks WHERE file_path = ? AND agent_id = ?', file, agentId);
      }
    }
    return { ok: true };
  }

  async getLockedFiles(agentId, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

    const locks = this.sql.exec(
      `SELECT l.file_path, l.agent_id, l.owner_handle, l.tool, l.claimed_at,
              ROUND((julianday('now') - julianday(l.claimed_at)) * 1440) as minutes_held
       FROM locks l
       JOIN members m ON m.agent_id = l.agent_id
       WHERE m.last_heartbeat > datetime('now', '-' || ? || ' seconds')
       ORDER BY l.claimed_at DESC`,
      HEARTBEAT_ACTIVE_SECONDS
    ).toArray();

    return { locks };
  }

  // --- Agent Messages (ephemeral coordination, auto-expire after 1 hour) ---

  async sendMessage(agentId, handle, tool, text, targetAgent, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO messages (id, from_agent, from_handle, from_tool, target_agent, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      id, agentId, handle || 'unknown', tool || 'unknown', targetAgent || null, text
    );
    this.#recordMetric('messages_sent');
    return { ok: true, id };
  }

  async getMessages(agentId, since, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };

    const messages = this.sql.exec(
      `SELECT id, from_handle, from_tool, target_agent, text, created_at
       FROM messages
       WHERE created_at > COALESCE(?, datetime('now', '-1 hour'))
         AND (target_agent IS NULL OR target_agent = ?)
       ORDER BY created_at DESC
       LIMIT 50`,
      since || null, agentId
    ).toArray();

    return { messages };
  }

  // --- Summary (lightweight, for cross-project dashboard) ---

  async getSummary(agentId, ownerId = null) {
    this.#ensureSchema();
    if (!this.#isMember(agentId, ownerId)) return { error: 'Not a member of this team' };
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

    const memories = this.sql.exec('SELECT COUNT(*) as c FROM memories').toArray();
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

    const keyMetrics = this.sql.exec(
      "SELECT metric, count FROM telemetry WHERE metric NOT LIKE 'tool:%'"
    ).toArray();
    const usage = {};
    for (const m of keyMetrics) usage[m.metric] = m.count;

    return {
      active_agents: active[0]?.c || 0,
      total_members: total[0]?.c || 0,
      conflict_count: conflictCount,
      memory_count: memories[0]?.c || 0,
      live_sessions: live[0]?.c || 0,
      recent_sessions_24h: recent[0]?.c || 0,
      tools_configured,
      usage,
    };
  }
}

// Strip leading ./ and trailing /, collapse // — so "src/index.js" and "./src/index.js" match
export function normalizePath(p) {
  return p.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
}

// Extract significant words for fuzzy dedup (lowercase, >2 chars, no stop words)
const STOP_WORDS = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'this', 'that', 'with', 'from', 'they', 'will', 'when', 'make', 'use', 'used', 'uses', 'using', 'must', 'need', 'needs']);

export function extractWords(text) {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

// Jaccard similarity between two word sets
export function wordSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) { if (b.has(w)) intersection++; }
  return intersection / (a.size + b.size - intersection);
}
