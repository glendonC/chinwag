// Web session CRUD -- cookie-based sessions for the web dashboard.
// Each function takes `sql` as the first parameter.

import type { DOResult, WebSession } from '../../types.js';
import { toSQLDateTime } from '../../lib/text-utils.js';
import { WEB_SESSION_DURATION_MS } from '../../lib/constants.js';

export function createWebSession(
  sql: SqlStorage,
  userId: string,
  userAgent: string | null,
): { ok: true; token: string; expires_at: string } {
  const token = crypto.randomUUID();
  const expiresAt = toSQLDateTime(new Date(Date.now() + WEB_SESSION_DURATION_MS));

  sql.exec(
    `INSERT INTO web_sessions (token, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)`,
    token,
    userId,
    expiresAt,
    userAgent || null,
  );
  return { ok: true, token, expires_at: expiresAt };
}

export function getWebSession(
  sql: SqlStorage,
  token: string,
): DOResult<{ ok: true; session: WebSession }> {
  const rows = sql
    .exec(
      `SELECT token, user_id, expires_at, last_used, user_agent, revoked
       FROM web_sessions
       WHERE token = ? AND revoked = 0 AND expires_at > datetime('now')`,
      token,
    )
    .toArray();
  if (rows.length === 0) return { error: 'Session not found', code: 'NOT_FOUND' };

  // Slide the window -- refresh expiry and last_used on access
  sql.exec(`UPDATE web_sessions SET last_used = datetime('now') WHERE token = ?`, token);
  return { ok: true, session: rows[0] as unknown as WebSession };
}

export function revokeWebSession(sql: SqlStorage, token: string): { ok: true } {
  sql.exec('UPDATE web_sessions SET revoked = 1 WHERE token = ?', token);
  return { ok: true };
}

export function getUserWebSessions(
  sql: SqlStorage,
  userId: string,
): { ok: true; sessions: WebSession[] } {
  const sessions = sql
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
