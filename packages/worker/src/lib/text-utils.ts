// Pure text utilities used by TeamDO for path normalization, date formatting,
// and safe JSON parsing of internal data.

import { createLogger } from './logger.js';

const log = createLogger('text-utils');

/**
 * Strip leading ./ and trailing /, collapse //, remove .. segments.
 * Prevents path traversal outside the project root.
 */
export function normalizePath(p: string): string {
  let result = p.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
  // Remove any ".." path segments to prevent path traversal
  result = result
    .split('/')
    .filter((seg) => seg !== '..')
    .join('/');
  // Clean up any leading slash that may result from stripping
  result = result.replace(/^\/+/, '');
  return result;
}

/** Convert a JS Date (or now) to SQLite-compatible datetime string: "YYYY-MM-DD HH:MM:SS" */
export function toSQLDateTime(date?: Date): string {
  return (date || new Date())
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
}

/**
 * Parse a JSON string stored in SQLite, returning fallback on failure.
 * Logs malformed data once per context string so schema bugs surface
 * in logs instead of silently returning empty arrays.
 */
const _loggedParseWarnings = new Set<string>();
export function safeParseJSON<T = unknown>(
  raw: string,
  fallback: T = [] as T,
  context = 'unknown',
): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    if (!_loggedParseWarnings.has(context)) {
      _loggedParseWarnings.add(context);
      log.warn('malformed JSON', {
        context,
        error: (err as Error).message,
        raw: raw.slice(0, 100),
      });
    }
    return fallback;
  }
}
