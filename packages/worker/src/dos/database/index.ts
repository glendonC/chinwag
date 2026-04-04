// Database Durable Object -- single instance holding all persistent data in SQLite.
// Uses DO RPC for direct method calls from the Worker.
// Users have UUID primary keys; handles are display names with a unique index.
//
// Submodules:
//   evaluations.ts -- tool directory CRUD (largest separate domain)

import { DurableObject } from 'cloudflare:workers';
import type {
  Env,
  DOResult,
  DOError,
  User,
  NewUser,
  RateLimitCheck,
  WebSession,
  UserTeam,
  AgentProfile,
} from '../../types.js';
import { seedEvaluations } from '../../lib/seed-evaluations.js';
import { toSQLDateTime } from '../../lib/text-utils.js';
import { VALID_COLORS, WEB_SESSION_DURATION_MS } from '../../lib/constants.js';
import { ensureSchema as ensureSchemaFn, cleanup as schemaCleanup } from './schema.js';
import {
  saveEvaluation as saveEvalFn,
  getEvaluation as getEvalFn,
  listEvaluations as listEvalsFn,
  searchEvaluations as searchEvalsFn,
  deleteEvaluation as deleteEvalFn,
  hasEvaluations as hasEvalsFn,
} from './evaluations.js';

const ADJECTIVES = [
  'swift',
  'quiet',
  'bold',
  'keen',
  'warm',
  'cool',
  'fair',
  'deep',
  'bright',
  'calm',
  'dark',
  'fast',
  'glad',
  'kind',
  'live',
  'neat',
  'pale',
  'rare',
  'safe',
  'tall',
  'vast',
  'wise',
  'zany',
  'apt',
  'dry',
  'fit',
  'raw',
  'shy',
  'wry',
  'odd',
  'sly',
  'coy',
  'deft',
  'grim',
  'hazy',
  'icy',
  'lazy',
  'mild',
  'nimble',
  'plush',
  'rosy',
  'snug',
  'tidy',
  'ultra',
  'vivid',
  'witty',
  'airy',
  'bumpy',
  'crisp',
  'dizzy',
  'eager',
  'fuzzy',
  'grumpy',
  'hasty',
  'itchy',
  'jolly',
  'lumpy',
  'merry',
  'nifty',
  'perky',
  'quirky',
  'rusty',
  'shiny',
  'tricky',
] as const;

const NOUNS = [
  'fox',
  'owl',
  'elk',
  'yak',
  'ant',
  'bee',
  'cod',
  'doe',
  'eel',
  'gnu',
  'hen',
  'jay',
  'kit',
  'lynx',
  'moth',
  'newt',
  'pug',
  'ram',
  'seal',
  'toad',
  'vole',
  'wasp',
  'wren',
  'crab',
  'crow',
  'dart',
  'echo',
  'fern',
  'glow',
  'haze',
  'iris',
  'jade',
  'kelp',
  'lark',
  'mist',
  'node',
  'opal',
  'pine',
  'reed',
  'sage',
  'tide',
  'vine',
  'wolf',
  'pixel',
  'spark',
  'cloud',
  'flint',
  'brook',
  'crane',
  'drift',
  'flame',
  'ghost',
  'haven',
  'ivory',
  'jewel',
  'knoll',
  'maple',
  'nexus',
  'orbit',
  'prism',
  'quartz',
  'ridge',
  'storm',
  'thorn',
] as const;

export class DatabaseDO extends DurableObject<Env> {
  sql: SqlStorage;
  #schemaReady = false;
  #evaluationsSeeded = false;

  #transact: <T>(fn: () => T) => T;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.#transact = <T>(fn: () => T): T => ctx.storage.transactionSync(fn);
  }

  #ensureSchema(): void {
    if (this.#schemaReady) return;

    ensureSchemaFn(this.sql, this.#transact);

    // Prune stale rate limit rows and expired sessions (runs every startup,
    // not a migration -- these are recurring cleanup, not schema changes)
    schemaCleanup(this.sql);

    this.#schemaReady = true;
  }

  // -- Users --

  async createUser(): Promise<DOResult<NewUser & { ok: true }>> {
    this.#ensureSchema();

    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const color = VALID_COLORS[Math.floor(Math.random() * VALID_COLORS.length)];
    const now = toSQLDateTime();

    const handle = this.#resolveUniqueHandle(this.#generateHandle());
    if (!handle) {
      return { error: 'Could not generate unique handle, please try again', code: 'INTERNAL' };
    }

    this.sql.exec(
      `INSERT INTO users (id, handle, color, token, status, created_at, last_active)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      id,
      handle,
      color,
      token,
      now,
      now,
    );

    return { ok: true, id, handle, color, token };
  }

  async getUser(id: string): Promise<DOResult<{ ok: true; user: User }>> {
    this.#ensureSchema();
    const rows = this.sql
      .exec(
        'SELECT id, handle, color, status, github_id, github_login, avatar_url, created_at, last_active FROM users WHERE id = ?',
        id,
      )
      .toArray();
    const user = (rows[0] as unknown as User) || null;
    if (user) {
      const lastActive = new Date(user.last_active).getTime();
      if (Date.now() - lastActive > 300_000) {
        this.sql.exec("UPDATE users SET last_active = datetime('now') WHERE id = ?", id);
      }
    }
    return user ? { ok: true, user } : { error: 'User not found', code: 'NOT_FOUND' };
  }

  async getUserByHandle(handle: string): Promise<DOResult<{ ok: true; user: User }>> {
    this.#ensureSchema();
    const rows = this.sql
      .exec(
        'SELECT id, handle, color, status, created_at, last_active FROM users WHERE handle = ?',
        handle,
      )
      .toArray();
    const user = (rows[0] as unknown as User) || null;
    return user ? { ok: true, user } : { error: 'User not found', code: 'NOT_FOUND' };
  }

  async updateHandle(
    userId: string,
    newHandle: string,
  ): Promise<DOResult<{ ok: true; handle: string }>> {
    this.#ensureSchema();

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(newHandle)) {
      return {
        error: 'Handle must be 3-20 characters, alphanumeric + underscores only',
        code: 'VALIDATION',
      };
    }

    const taken =
      this.sql.exec('SELECT 1 FROM users WHERE handle = ? AND id != ?', newHandle, userId).toArray()
        .length > 0;
    if (taken) {
      return { error: 'Handle already taken', code: 'CONFLICT' };
    }

    this.sql.exec('UPDATE users SET handle = ? WHERE id = ?', newHandle, userId);
    return { ok: true, handle: newHandle };
  }

  async updateColor(userId: string, color: string): Promise<DOResult<{ ok: true; color: string }>> {
    this.#ensureSchema();

    if (!VALID_COLORS.includes(color as (typeof VALID_COLORS)[number])) {
      return { error: `Color must be one of: ${VALID_COLORS.join(', ')}`, code: 'VALIDATION' };
    }

    this.sql.exec('UPDATE users SET color = ? WHERE id = ?', color, userId);
    return { ok: true, color };
  }

  async setStatus(userId: string, status: string | null): Promise<{ ok: true }> {
    this.#ensureSchema();
    this.sql.exec('UPDATE users SET status = ? WHERE id = ?', status, userId);
    return { ok: true };
  }

  // -- GitHub OAuth --

  async getUserByGithubId(githubId: string | number): Promise<DOResult<{ ok: true; user: User }>> {
    this.#ensureSchema();
    const rows = this.sql
      .exec(
        'SELECT id, handle, color, status, github_id, github_login, avatar_url, created_at, last_active FROM users WHERE github_id = ?',
        String(githubId),
      )
      .toArray();
    const user = (rows[0] as unknown as User) || null;
    return user ? { ok: true, user } : { error: 'User not found' };
  }

  async createUserFromGithub(
    githubId: string | number,
    githubLogin: string,
    avatarUrl: string | null,
  ): Promise<DOResult<NewUser & { ok: true }>> {
    this.#ensureSchema();

    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const color = VALID_COLORS[Math.floor(Math.random() * VALID_COLORS.length)];
    const now = toSQLDateTime();

    let preferred = githubLogin.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20);
    if (preferred.length < 3) preferred = this.#generateHandle();
    const handle = this.#resolveUniqueHandle(preferred);
    if (!handle) {
      return { error: 'Could not generate unique handle', code: 'INTERNAL' };
    }

    this.sql.exec(
      `INSERT INTO users (id, handle, color, token, status, github_id, github_login, avatar_url, created_at, last_active)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      id,
      handle,
      color,
      token,
      String(githubId),
      githubLogin,
      avatarUrl || null,
      now,
      now,
    );

    return { ok: true, id, handle, color, token };
  }

  async linkGithub(
    userId: string,
    githubId: string | number,
    githubLogin: string,
    avatarUrl: string | null,
  ): Promise<DOResult<{ ok: true }>> {
    this.#ensureSchema();

    const existing = this.sql
      .exec('SELECT id FROM users WHERE github_id = ? AND id != ?', String(githubId), userId)
      .toArray();
    if (existing.length > 0) {
      return { error: 'This GitHub account is already linked to another user', code: 'CONFLICT' };
    }

    this.sql.exec(
      'UPDATE users SET github_id = ?, github_login = ?, avatar_url = ? WHERE id = ?',
      String(githubId),
      githubLogin,
      avatarUrl || null,
      userId,
    );
    return { ok: true };
  }

  async unlinkGithub(userId: string): Promise<{ ok: true }> {
    this.#ensureSchema();
    this.sql.exec(
      'UPDATE users SET github_id = NULL, github_login = NULL, avatar_url = NULL WHERE id = ?',
      userId,
    );
    return { ok: true };
  }

  // -- Web sessions --

  async createWebSession(
    userId: string,
    userAgent: string | null,
  ): Promise<{ ok: true; token: string; expires_at: string }> {
    this.#ensureSchema();
    const token = crypto.randomUUID();
    const expiresAt = toSQLDateTime(new Date(Date.now() + WEB_SESSION_DURATION_MS));

    this.sql.exec(
      `INSERT INTO web_sessions (token, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)`,
      token,
      userId,
      expiresAt,
      userAgent || null,
    );
    return { ok: true, token, expires_at: expiresAt };
  }

  async getWebSession(token: string): Promise<DOResult<{ ok: true; session: WebSession }>> {
    this.#ensureSchema();
    const rows = this.sql
      .exec(
        `SELECT token, user_id, expires_at, last_used, user_agent, revoked
       FROM web_sessions
       WHERE token = ? AND revoked = 0 AND expires_at > datetime('now')`,
        token,
      )
      .toArray();
    if (rows.length === 0) return { error: 'Session not found', code: 'NOT_FOUND' };

    // Slide the window -- refresh expiry and last_used on access
    this.sql.exec(`UPDATE web_sessions SET last_used = datetime('now') WHERE token = ?`, token);
    return { ok: true, session: rows[0] as unknown as WebSession };
  }

  async revokeWebSession(token: string): Promise<{ ok: true }> {
    this.#ensureSchema();
    this.sql.exec('UPDATE web_sessions SET revoked = 1 WHERE token = ?', token);
    return { ok: true };
  }

  async getUserWebSessions(userId: string): Promise<{ ok: true; sessions: WebSession[] }> {
    this.#ensureSchema();
    const sessions = this.sql
      .exec(
        `SELECT token, created_at, expires_at, last_used, user_agent
       FROM web_sessions
       WHERE user_id = ? AND revoked = 0 AND expires_at > datetime('now')
       ORDER BY last_used DESC LIMIT 20`,
        userId,
      )
      .toArray() as unknown as WebSession[];
    return { ok: true, sessions };
  }

  // -- Rate limiting --
  // Uses hourly buckets with a 24-hour sliding window. Each bucket stores
  // the count for one hour (key = "YYYY-MM-DDTHH"). To check the limit,
  // we SUM all buckets from the last 24 hours. This prevents the midnight-
  // reset exploit where a user could double their quota around UTC midnight.

  async checkRateLimit(key: string, maxPerWindow = 3): Promise<RateLimitCheck & { ok: true }> {
    this.#ensureSchema();
    const windowStart = hourBucket(Date.now() - 24 * 60 * 60 * 1000);

    const rows = this.sql
      .exec(
        'SELECT COALESCE(SUM(count), 0) as total FROM account_limits WHERE ip = ? AND date >= ?',
        key,
        windowStart,
      )
      .toArray();

    const count = ((rows[0] as Record<string, unknown>)?.total as number) || 0;
    return { ok: true, allowed: count < maxPerWindow, count };
  }

  async consumeRateLimit(key: string): Promise<{ ok: true }> {
    this.#ensureSchema();
    const bucket = hourBucket(Date.now());

    this.sql.exec(
      `INSERT INTO account_limits (ip, date, count) VALUES (?, ?, 1)
       ON CONFLICT(ip, date) DO UPDATE SET count = count + 1`,
      key,
      bucket,
    );
    return { ok: true };
  }

  /**
   * Atomic check-and-consume: checks the limit and increments in one call.
   * Eliminates the race window between separate check and consume calls.
   * Use for public/unauthenticated endpoints where every request should count.
   */
  async checkAndConsume(
    key: string,
    maxPerWindow = 3,
  ): Promise<{ ok: true; allowed: boolean; count: number }> {
    this.#ensureSchema();
    const now = Date.now();
    const windowStart = hourBucket(now - 24 * 60 * 60 * 1000);
    const bucket = hourBucket(now);

    const rows = this.sql
      .exec(
        'SELECT COALESCE(SUM(count), 0) as total FROM account_limits WHERE ip = ? AND date >= ?',
        key,
        windowStart,
      )
      .toArray();

    const count = ((rows[0] as Record<string, unknown>)?.total as number) || 0;
    if (count >= maxPerWindow) {
      return { ok: true, allowed: false, count };
    }

    this.sql.exec(
      `INSERT INTO account_limits (ip, date, count) VALUES (?, ?, 1)
       ON CONFLICT(ip, date) DO UPDATE SET count = count + 1`,
      key,
      bucket,
    );

    return { ok: true, allowed: true, count: count + 1 };
  }

  // -- Stats --

  async getStats(): Promise<{ ok: true; totalUsers: number }> {
    this.#ensureSchema();
    const users = this.sql.exec('SELECT COUNT(*) as count FROM users').toArray();
    return { ok: true, totalUsers: ((users[0] as Record<string, unknown>)?.count as number) || 0 };
  }

  // -- Tool evaluations (logic in evaluations.ts) --

  async #ensureEvaluationsSeeded(): Promise<void> {
    if (this.#evaluationsSeeded) return;
    this.#ensureSchema();
    const { count } = hasEvalsFn(this.sql);
    if (count === 0) {
      await seedEvaluations(this);
    }
    this.#evaluationsSeeded = true;
  }

  async saveEvaluation(evaluation: Record<string, unknown>): Promise<{ ok: true }> {
    this.#ensureSchema();
    return saveEvalFn(this.sql, evaluation as any);
  }

  async getEvaluation(toolId: string): Promise<ReturnType<typeof getEvalFn>> {
    await this.#ensureEvaluationsSeeded();
    return getEvalFn(this.sql, toolId);
  }

  async listEvaluations(
    filters: Record<string, unknown> = {},
  ): Promise<ReturnType<typeof listEvalsFn>> {
    await this.#ensureEvaluationsSeeded();
    return listEvalsFn(this.sql, filters as any);
  }

  async searchEvaluations(query: string, limit = 20): Promise<ReturnType<typeof searchEvalsFn>> {
    await this.#ensureEvaluationsSeeded();
    return searchEvalsFn(this.sql, query, limit);
  }

  async deleteEvaluation(toolId: string): Promise<ReturnType<typeof deleteEvalFn>> {
    this.#ensureSchema();
    return deleteEvalFn(this.sql, toolId);
  }

  async hasEvaluations(): Promise<ReturnType<typeof hasEvalsFn>> {
    this.#ensureSchema();
    return hasEvalsFn(this.sql);
  }

  // -- User teams --

  async addUserTeam(
    userId: string,
    teamId: string,
    name: string | null = null,
  ): Promise<{ ok: true }> {
    this.#ensureSchema();
    this.sql.exec(
      `INSERT INTO user_teams (user_id, team_id, team_name) VALUES (?, ?, ?)
       ON CONFLICT(user_id, team_id) DO UPDATE SET
         team_name = COALESCE(excluded.team_name, user_teams.team_name)`,
      userId,
      teamId,
      name,
    );
    return { ok: true };
  }

  async getUserTeams(userId: string): Promise<{ ok: true; teams: UserTeam[] }> {
    this.#ensureSchema();
    const teams = this.sql
      .exec(
        'SELECT team_id, team_name, joined_at FROM user_teams WHERE user_id = ? ORDER BY joined_at DESC LIMIT 50',
        userId,
      )
      .toArray() as unknown as UserTeam[];
    return { ok: true, teams };
  }

  async removeUserTeam(userId: string, teamId: string): Promise<{ ok: true }> {
    this.#ensureSchema();
    this.sql.exec('DELETE FROM user_teams WHERE user_id = ? AND team_id = ?', userId, teamId);
    return { ok: true };
  }

  // -- Agent profiles --

  async updateAgentProfile(
    userId: string,
    profile: Partial<AgentProfile>,
  ): Promise<DOResult<{ ok: true }>> {
    this.#ensureSchema();
    const user = this.sql.exec('SELECT id FROM users WHERE id = ?', userId).toArray();
    if (user.length === 0) return { error: 'User not found', code: 'NOT_FOUND' };

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
      JSON.stringify(profile.platforms || []),
    );

    return { ok: true };
  }

  // -- Private helpers --

  #generateHandle(): string {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return adj + noun;
  }

  #handleExists(handle: string): boolean {
    return this.sql.exec('SELECT 1 FROM users WHERE handle = ?', handle).toArray().length > 0;
  }

  /** Resolve a unique handle, appending random hex on collision. */
  #resolveUniqueHandle(preferred: string): string | null {
    if (!this.#handleExists(preferred)) return preferred;
    // First collision: append 4 hex chars (e.g. "swiftfox" -> "swiftfoxa7f2")
    const attempt2 = this.#generateHandle() + crypto.randomUUID().slice(0, 4);
    if (!this.#handleExists(attempt2)) return attempt2;
    // Second collision: append 8 hex chars for near-guaranteed uniqueness
    const attempt3 = this.#generateHandle() + crypto.randomUUID().slice(0, 8);
    if (!this.#handleExists(attempt3)) return attempt3;
    return null;
  }
}

/** Return the hourly bucket key for a given timestamp (e.g. "2026-04-02T14"). */
function hourBucket(ms: number): string {
  return new Date(ms).toISOString().slice(0, 13);
}
