// Team Durable Object — one instance per team.
// Manages team membership, activity tracking, file conflict detection,
// and shared project memory.

import { DurableObject } from 'cloudflare:workers';

// --- Tuning constants ---
const HEARTBEAT_ACTIVE_SECONDS = 60;    // Heartbeat within this window = "active"
const HEARTBEAT_STALE_SECONDS = 300;    // No heartbeat for this long = evicted
const MEMORY_DECAY_GRACE_DAYS = 7;      // Memories stay at full relevance for this long
const MEMORY_DECAY_RATE = 0.1;          // Relevance drops by this per day after grace period
const MEMORY_MIN_SCORE = 0.1;           // Floor — memories below this are excluded from queries
const MEMORY_MAX_COUNT = 100;           // Max memories per team before pruning
const ACTIVITY_MAX_FILES = 50;          // Max files tracked per agent activity

export class TeamDO extends DurableObject {
  #schemaReady = false;

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
        category TEXT NOT NULL CHECK(category IN ('gotcha', 'pattern', 'config', 'decision')),
        source_agent TEXT NOT NULL,
        source_handle TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        relevance_score REAL DEFAULT 1.0
      );
    `);

    this.#schemaReady = true;
  }

  #isMember(agentId) {
    return this.sql.exec('SELECT 1 FROM members WHERE agent_id = ?', agentId).toArray().length > 0;
  }

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

    return { conflicts };
  }

  async getContext(agentId) {
    this.#ensureSchema();
    if (!this.#isMember(agentId)) return { error: 'Not a member of this team' };

    // Evict stale members
    this.sql.exec(`DELETE FROM activities WHERE agent_id IN (
      SELECT agent_id FROM members
      WHERE last_heartbeat < datetime('now', '-${HEARTBEAT_STALE_SECONDS} seconds')
    )`);
    this.sql.exec(
      `DELETE FROM members WHERE last_heartbeat < datetime('now', '-${HEARTBEAT_STALE_SECONDS} seconds')`
    );

    const members = this.sql.exec(
      `SELECT m.owner_handle, a.files, a.summary, a.updated_at,
              CASE WHEN m.last_heartbeat > datetime('now', '-${HEARTBEAT_ACTIVE_SECONDS} seconds')
                THEN 'active' ELSE 'offline' END as status
       FROM members m
       LEFT JOIN activities a ON a.agent_id = m.agent_id`
    ).toArray();

    // Compute relevance inline — no mutating UPDATE on reads
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

    return {
      members: members.map(m => ({
        handle: m.owner_handle,
        status: m.status,
        activity: m.files ? {
          files: JSON.parse(m.files),
          summary: m.summary,
          updated_at: m.updated_at,
        } : null,
      })),
      memories,
    };
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

  async saveMemory(agentId, text, category, handle) {
    this.#ensureSchema();
    if (!this.#isMember(agentId)) return { error: 'Not a member of this team' };

    // Exact case-insensitive deduplication
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

    // Prune oldest low-relevance memories beyond the cap
    this.sql.exec(`
      DELETE FROM memories WHERE id NOT IN (
        SELECT id FROM memories ORDER BY relevance_score DESC, created_at DESC LIMIT ${MEMORY_MAX_COUNT}
      )
    `);

    return { ok: true, id };
  }
}

// Strip leading ./ and trailing /, collapse // — so "src/index.js" and "./src/index.js" match
function normalizePath(p) {
  return p.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
}
