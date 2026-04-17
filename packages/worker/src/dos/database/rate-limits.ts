// Rate limiting -- hourly buckets with a 24-hour sliding window.
//
// Each bucket stores the count for one hour (key = "YYYY-MM-DDTHH"). To check
// the limit, we SUM all buckets from the last 24 hours. This prevents the
// midnight-reset exploit where a user could double their quota around UTC
// midnight.
//
// Each function takes `sql` as the first parameter.

import type { RateLimitCheck } from '../../types.js';

/** Return the hourly bucket key for a given timestamp (e.g. "2026-04-02T14"). */
function hourBucket(ms: number): string {
  return new Date(ms).toISOString().slice(0, 13);
}

export function checkRateLimit(
  sql: SqlStorage,
  key: string,
  maxPerWindow = 3,
): RateLimitCheck & { ok: true } {
  const windowStart = hourBucket(Date.now() - 24 * 60 * 60 * 1000);

  const rows = sql
    .exec(
      'SELECT COALESCE(SUM(count), 0) as total FROM account_limits WHERE ip = ? AND date >= ?',
      key,
      windowStart,
    )
    .toArray();

  const count = ((rows[0] as Record<string, unknown>)?.total as number) || 0;
  return { ok: true, allowed: count < maxPerWindow, count };
}

export function consumeRateLimit(sql: SqlStorage, key: string): { ok: true } {
  const bucket = hourBucket(Date.now());

  sql.exec(
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
export function checkAndConsume(
  sql: SqlStorage,
  key: string,
  maxPerWindow = 3,
): { ok: true; allowed: boolean; count: number } {
  const now = Date.now();
  const windowStart = hourBucket(now - 24 * 60 * 60 * 1000);
  const bucket = hourBucket(now);

  const rows = sql
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

  sql.exec(
    `INSERT INTO account_limits (ip, date, count) VALUES (?, ?, 1)
     ON CONFLICT(ip, date) DO UPDATE SET count = count + 1`,
    key,
    bucket,
  );

  return { ok: true, allowed: true, count: count + 1 };
}
