// User CRUD -- create, get, update, GitHub OAuth link/unlink, agent profiles.
// Handles are display names with a unique index; IDs are UUIDs.
// Each function takes `sql` as the first parameter.

import type { DOResult, User, NewUser, AgentProfile } from '../../types.js';
import { toSQLDateTime } from '../../lib/text-utils.js';
import { VALID_COLORS } from '../../lib/constants.js';
import { parseBudgetConfig } from '@chinmeister/shared/budget-config.js';

// Columns fetched whenever a full User profile is returned (auth, /me, etc.).
// Kept as a constant so the three getters that produce a User stay in sync.
const USER_COLUMNS =
  'id, handle, color, status, github_id, github_login, avatar_url, created_at, last_active, budgets';

/** Shape of a users-table row as it comes back from SQLite, before parsing. */
type UserRow = Omit<User, 'budgets'> & { budgets?: string | null };

/**
 * Parse the `budgets` JSON text column into a validated partial BudgetConfig.
 * Always returns a plain object (possibly empty) or null so the User type
 * never leaks a raw string to callers.
 */
function parseBudgetsColumn(raw: unknown): Record<string, unknown> | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return null;
  try {
    return parseBudgetConfig(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function toUser(raw: UserRow | null): User | null {
  if (!raw) return null;
  const { budgets, ...rest } = raw;
  return { ...rest, budgets: parseBudgetsColumn(budgets) };
}

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

function generateHandle(): string {
  // Math.floor(Math.random() * len) is guaranteed in-bounds for a non-empty const array.
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)] ?? 'swift';
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)] ?? 'fox';
  return adj + noun;
}

function handleExists(sql: SqlStorage, handle: string): boolean {
  return sql.exec('SELECT 1 FROM users WHERE handle = ?', handle).toArray().length > 0;
}

/** Resolve a unique handle, appending random hex on collision. */
function resolveUniqueHandle(sql: SqlStorage, preferred: string): string | null {
  if (!handleExists(sql, preferred)) return preferred;
  // First collision: append 4 hex chars (e.g. "swiftfox" -> "swiftfoxa7f2")
  const attempt2 = generateHandle() + crypto.randomUUID().slice(0, 4);
  if (!handleExists(sql, attempt2)) return attempt2;
  // Second collision: append 8 hex chars for near-guaranteed uniqueness
  const attempt3 = generateHandle() + crypto.randomUUID().slice(0, 8);
  if (!handleExists(sql, attempt3)) return attempt3;
  return null;
}

// -- Creation / lookup --

export function createUser(sql: SqlStorage): DOResult<NewUser & { ok: true }> {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  // Math.floor(Math.random() * len) is guaranteed in-bounds for VALID_COLORS (non-empty const).
  const color = VALID_COLORS[Math.floor(Math.random() * VALID_COLORS.length)] ?? 'white';
  const now = toSQLDateTime();

  const handle = resolveUniqueHandle(sql, generateHandle());
  if (!handle) {
    return { error: 'Could not generate unique handle, please try again', code: 'INTERNAL' };
  }

  sql.exec(
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

export function getUser(sql: SqlStorage, id: string): DOResult<{ ok: true; user: User }> {
  const rows = sql.exec(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, id).toArray();
  const user = toUser((rows[0] as unknown as UserRow | undefined) || null);
  if (user) {
    // Throttle last_active writes to once per 5 minutes. Running the check in
    // SQL keeps time math in SQLite's domain (no JS Date parsing of the
    // "YYYY-MM-DD HH:MM:SS" format) and collapses the read-then-write pair
    // into a single conditional UPDATE that no-ops when the row is fresh.
    sql.exec(
      "UPDATE users SET last_active = datetime('now') WHERE id = ? AND last_active <= datetime('now', '-300 seconds')",
      id,
    );
  }
  return user ? { ok: true, user } : { error: 'User not found', code: 'NOT_FOUND' };
}

export function getUserByHandle(
  sql: SqlStorage,
  handle: string,
): DOResult<{ ok: true; user: User }> {
  const rows = sql.exec(`SELECT ${USER_COLUMNS} FROM users WHERE handle = ?`, handle).toArray();
  const user = toUser((rows[0] as unknown as UserRow | undefined) || null);
  return user ? { ok: true, user } : { error: 'User not found', code: 'NOT_FOUND' };
}

// -- Updates --

export function updateHandle(
  sql: SqlStorage,
  userId: string,
  newHandle: string,
): DOResult<{ ok: true; handle: string }> {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(newHandle)) {
    return {
      error: 'Handle must be 3-20 characters, alphanumeric + underscores only',
      code: 'VALIDATION',
    };
  }

  const taken =
    sql.exec('SELECT 1 FROM users WHERE handle = ? AND id != ?', newHandle, userId).toArray()
      .length > 0;
  if (taken) {
    return { error: 'Handle already taken', code: 'CONFLICT' };
  }

  sql.exec('UPDATE users SET handle = ? WHERE id = ?', newHandle, userId);
  return { ok: true, handle: newHandle };
}

export function updateColor(
  sql: SqlStorage,
  userId: string,
  color: string,
): DOResult<{ ok: true; color: string }> {
  if (!VALID_COLORS.includes(color as (typeof VALID_COLORS)[number])) {
    return { error: `Color must be one of: ${VALID_COLORS.join(', ')}`, code: 'VALIDATION' };
  }

  sql.exec('UPDATE users SET color = ? WHERE id = ?', color, userId);
  return { ok: true, color };
}

export function setStatus(sql: SqlStorage, userId: string, status: string | null): { ok: true } {
  sql.exec('UPDATE users SET status = ? WHERE id = ?', status, userId);
  return { ok: true };
}

/**
 * Persist a user's partial BudgetConfig override. Input is re-parsed through
 * parseBudgetConfig so callers can't bypass the type guards in the shared
 * validator by going through the DO directly. An empty object or null clears
 * the row's budgets (MCP will fall back to team + defaults).
 */
export function updateBudgets(
  sql: SqlStorage,
  userId: string,
  input: unknown,
): DOResult<{ ok: true; budgets: Record<string, unknown> | null }> {
  const rows = sql.exec('SELECT 1 FROM users WHERE id = ?', userId).toArray();
  if (rows.length === 0) {
    return { error: 'User not found', code: 'NOT_FOUND' };
  }

  const clearing = input === null || input === undefined;
  const parsed = clearing ? null : parseBudgetConfig(input);
  if (!clearing && parsed === null) {
    return { error: 'budgets must be an object', code: 'VALIDATION' };
  }
  const empty = parsed !== null && Object.keys(parsed).length === 0;

  if (clearing || empty) {
    sql.exec('UPDATE users SET budgets = NULL WHERE id = ?', userId);
    return { ok: true, budgets: null };
  }

  sql.exec('UPDATE users SET budgets = ? WHERE id = ?', JSON.stringify(parsed), userId);
  return { ok: true, budgets: parsed };
}

// -- GitHub OAuth --

export function getUserByGithubId(
  sql: SqlStorage,
  githubId: string | number,
): DOResult<{ ok: true; user: User }> {
  const rows = sql
    .exec(`SELECT ${USER_COLUMNS} FROM users WHERE github_id = ?`, String(githubId))
    .toArray();
  const user = toUser((rows[0] as unknown as UserRow | undefined) || null);
  return user ? { ok: true, user } : { error: 'User not found' };
}

export function createUserFromGithub(
  sql: SqlStorage,
  githubId: string | number,
  githubLogin: string,
  avatarUrl: string | null,
): DOResult<NewUser & { ok: true }> {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  // Math.floor(Math.random() * len) is guaranteed in-bounds for VALID_COLORS (non-empty const).
  const color = VALID_COLORS[Math.floor(Math.random() * VALID_COLORS.length)] ?? 'white';
  const now = toSQLDateTime();

  let preferred = githubLogin.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20);
  if (preferred.length < 3) preferred = generateHandle();
  const handle = resolveUniqueHandle(sql, preferred);
  if (!handle) {
    return { error: 'Could not generate unique handle', code: 'INTERNAL' };
  }

  sql.exec(
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

export function linkGithub(
  sql: SqlStorage,
  userId: string,
  githubId: string | number,
  githubLogin: string,
  avatarUrl: string | null,
): DOResult<{ ok: true }> {
  const existing = sql
    .exec('SELECT id FROM users WHERE github_id = ? AND id != ?', String(githubId), userId)
    .toArray();
  if (existing.length > 0) {
    return { error: 'This GitHub account is already linked to another user', code: 'CONFLICT' };
  }

  sql.exec(
    'UPDATE users SET github_id = ?, github_login = ?, avatar_url = ? WHERE id = ?',
    String(githubId),
    githubLogin,
    avatarUrl || null,
    userId,
  );
  return { ok: true };
}

export function unlinkGithub(sql: SqlStorage, userId: string): { ok: true } {
  sql.exec(
    'UPDATE users SET github_id = NULL, github_login = NULL, avatar_url = NULL WHERE id = ?',
    userId,
  );
  return { ok: true };
}

// -- Agent profiles (user-scoped metadata) --

export function updateAgentProfile(
  sql: SqlStorage,
  userId: string,
  profile: Partial<AgentProfile>,
): DOResult<{ ok: true }> {
  const user = sql.exec('SELECT id FROM users WHERE id = ?', userId).toArray();
  if (user.length === 0) return { error: 'User not found', code: 'NOT_FOUND' };

  sql.exec(
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
