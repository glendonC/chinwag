// Database Durable Object — single instance holding all persistent data in SQLite.
// Uses DO RPC for direct method calls from the Worker.
// Users have UUID primary keys; handles are display names with a unique index.

import { DurableObject } from 'cloudflare:workers';
import { seedEvaluations } from './lib/seed-evaluations.js';
import { runMigration } from './lib/migrate.js';

const COLORS = [
  'red', 'cyan', 'yellow', 'green', 'magenta', 'blue',
  'orange', 'lime', 'pink', 'sky', 'lavender', 'white',
];

const ADJECTIVES = [
  'swift', 'quiet', 'bold', 'keen', 'warm', 'cool', 'fair', 'deep',
  'bright', 'calm', 'dark', 'fast', 'glad', 'kind', 'live', 'neat',
  'pale', 'rare', 'safe', 'tall', 'vast', 'wise', 'zany', 'apt',
  'dry', 'fit', 'raw', 'shy', 'wry', 'odd', 'sly', 'coy',
  'deft', 'grim', 'hazy', 'icy', 'lazy', 'mild', 'nimble', 'plush',
  'rosy', 'snug', 'tidy', 'ultra', 'vivid', 'witty', 'airy', 'bumpy',
  'crisp', 'dizzy', 'eager', 'fuzzy', 'grumpy', 'hasty', 'itchy', 'jolly',
  'lumpy', 'merry', 'nifty', 'perky', 'quirky', 'rusty', 'shiny', 'tricky',
];

const NOUNS = [
  'fox', 'owl', 'elk', 'yak', 'ant', 'bee', 'cod', 'doe',
  'eel', 'gnu', 'hen', 'jay', 'kit', 'lynx', 'moth', 'newt',
  'pug', 'ram', 'seal', 'toad', 'vole', 'wasp', 'wren', 'crab',
  'crow', 'dart', 'echo', 'fern', 'glow', 'haze', 'iris', 'jade',
  'kelp', 'lark', 'mist', 'node', 'opal', 'pine', 'reed', 'sage',
  'tide', 'vine', 'wolf', 'pixel', 'spark', 'cloud', 'flint', 'brook',
  'crane', 'drift', 'flame', 'ghost', 'haven', 'ivory', 'jewel', 'knoll',
  'maple', 'nexus', 'orbit', 'prism', 'quartz', 'ridge', 'storm', 'thorn',
];

export class DatabaseDO extends DurableObject {
  #schemaReady = false;
  #evaluationsSeeded = false;

  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  #ensureSchema() {
    if (this.#schemaReady) return;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        handle TEXT UNIQUE NOT NULL,
        color TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        status TEXT,
        created_at TEXT NOT NULL,
        last_active TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account_limits (
        ip TEXT NOT NULL,
        date TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ip, date)
      );

      CREATE TABLE IF NOT EXISTS agent_profiles (
        user_id TEXT PRIMARY KEY REFERENCES users(id),
        framework TEXT,
        languages TEXT,
        frameworks TEXT,
        tools TEXT,
        platforms TEXT,
        registered_at TEXT DEFAULT (datetime('now')),
        last_active TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_teams (
        user_id TEXT NOT NULL REFERENCES users(id),
        team_id TEXT NOT NULL,
        team_name TEXT,
        joined_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, team_id)
      );

      CREATE TABLE IF NOT EXISTS tool_evaluations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tagline TEXT,
        category TEXT,
        mcp_support INTEGER,
        has_cli INTEGER,
        hooks_support INTEGER,
        channel_support INTEGER,
        process_detectable INTEGER,
        open_source INTEGER,
        verdict TEXT NOT NULL,
        integration_tier TEXT,
        blocking_issues TEXT DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        sources TEXT NOT NULL DEFAULT '[]',
        in_registry INTEGER DEFAULT 0,
        evaluated_at TEXT NOT NULL,
        confidence TEXT NOT NULL DEFAULT 'medium',
        evaluated_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_eval_category ON tool_evaluations(category);
      CREATE INDEX IF NOT EXISTS idx_eval_verdict ON tool_evaluations(verdict);

      CREATE TABLE IF NOT EXISTS web_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        last_used TEXT DEFAULT (datetime('now')),
        user_agent TEXT,
        revoked INTEGER DEFAULT 0
      );
    `);

    // Migrate: add team_name column for tables created before this column existed
    runMigration(this.sql, 'ALTER TABLE user_teams ADD COLUMN team_name TEXT', null, 'DatabaseDO');

    // Migrate: add GitHub OAuth columns
    runMigration(this.sql, 'ALTER TABLE users ADD COLUMN github_id TEXT', null, 'DatabaseDO');
    runMigration(this.sql, 'ALTER TABLE users ADD COLUMN github_login TEXT', null, 'DatabaseDO');
    runMigration(this.sql, 'ALTER TABLE users ADD COLUMN avatar_url TEXT', null, 'DatabaseDO');
    runMigration(this.sql, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id)', null, 'DatabaseDO');

    // Prune stale rate limit rows and expired sessions
    this.sql.exec("DELETE FROM account_limits WHERE date < date('now', '-7 days')");
    this.sql.exec("DELETE FROM web_sessions WHERE expires_at < datetime('now') OR revoked = 1");

    this.#schemaReady = true;
  }

  // --- User operations ---

  async createUser() {
    this.#ensureSchema();

    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    let handle = this.#generateHandle();
    let attempts = 0;
    while (this.#handleExists(handle) && attempts < 10) {
      handle = this.#generateHandle() + Math.floor(Math.random() * 100);
      attempts++;
    }

    if (this.#handleExists(handle)) {
      return { error: 'Could not generate unique handle, please try again' };
    }

    this.sql.exec(
      `INSERT INTO users (id, handle, color, token, status, created_at, last_active)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      id, handle, color, token, now, now
    );

    return { id, handle, color, token };
  }

  async getUser(id) {
    this.#ensureSchema();
    const rows = this.sql.exec(
      'SELECT id, handle, color, status, github_id, github_login, avatar_url, created_at, last_active FROM users WHERE id = ?', id
    ).toArray();
    const user = rows[0] || null;
    if (user) {
      const lastActive = new Date(user.last_active).getTime();
      if (Date.now() - lastActive > 300_000) {
        this.sql.exec("UPDATE users SET last_active = datetime('now') WHERE id = ?", id);
      }
    }
    return user;
  }

  async getUserByHandle(handle) {
    this.#ensureSchema();
    const rows = this.sql.exec(
      'SELECT id, handle, color, status, created_at, last_active FROM users WHERE handle = ?', handle
    ).toArray();
    return rows[0] || null;
  }

  async updateHandle(userId, newHandle) {
    this.#ensureSchema();

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(newHandle)) {
      return { error: 'Handle must be 3-20 characters, alphanumeric + underscores only' };
    }

    // Check if taken by another user (exclude self)
    const taken = this.sql.exec(
      'SELECT 1 FROM users WHERE handle = ? AND id != ?', newHandle, userId
    ).toArray().length > 0;
    if (taken) {
      return { error: 'Handle already taken' };
    }

    this.sql.exec('UPDATE users SET handle = ? WHERE id = ?', newHandle, userId);
    return { ok: true, handle: newHandle };
  }

  async updateColor(userId, color) {
    this.#ensureSchema();

    if (!COLORS.includes(color)) {
      return { error: `Color must be one of: ${COLORS.join(', ')}` };
    }

    this.sql.exec('UPDATE users SET color = ? WHERE id = ?', color, userId);
    return { ok: true, color };
  }

  async setStatus(userId, status) {
    this.#ensureSchema();
    this.sql.exec('UPDATE users SET status = ? WHERE id = ?', status, userId);
    return { ok: true };
  }

  // --- GitHub OAuth ---

  async getUserByGithubId(githubId) {
    this.#ensureSchema();
    const rows = this.sql.exec(
      'SELECT id, handle, color, status, github_id, github_login, avatar_url, created_at, last_active FROM users WHERE github_id = ?',
      String(githubId)
    ).toArray();
    return rows[0] || null;
  }

  async createUserFromGithub(githubId, githubLogin, avatarUrl) {
    this.#ensureSchema();

    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    let handle = githubLogin.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20);
    if (handle.length < 3) handle = this.#generateHandle();
    let attempts = 0;
    while (this.#handleExists(handle) && attempts < 10) {
      handle = this.#generateHandle() + Math.floor(Math.random() * 100);
      attempts++;
    }
    if (this.#handleExists(handle)) {
      return { error: 'Could not generate unique handle' };
    }

    this.sql.exec(
      `INSERT INTO users (id, handle, color, token, status, github_id, github_login, avatar_url, created_at, last_active)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      id, handle, color, token, String(githubId), githubLogin, avatarUrl || null, now, now
    );

    return { id, handle, color, token };
  }

  async linkGithub(userId, githubId, githubLogin, avatarUrl) {
    this.#ensureSchema();

    // Check if this GitHub account is already linked to another user
    const existing = this.sql.exec(
      'SELECT id FROM users WHERE github_id = ? AND id != ?', String(githubId), userId
    ).toArray();
    if (existing.length > 0) {
      return { error: 'This GitHub account is already linked to another user' };
    }

    this.sql.exec(
      'UPDATE users SET github_id = ?, github_login = ?, avatar_url = ? WHERE id = ?',
      String(githubId), githubLogin, avatarUrl || null, userId
    );
    return { ok: true };
  }

  async unlinkGithub(userId) {
    this.#ensureSchema();
    this.sql.exec(
      'UPDATE users SET github_id = NULL, github_login = NULL, avatar_url = NULL WHERE id = ?',
      userId
    );
    return { ok: true };
  }

  // --- Web sessions ---

  async createWebSession(userId, userAgent) {
    this.#ensureSchema();
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

    this.sql.exec(
      `INSERT INTO web_sessions (token, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)`,
      token, userId, expiresAt, userAgent || null
    );
    return { token, expires_at: expiresAt };
  }

  async getWebSession(token) {
    this.#ensureSchema();
    const rows = this.sql.exec(
      `SELECT token, user_id, expires_at, last_used, user_agent, revoked
       FROM web_sessions
       WHERE token = ? AND revoked = 0 AND expires_at > datetime('now')`,
      token
    ).toArray();
    if (rows.length === 0) return null;

    // Slide the window — refresh expiry and last_used on access
    this.sql.exec(
      `UPDATE web_sessions SET last_used = datetime('now') WHERE token = ?`,
      token
    );
    return rows[0];
  }

  async revokeWebSession(token) {
    this.#ensureSchema();
    this.sql.exec('UPDATE web_sessions SET revoked = 1 WHERE token = ?', token);
    return { ok: true };
  }

  async getUserWebSessions(userId) {
    this.#ensureSchema();
    return this.sql.exec(
      `SELECT token, created_at, expires_at, last_used, user_agent
       FROM web_sessions
       WHERE user_id = ? AND revoked = 0 AND expires_at > datetime('now')
       ORDER BY last_used DESC LIMIT 20`,
      userId
    ).toArray();
  }

  // --- Rate limiting ---
  // Uses account_limits table for all per-day rate limits.
  // The `ip` column is the rate limit key — may be an IP, user ID prefix, or other key.

  async checkRateLimit(key, maxPerDay = 3) {
    this.#ensureSchema();
    const today = utcDate();

    const rows = this.sql.exec(
      'SELECT count FROM account_limits WHERE ip = ? AND date = ?', key, today
    ).toArray();

    const count = rows[0]?.count || 0;
    return { allowed: count < maxPerDay, count };
  }

  async consumeRateLimit(key) {
    this.#ensureSchema();
    const today = utcDate();

    this.sql.exec(
      `INSERT INTO account_limits (ip, date, count) VALUES (?, ?, 1)
       ON CONFLICT(ip, date) DO UPDATE SET count = count + 1`,
      key, today
    );
  }

  // --- Stats ---

  async getStats() {
    this.#ensureSchema();

    const users = this.sql.exec('SELECT COUNT(*) as count FROM users').toArray();

    return {
      totalUsers: users[0]?.count || 0,
    };
  }

  // --- Tool evaluations ---

  async #ensureEvaluationsSeeded() {
    if (this.#evaluationsSeeded) return;
    this.#ensureSchema();
    const rows = this.sql.exec('SELECT COUNT(*) as count FROM tool_evaluations').toArray();
    if (rows[0].count === 0) {
      await seedEvaluations(this);
    }
    this.#evaluationsSeeded = true;
  }

  async saveEvaluation(evaluation) {
    this.#ensureSchema();
    const metadata = typeof evaluation.metadata === 'string' ? evaluation.metadata : JSON.stringify(evaluation.metadata ?? {});
    const sources = typeof evaluation.sources === 'string' ? evaluation.sources : JSON.stringify(evaluation.sources ?? []);
    const blockingIssues = typeof evaluation.blocking_issues === 'string' ? evaluation.blocking_issues : JSON.stringify(evaluation.blocking_issues ?? []);

    this.sql.exec(
      `INSERT INTO tool_evaluations (id, name, tagline, category, mcp_support, has_cli, hooks_support, channel_support, process_detectable, open_source, verdict, integration_tier, blocking_issues, metadata, sources, in_registry, evaluated_at, confidence, evaluated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         tagline = excluded.tagline,
         category = excluded.category,
         mcp_support = excluded.mcp_support,
         has_cli = excluded.has_cli,
         hooks_support = excluded.hooks_support,
         channel_support = excluded.channel_support,
         process_detectable = excluded.process_detectable,
         open_source = excluded.open_source,
         verdict = excluded.verdict,
         integration_tier = excluded.integration_tier,
         blocking_issues = excluded.blocking_issues,
         metadata = excluded.metadata,
         sources = excluded.sources,
         in_registry = excluded.in_registry,
         evaluated_at = excluded.evaluated_at,
         confidence = excluded.confidence,
         evaluated_by = excluded.evaluated_by`,
      evaluation.id,
      evaluation.name,
      evaluation.tagline ?? null,
      evaluation.category ?? null,
      evaluation.mcp_support ?? null,
      evaluation.has_cli ?? null,
      evaluation.hooks_support ?? null,
      evaluation.channel_support ?? null,
      evaluation.process_detectable ?? null,
      evaluation.open_source ?? null,
      evaluation.verdict,
      evaluation.integration_tier ?? null,
      blockingIssues,
      metadata,
      sources,
      evaluation.in_registry ?? 0,
      evaluation.evaluated_at,
      evaluation.confidence ?? 'medium',
      evaluation.evaluated_by ?? null
    );

    return { ok: true };
  }

  async getEvaluation(toolId) {
    await this.#ensureEvaluationsSeeded();
    const rows = this.sql.exec('SELECT * FROM tool_evaluations WHERE id = ?', toolId).toArray();
    if (rows.length === 0) return { evaluation: null };
    return { evaluation: this.#parseEvaluation(rows[0]) };
  }

  async listEvaluations(filters = {}) {
    await this.#ensureEvaluationsSeeded();
    const conditions = [];
    const params = [];

    if (filters.verdict != null) {
      conditions.push('verdict = ?');
      params.push(filters.verdict);
    }
    if (filters.category != null) {
      conditions.push('category = ?');
      params.push(filters.category);
    }
    if (filters.mcp_support != null) {
      conditions.push('mcp_support = ?');
      params.push(filters.mcp_support);
    }
    if (filters.in_registry != null) {
      conditions.push('in_registry = ?');
      params.push(filters.in_registry);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filters.limit || 100, 200);
    const offset = filters.offset || 0;

    const rows = this.sql.exec(
      `SELECT * FROM tool_evaluations ${where} ORDER BY name ASC LIMIT ? OFFSET ?`,
      ...params, limit, offset
    ).toArray();

    return { evaluations: rows.map(r => this.#parseEvaluation(r)) };
  }

  async searchEvaluations(query, limit = 20) {
    await this.#ensureEvaluationsSeeded();
    const pattern = `%${query}%`;
    const rows = this.sql.exec(
      'SELECT * FROM tool_evaluations WHERE name LIKE ? OR tagline LIKE ? ORDER BY name ASC LIMIT ?',
      pattern, pattern, limit
    ).toArray();

    return { evaluations: rows.map(r => this.#parseEvaluation(r)) };
  }

  async deleteEvaluation(toolId) {
    this.#ensureSchema();
    this.sql.exec('DELETE FROM tool_evaluations WHERE id = ?', toolId);
    const changed = this.sql.exec('SELECT changes() as c').toArray();
    return { ok: true, deleted: changed[0].c > 0 };
  }

  async hasEvaluations() {
    this.#ensureSchema();
    const rows = this.sql.exec('SELECT COUNT(*) as count FROM tool_evaluations').toArray();
    return { count: rows[0].count };
  }

  #parseEvaluation(row) {
    return {
      ...row,
      metadata: JSON.parse(row.metadata || '{}'),
      sources: JSON.parse(row.sources || '[]'),
      blocking_issues: JSON.parse(row.blocking_issues || '[]'),
    };
  }

  // --- Private helpers ---

  #generateHandle() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return adj + noun;
  }

  #handleExists(handle) {
    return this.sql.exec('SELECT 1 FROM users WHERE handle = ?', handle).toArray().length > 0;
  }

  // --- User teams ---

  async addUserTeam(userId, teamId, name = null) {
    this.#ensureSchema();
    this.sql.exec(
      `INSERT INTO user_teams (user_id, team_id, team_name) VALUES (?, ?, ?)
       ON CONFLICT(user_id, team_id) DO UPDATE SET
         team_name = COALESCE(excluded.team_name, user_teams.team_name)`,
      userId, teamId, name
    );
    return { ok: true };
  }

  async getUserTeams(userId) {
    this.#ensureSchema();
    return this.sql.exec(
      'SELECT team_id, team_name, joined_at FROM user_teams WHERE user_id = ? ORDER BY joined_at DESC LIMIT 50',
      userId
    ).toArray();
  }

  async removeUserTeam(userId, teamId) {
    this.#ensureSchema();
    this.sql.exec('DELETE FROM user_teams WHERE user_id = ? AND team_id = ?', userId, teamId);
    return { ok: true };
  }

  // --- Agent profiles ---

  async updateAgentProfile(userId, profile) {
    this.#ensureSchema();
    const user = this.sql.exec('SELECT id FROM users WHERE id = ?', userId).toArray();
    if (user.length === 0) return { error: 'User not found' };

    this.sql.exec(
      `INSERT INTO agent_profiles (user_id, framework, languages, frameworks, tools, platforms, registered_at, last_active)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         framework = excluded.framework,
         languages = excluded.languages,
         frameworks = excluded.frameworks,
         tools = excluded.tools,
         platforms = excluded.platforms,
         last_active = datetime('now')`,
      userId,
      profile.framework || null,
      JSON.stringify(profile.languages || []),
      JSON.stringify(profile.frameworks || []),
      JSON.stringify(profile.tools || []),
      JSON.stringify(profile.platforms || [])
    );

    return { ok: true };
  }

}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}
