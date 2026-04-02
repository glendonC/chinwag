// Reusable validation helpers extracted from route handlers.
// Each returns null on success or an error string/response on failure.

import { json } from './http.js';
import { getDB } from './env.js';

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
    console.error(`[chinwag] Rate limit check failed for ${key}:`, err?.message || err);
    return json({ error: 'Service temporarily unavailable' }, 503);
  }
  if (!limit.allowed) {
    return json({ error: errorMsg }, 429, { 'Retry-After': String(secondsUntilMidnightUTC()) });
  }
  const response = await handler();
  if (response.status < 400) {
    try {
      await db.consumeRateLimit(key);
    } catch (err) {
      console.error(`[chinwag] Rate limit consume failed for ${key}:`, err?.message || err);
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
 * Rate limit a public (unauthenticated) endpoint by client IP.
 * Uses CF-Connecting-IP for the key. Consumes on every request
 * (not just success) since public endpoints are read-only and
 * we want to limit abuse regardless of response status.
 *
 * @param {Request} request - Incoming request (for IP extraction)
 * @param {object} env - Worker env (for DB access)
 * @param {string} prefix - Rate limit key prefix (e.g. 'stats', 'catalog')
 * @param {number} max - Max requests per IP per day
 * @param {function} handler - Async function to run if allowed; should return a Response
 * @returns {Promise<Response>}
 */
export async function withIpRateLimit(request, env, prefix, max, handler) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `pub:${prefix}:${ip}`;
  const db = getDB(env);
  const limit = await db.checkRateLimit(key, max);
  if (!limit.allowed) {
    return json({ error: 'Rate limit exceeded. Try again tomorrow.' }, 429, {
      'Retry-After': String(secondsUntilMidnightUTC()),
    });
  }
  await db.consumeRateLimit(key);
  return handler();
}

/** Seconds remaining until the next UTC midnight. */
function secondsUntilMidnightUTC() {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return Math.ceil((midnight - now) / 1000);
}
