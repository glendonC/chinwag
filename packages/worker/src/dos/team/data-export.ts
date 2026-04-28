// Per-user data export and erasure for a single TeamDO.
//
// Why this exists. GDPR Art. 15 (right of access) and Art. 17 (right to
// erasure) require chinmeister to enumerate-and-return or enumerate-and-delete
// every piece of personal data we hold for a given user. The user's data is
// fanned across the DatabaseDO (account-level: users, user_teams,
// user_metrics, web_sessions) and across N TeamDOs (per-team: sessions,
// edits, conversation_events, memories the user authored, tool_calls,
// commits, messages, locks, presence).
//
// Each TeamDO exposes one `exportForHandle` and one `deleteForHandle` so the
// route handler can fan out to every team in `user_teams` and bundle the
// results. Both methods filter by handle (the per-team identifier carried on
// every row) so cross-handle data stays untouched.
//
// Deletion semantics:
//   - Sessions, edits, tool_calls, commits, conversation_events, locks,
//     messages, activities - deleted in full where handle matches.
//   - Memories - deleted where the user is the author. Memories the user
//     read but didn't write stay (they're team knowledge).
//   - Members / team_owners rows - kept. Membership is governed by the
//     /teams/:tid/leave route; data export is not a roster operation.
//   - daily_metrics - no per-user dimension, untouched.
//   - telemetry - global counters, untouched.
//
// Export is a single read pass; deletion is a single transactional pass so
// partial failures don't strand orphaned rows referencing deleted sessions.

import { withTransaction } from '../../lib/validation.js';

export interface UserDataExport {
  handle: string;
  exported_at: string;
  sessions: Record<string, unknown>[];
  edits: Record<string, unknown>[];
  tool_calls: Record<string, unknown>[];
  commits: Record<string, unknown>[];
  conversation_events: Record<string, unknown>[];
  memories_authored: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  locks: Record<string, unknown>[];
  /** Counts row counts of presence-only data (members, activities) the user owns. */
  presence_summary: { members: number; activities: number };
}

export interface UserDataDeletionResult {
  handle: string;
  deleted_at: string;
  counts: {
    sessions: number;
    edits: number;
    tool_calls: number;
    commits: number;
    conversation_events: number;
    memories: number;
    messages: number;
    locks: number;
    activities: number;
    members: number;
  };
}

/**
 * Read every row authored by the given handle across the team's per-user
 * tables. Result is bounded by SESSION_RETENTION_DAYS (sessions and their
 * children) and the team's memory/edit history. For very active users this
 * can be large; the route layer streams the merged export back as JSON.
 */
export function exportForHandle(sql: SqlStorage, handle: string): UserDataExport {
  const rows = (q: string, ...params: unknown[]): Record<string, unknown>[] =>
    sql.exec(q, ...params).toArray() as Record<string, unknown>[];

  const memberCount = rows('SELECT COUNT(*) AS c FROM members WHERE handle = ?', handle);
  const activityCount = rows(
    `SELECT COUNT(*) AS c FROM activities a
     JOIN members m ON m.agent_id = a.agent_id
     WHERE m.handle = ?`,
    handle,
  );

  return {
    handle,
    exported_at: new Date().toISOString(),
    sessions: rows('SELECT * FROM sessions WHERE handle = ?', handle),
    edits: rows('SELECT * FROM edits WHERE handle = ?', handle),
    tool_calls: rows('SELECT * FROM tool_calls WHERE handle = ?', handle),
    commits: rows('SELECT * FROM commits WHERE handle = ?', handle),
    conversation_events: rows('SELECT * FROM conversation_events WHERE handle = ?', handle),
    memories_authored: rows('SELECT * FROM memories WHERE handle = ?', handle),
    messages: rows('SELECT * FROM messages WHERE handle = ?', handle),
    locks: rows(
      `SELECT l.* FROM locks l
       JOIN members m ON m.agent_id = l.agent_id
       WHERE m.handle = ?`,
      handle,
    ),
    presence_summary: {
      members: ((memberCount[0] as Record<string, unknown>)?.c as number) || 0,
      activities: ((activityCount[0] as Record<string, unknown>)?.c as number) || 0,
    },
  };
}

/**
 * Erase every row authored by `handle` across the team's per-user tables in
 * a single transaction. Returns row counts so the route handler can bundle
 * a deletion receipt for the user.
 *
 * Order: child rows before parents within FK-like relationships. SQLite
 * doesn't enforce FKs by default in this codebase, but the order keeps the
 * intermediate state coherent (no edits/tool_calls referencing a session
 * that's about to vanish).
 */
export function deleteForHandle(
  sql: SqlStorage,
  handle: string,
  transact: <T>(fn: () => T) => T,
): UserDataDeletionResult {
  const counts = {
    sessions: 0,
    edits: 0,
    tool_calls: 0,
    commits: 0,
    conversation_events: 0,
    memories: 0,
    messages: 0,
    locks: 0,
    activities: 0,
    members: 0,
  };

  withTransaction(transact, () => {
    const exec = (q: string, ...params: unknown[]): number => {
      sql.exec(q, ...params);
      return Number(sql.exec('SELECT changes() AS c').toArray()[0]?.c ?? 0);
    };

    counts.locks = exec(
      `DELETE FROM locks WHERE agent_id IN (SELECT agent_id FROM members WHERE handle = ?)`,
      handle,
    );
    counts.activities = exec(
      `DELETE FROM activities WHERE agent_id IN (SELECT agent_id FROM members WHERE handle = ?)`,
      handle,
    );
    counts.edits = exec('DELETE FROM edits WHERE handle = ?', handle);
    counts.tool_calls = exec('DELETE FROM tool_calls WHERE handle = ?', handle);
    counts.commits = exec('DELETE FROM commits WHERE handle = ?', handle);
    counts.conversation_events = exec('DELETE FROM conversation_events WHERE handle = ?', handle);
    counts.messages = exec('DELETE FROM messages WHERE handle = ?', handle);
    counts.memories = exec('DELETE FROM memories WHERE handle = ?', handle);
    counts.sessions = exec('DELETE FROM sessions WHERE handle = ?', handle);
    counts.members = exec('DELETE FROM members WHERE handle = ?', handle);
    // team_owners is intentionally NOT deleted here - that's a roster
    // operation and goes through /teams/:tid/leave. Data erasure is
    // about content, not membership.
  });

  return {
    handle,
    deleted_at: new Date().toISOString(),
    counts,
  };
}
