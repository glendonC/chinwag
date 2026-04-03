// Reusable validation helpers extracted from route handlers.
// Each returns null on success or an error string/response on failure.

import { json } from './http.js';
import { createLogger } from './logger.js';
import { getDB, getTeam } from './env.js';

const log = createLogger('validation');
import { getAgentRuntime, teamErrorStatus } from './request-utils.js';

/**
 * Sanitize an optional string value: type-check, truncate, trim, and convert
 * empty results to null. Replaces the repeated inline pattern:
 *   typeof x === 'string' ? x.slice(0, MAX).trim() || null : null
 *
 * @param {*} value - Value to sanitize
 * @param {number} maxLength - Maximum allowed length
 * @returns {string|null} - Sanitized string or null
 */
export function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') return null;
  return value.slice(0, maxLength).trim() || null;
}

/**
 * Check for JSON parse errors from parseBody().
 * Returns a 400 JSON response if there's a parse error, null otherwise.
 */
export function requireJson(body) {
  if (body._parseError) return json({ error: body._parseError }, 400);
  return null;
}

/**
 * Validate an array of file path strings.
 * Returns an error string if invalid, null if valid.
 * @param {*} files - The files value to validate
 * @param {number} max - Maximum number of files allowed
 * @param {{ nullable?: boolean }} [opts] - Options; nullable allows null/undefined to pass
 */
export function validateFileArray(files, max, opts) {
  if (opts?.nullable && (files === null || files === undefined)) {
    return null;
  }
  if (!Array.isArray(files) || files.length === 0) {
    return 'files must be a non-empty array';
  }
  if (files.length > max) {
    return `too many files (max ${max})`;
  }
  if (files.some((f) => typeof f !== 'string' || f.length > 500)) {
    return 'invalid file path';
  }
  return null;
}

/**
 * Validate and normalize an array of tag strings.
 * Returns { error: string } if invalid, { tags: string[] } if valid.
 * @param {*} tags - The tags value to validate
 * @param {number} max - Maximum number of tags allowed
 * @returns {{ error: string, tags?: undefined } | { tags: string[], error?: undefined }}
 */
export function validateTagsArray(tags, max) {
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
  return { tags: tags.map((t) => t.toLowerCase().trim()).filter(Boolean) };
}

/**
 * Wrap a handler with rate limit check + consume pattern.
 * Checks the rate limit before running the handler. Only consumes
 * the rate limit if the handler returns a response with status < 400
 * (i.e., on success). This matches the existing route behavior where
 * failed operations do not count against the limit.
 *
 * @param {object} db - Database DO stub
 * @param {string} key - Rate limit key
 * @param {number} max - Max per day
 * @param {string} errorMsg - Error message when limit reached
 * @param {function} handler - Async function to run if allowed; should return a Response
 * @returns {Promise<Response>}
 */
export async function withRateLimit(db, key, max, errorMsg, handler) {
  let limit;
  try {
    limit = await db.checkRateLimit(key, max);
  } catch (err) {
    log.error('rate limit check failed', {
      key,
      error: /** @type {any} */ (err)?.message || String(err),
    });
    return json({ error: 'Service temporarily unavailable' }, 503);
  }
  if (!limit.allowed) {
    return json({ error: errorMsg }, 429, { 'Retry-After': '3600' });
  }
  const response = await handler();
  if (response.status < 400) {
    try {
      await db.consumeRateLimit(key);
    } catch (err) {
      log.error('rate limit consume failed', {
        key,
        error: /** @type {any} */ (err)?.message || String(err),
      });
    }
  }
  return response;
}

/**
 * Validate that `body[field]` is a non-empty string, optionally capping length.
 * Returns the trimmed string on success, or null if invalid.
 *
 * @param {object} body - Parsed request body
 * @param {string} field - Field name to check
 * @param {number} [maxLength] - Optional max character length
 * @returns {string|null} Trimmed string or null
 */
export function requireString(body, field, maxLength) {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) return null;
  if (maxLength && value.length > maxLength) return null;
  return value.trim();
}

/**
 * Validate that `body[field]` is an array with at most `maxItems` entries.
 * Returns the array on success, or null if invalid.
 *
 * @param {object} body - Parsed request body
 * @param {string} field - Field name to check
 * @param {number} maxItems - Maximum allowed items
 * @returns {Array|null} Validated array or null
 */
export function requireArray(body, field, maxItems) {
  const value = body[field];
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.length > maxItems) return null;
  return value;
}

/**
 * Execute `SELECT changes()` on a DO SQL handle and return whether any rows changed.
 * Replaces the repeated pattern: `sql.exec('SELECT changes() as c').toArray()[0].c`
 *
 * @param {object} sql - DO SQL handle
 * @returns {number} Number of rows changed by the last statement
 */
export function sqlChanges(sql) {
  return sql.exec('SELECT changes() as c').toArray()[0].c;
}

/**
 * Run a function inside a Durable Object storage transaction.
 * Uses `ctx.storage.transactionSync()` for atomicity — if `fn` throws,
 * all SQL operations inside are rolled back automatically.
 *
 * Callers pass the DO's `transact` function (bound to ctx.storage.transactionSync)
 * so submodules don't need a direct reference to ctx.
 *
 * @template T
 * @param {(fn: () => T) => T} transact - ctx.storage.transactionSync bound to the DO
 * @param {() => T} fn - Synchronous function containing sql.exec calls
 * @returns {T} The return value of `fn`
 */
export function withTransaction(transact, fn) {
  return transact(fn);
}

/**
 * Build an SQL IN clause from an array of items.
 * Returns a placeholder string and params array suitable for embedding in a query.
 * When the array is empty, returns a literal that matches nothing (`'__none__'`),
 * avoiding SQL syntax errors from `IN ()`.
 *
 * @param {any[]} items - Values to include in the IN clause
 * @returns {{ sql: string, params: any[] }}
 */
export function buildInClause(items) {
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
 *
 * @param {Request} request - Incoming request (for IP extraction)
 * @param {object} env - Worker env (for DB access)
 * @param {string} prefix - Rate limit key prefix (e.g. 'stats', 'catalog')
 * @param {number} max - Max requests per IP per 24h window
 * @param {function} handler - Async function to run if allowed; should return a Response
 * @returns {Promise<Response>}
 */
export async function withIpRateLimit(request, env, prefix, max, handler) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) {
    return json({ error: 'Unable to identify client' }, 400);
  }
  const hashedIp = await hashIp(ip);
  const key = `pub:${prefix}:${hashedIp}`;
  const db = getDB(env);
  const result = await db.checkAndConsume(key, max);
  if (!result.allowed) {
    return json({ error: 'Rate limit exceeded. Try again later.' }, 429, {
      'Retry-After': '3600',
    });
  }
  return handler();
}

/**
 * Higher-order wrapper for the common team route pattern:
 * get DB + team stubs, extract agent runtime, rate-limit, call a team DO
 * method, and map the result to an HTTP response.
 *
 * Eliminates the repeated 4-line preamble (getDB, getTeam, getAgentRuntime)
 * and the withRateLimit + error-mapping boilerplate from team route handlers.
 *
 * @param {object} opts
 * @param {Request} opts.request
 * @param {object}  opts.user
 * @param {object}  opts.env
 * @param {string}  opts.teamId
 * @param {string}  opts.rateLimitKey - e.g. 'memory', 'locks' (prefixed with user.id internally)
 * @param {number}  opts.rateLimitMax
 * @param {string}  opts.rateLimitMsg
 * @param {number}  [opts.successStatus=200] - HTTP status on success
 * @param {(team: any, agentId: string, runtime: any) => Promise<any>} opts.action
 *   Called with the team DO stub, resolved agentId, and full runtime.
 *   Should return a DO result object ({ ok, ... } or { error, code }).
 * @returns {Promise<Response>}
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
}) {
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
 *
 * @param {string} ip - Raw IP address
 * @returns {Promise<string>} Truncated hex hash
 */
async function hashIp(ip) {
  const data = new TextEncoder().encode(ip);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

/** Test whether a string is a valid UUID v4 (the format produced by crypto.randomUUID()). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUUID(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}
