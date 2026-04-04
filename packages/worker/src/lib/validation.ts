// Reusable validation helpers extracted from route handlers.
// Each returns null on success or an error string/response on failure.

import type { Env, User, AgentRuntime, ParsedBody } from '../types.js';
import type { DatabaseDO } from '../dos/database/index.js';
import type { TeamDO } from '../dos/team/index.js';
import { json } from './http.js';
import { createLogger } from './logger.js';
import { getDB, getTeam, rpc } from './env.js';
import { getAgentRuntime, teamErrorStatus } from './request-utils.js';

const log = createLogger('validation');

/**
 * Sanitize an optional string value: type-check, truncate, trim, and convert
 * empty results to null. Replaces the repeated inline pattern:
 *   typeof x === 'string' ? x.slice(0, MAX).trim() || null : null
 */
export function sanitizeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  return value.slice(0, maxLength).trim() || null;
}

/**
 * Check for JSON parse errors from parseBody().
 * Returns a 400 JSON response if there's a parse error, null otherwise.
 */
export function requireJson(body: ParsedBody): Response | null {
  if ('_parseError' in body)
    return json({ error: (body as { _parseError: string })._parseError }, 400);
  return null;
}

/**
 * Validate an array of file path strings.
 * Returns an error string if invalid, null if valid.
 */
export function validateFileArray(
  files: unknown,
  max: number,
  opts?: { nullable?: boolean },
): string | null {
  if (opts?.nullable && (files === null || files === undefined)) {
    return null;
  }
  if (!Array.isArray(files) || files.length === 0) {
    return 'files must be a non-empty array';
  }
  if (files.length > max) {
    return `too many files (max ${max})`;
  }
  if (
    files.some(
      (f) =>
        typeof f !== 'string' ||
        f.length > 500 ||
        f.includes('\0') ||
        f.startsWith('/') ||
        f.includes('\\'),
    )
  ) {
    return 'invalid file path';
  }
  return null;
}

/**
 * Validate and normalize an array of tag strings.
 * Returns { error: string } if invalid, { tags: string[] } if valid.
 */
export function validateTagsArray(
  tags: unknown,
  max: number,
): { error: string; tags?: undefined } | { tags: string[]; error?: undefined } {
  if (tags === undefined || tags === null) {
    return { tags: [] };
  }
  if (!Array.isArray(tags)) {
    return { error: 'tags must be an array of strings' };
  }
  if (tags.length > max) {
    return { error: `max ${max} tags` };
  }
  if (tags.some((t) => typeof t !== 'string' || t.length > 50)) {
    return { error: 'each tag must be a string of 50 chars or less' };
  }
  return { tags: tags.map((t: string) => t.toLowerCase().trim()).filter(Boolean) };
}

/**
 * Wrap a handler with rate limit check + consume pattern.
 * Checks the rate limit before running the handler and always consumes
 * the rate limit regardless of handler outcome. This prevents attackers
 * from flooding with invalid requests without hitting limits.
 */
export async function withRateLimit(
  db: DurableObjectStub<DatabaseDO>,
  key: string,
  max: number,
  errorMsg: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  let limit: { allowed: boolean };
  try {
    limit = await db.checkRateLimit(key, max);
  } catch (err) {
    log.error('rate limit check failed', {
      key,
      error: (err as Error)?.message || String(err),
    });
    return json({ error: 'Service temporarily unavailable' }, 503);
  }
  if (!limit.allowed) {
    return json({ error: errorMsg }, 429, { 'Retry-After': '3600' });
  }
  // Consume immediately -- every request that passes the check costs a token,
  // regardless of whether the handler succeeds or returns an error status.
  // This prevents attackers from flooding with invalid requests for free.
  try {
    await db.consumeRateLimit(key);
  } catch (err) {
    log.error('rate limit consume failed', {
      key,
      error: (err as Error)?.message || String(err),
    });
  }
  return handler();
}

/**
 * Validate that `body[field]` is a non-empty string, optionally capping length.
 * Returns the trimmed string on success, or null if invalid.
 */
export function requireString(
  body: Record<string, unknown>,
  field: string,
  maxLength?: number,
): string | null {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) return null;
  if (maxLength && value.length > maxLength) return null;
  return value.trim();
}

/**
 * Validate that `body[field]` is an array with at most `maxItems` entries.
 * Returns the array on success, or null if invalid.
 */
export function requireArray(
  body: Record<string, unknown>,
  field: string,
  maxItems: number,
): unknown[] | null {
  const value = body[field];
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.length > maxItems) return null;
  return value;
}

/**
 * Execute `SELECT changes()` on a DO SQL handle and return whether any rows changed.
 * Replaces the repeated pattern: `sql.exec('SELECT changes() as c').toArray()[0].c`
 */
export function sqlChanges(sql: SqlStorage): number {
  return (sql.exec('SELECT changes() as c').toArray()[0] as { c: number }).c;
}

/**
 * Run a function inside a Durable Object storage transaction.
 * Uses `ctx.storage.transactionSync()` for atomicity — if `fn` throws,
 * all SQL operations inside are rolled back automatically.
 *
 * Callers pass the DO's `transact` function (bound to ctx.storage.transactionSync)
 * so submodules don't need a direct reference to ctx.
 */
export function withTransaction<T>(transact: (fn: () => T) => T, fn: () => T): T {
  return transact(fn);
}

/**
 * Build an SQL IN clause from an array of items.
 * Returns a placeholder string and params array suitable for embedding in a query.
 * When the array is empty, returns a literal that matches nothing (`'__none__'`),
 * avoiding SQL syntax errors from `IN ()`.
 */
export function buildInClause(items: unknown[]): { sql: string; params: unknown[] } {
  if (!items || items.length === 0) {
    return { sql: "'__none__'", params: [] };
  }
  return { sql: items.map(() => '?').join(','), params: items };
}

/**
 * Rate limit a public (unauthenticated) endpoint by client IP.
 * Uses CF-Connecting-IP (hashed for privacy) for the key. Atomically
 * checks and consumes in one call to eliminate the race window between
 * separate check/consume operations.
 */
export async function withIpRateLimit(
  request: Request,
  env: Env,
  prefix: string,
  max: number,
  handler: () => Promise<Response>,
): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) {
    return json({ error: 'Unable to identify client' }, 400);
  }
  const hashedIp = await hashIp(ip);
  const key = `pub:${prefix}:${hashedIp}`;
  const db = getDB(env);
  const result = rpc(await db.checkAndConsume(key, max));
  if (!result.allowed) {
    return json({ error: 'Rate limit exceeded. Try again later.' }, 429, {
      'Retry-After': '3600',
    });
  }
  return handler();
}

interface WithTeamRateLimitOpts {
  request: Request;
  user: User;
  env: Env;
  teamId: string;
  rateLimitKey: string;
  rateLimitMax: number;
  rateLimitMsg: string;
  successStatus?: number;
  action: (team: DurableObjectStub<TeamDO>, agentId: string, runtime: AgentRuntime) => Promise<any>;
}

/**
 * Higher-order wrapper for the common team route pattern:
 * get DB + team stubs, extract agent runtime, rate-limit, call a team DO
 * method, and map the result to an HTTP response.
 *
 * Eliminates the repeated 4-line preamble (getDB, getTeam, getAgentRuntime)
 * and the withRateLimit + error-mapping boilerplate from team route handlers.
 */
export async function withTeamRateLimit({
  request,
  user,
  env,
  teamId,
  rateLimitKey,
  rateLimitMax,
  rateLimitMsg,
  successStatus = 200,
  action,
}: WithTeamRateLimitOpts): Promise<Response> {
  const db = getDB(env);
  const runtime = getAgentRuntime(request, user);
  const agentId = runtime.agentId;
  const team = getTeam(env, teamId);

  return withRateLimit(db, `${rateLimitKey}:${user.id}`, rateLimitMax, rateLimitMsg, async () => {
    const result = await action(team, agentId, runtime);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result));
    return json(result, successStatus);
  });
}

/**
 * Hash an IP address using SHA-256 so raw IPs are not stored in the database.
 * Returns a hex-encoded hash truncated to 16 characters (64 bits — sufficient
 * for rate-limit bucketing, not a security hash).
 */
export async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

/** Test whether a string is a valid UUID v4 (the format produced by crypto.randomUUID()). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUUID(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}
