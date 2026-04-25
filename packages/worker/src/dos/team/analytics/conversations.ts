// Conversation analytics: conversation-to-edit correlation.

import { createLogger } from '../../../lib/logger.js';
import type {
  ConversationEditCorrelation,
  ConfusedFileEntry,
  UnansweredQuestionStats,
} from '@chinmeister/shared/contracts/analytics.js';
import { type AnalyticsScope, buildScopeFilter, withScope } from './scope.js';

const log = createLogger('TeamDO.analytics');

// Conversation-depth bucketing. `max` is the inclusive upper bound for the
// bucket; the final entry with `max: null` captures everything above the
// previous threshold. Labels are human-readable and pass through verbatim to
// the UI (the conversation-depth widget renders "1-5 turns" directly).
const CONVERSATION_DEPTH_BUCKETS: Array<{ max: number | null; label: string }> = [
  { max: 5, label: '1-5 turns' },
  { max: 15, label: '6-15 turns' },
  { max: 30, label: '16-30 turns' },
  { max: null, label: '30+ turns' },
];

function buildBucketCase(column: string): string {
  const whens = CONVERSATION_DEPTH_BUCKETS.filter((b) => b.max != null)
    .map((b) => `WHEN ${column} <= ${b.max} THEN '${b.label}'`)
    .join(' ');
  const fallback = CONVERSATION_DEPTH_BUCKETS.find((b) => b.max == null)!.label;
  return `CASE ${whens} ELSE '${fallback}' END`;
}

function buildBucketOrderCase(bucketColumn: string): string {
  const cases = CONVERSATION_DEPTH_BUCKETS.map((b, i) => `WHEN '${b.label}' THEN ${i + 1}`).join(
    ' ',
  );
  return `CASE ${bucketColumn} ${cases} END`;
}

export function queryConversationEditCorrelation(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): ConversationEditCorrelation[] {
  try {
    // Filter handle in the inner CTE so the join only sees the caller's
    // sessions; downstream JOIN to sessions inherits the scope automatically.
    const f = buildScopeFilter(scope);
    const rows = sql
      .exec(
        `WITH session_turns AS (
           SELECT session_id,
                  SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user_turns
           FROM conversation_events
           WHERE created_at > datetime('now', '-' || ? || ' days')${f.sql}
           GROUP BY session_id
         )
         SELECT
           ${buildBucketCase('t.user_turns')} AS bucket,
           COUNT(*) AS sessions,
           ROUND(AVG(s.edit_count), 1) AS avg_edits,
           ROUND(AVG(s.lines_added + s.lines_removed), 1) AS avg_lines,
           ROUND(CAST(SUM(CASE WHEN s.outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate
         FROM session_turns t
         JOIN sessions s ON s.id = t.session_id
         GROUP BY bucket
         ORDER BY ${buildBucketOrderCase('bucket')}`,
        days,
        ...f.params,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        bucket: row.bucket as string,
        sessions: (row.sessions as number) || 0,
        avg_edits: (row.avg_edits as number) || 0,
        avg_lines: (row.avg_lines as number) || 0,
        completion_rate: (row.completion_rate as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`conversationEditCorrelation query failed: ${err}`);
    return [];
  }
}

// Files where the user-side conversation showed confusion or frustration in
// 2+ sessions touching the file. Surfaces FILES, not sentiment polarity —
// sentiment is an input to the file-axis question per ANALYTICS_SPEC §10
// anti-pattern #1 ("use as input to Failure Analysis, never alone"). The
// HAVING confused_sessions >= 2 floor is what makes this distinct from a
// per-session sentiment dump: only files where the agent struggled
// repeatedly surface, which is the actionable set.
const CONFUSED_FILES_MIN_SESSIONS = 2;
const CONFUSED_FILES_LIMIT = 10;
const CONFUSED_SENTIMENTS = ['confused', 'frustrated'];

export function queryConfusedFiles(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): ConfusedFileEntry[] {
  try {
    const f = buildScopeFilter(scope);
    // Inner CTE picks sessions whose user-side conversation contained any
    // confused/frustrated message. Outer query joins to edits, groups by
    // file, counts sessions and the abandoned/failed subset (severity hint).
    const sentimentPlaceholders = CONFUSED_SENTIMENTS.map(() => '?').join(', ');
    const rows = sql
      .exec(
        `WITH confused_sessions AS (
           SELECT DISTINCT session_id
           FROM conversation_events
           WHERE created_at > datetime('now', '-' || ? || ' days')
             AND role = 'user'
             AND sentiment IN (${sentimentPlaceholders})
         )
         SELECT
           e.file_path AS file,
           COUNT(DISTINCT s.id) AS confused_sessions,
           COUNT(DISTINCT CASE WHEN s.outcome IN ('abandoned', 'failed') THEN s.id END)
             AS retried_sessions
         FROM sessions s
         JOIN edits e ON e.session_id = s.id
         WHERE s.id IN (SELECT session_id FROM confused_sessions)
           AND s.started_at > datetime('now', '-' || ? || ' days')${f.sql}
         GROUP BY e.file_path
         HAVING confused_sessions >= ?
         ORDER BY confused_sessions DESC, retried_sessions DESC
         LIMIT ?`,
        days,
        ...CONFUSED_SENTIMENTS,
        days,
        ...f.params,
        CONFUSED_FILES_MIN_SESSIONS,
        CONFUSED_FILES_LIMIT,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        file: row.file as string,
        confused_sessions: (row.confused_sessions as number) || 0,
        retried_sessions: (row.retried_sessions as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`confusedFiles query failed: ${err}`);
    return [];
  }
}

// Count of user messages classified topic='question' in sessions that ended
// abandoned. Single scalar — the signal is "intent the agent couldn't
// fulfill, walk this back into memory or a follow-up session." Frame is
// navigation aid, not metric (same shape as live-conflicts: number drives
// drill into the underlying sessions).
export function queryUnansweredQuestions(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): UnansweredQuestionStats {
  try {
    const { sql: q, params } = withScope(
      `SELECT COUNT(*) AS count
         FROM conversation_events ce
         JOIN sessions s ON s.id = ce.session_id
         WHERE ce.created_at > datetime('now', '-' || ? || ' days')
           AND ce.role = 'user'
           AND ce.topic = 'question'
           AND s.outcome = 'abandoned'`,
      [days],
      scope,
    );
    const row = sql.exec(q, ...params).one() as Record<string, unknown>;
    return { count: (row.count as number) || 0 };
  } catch (err) {
    log.warn(`unansweredQuestions query failed: ${err}`);
    return { count: 0 };
  }
}
