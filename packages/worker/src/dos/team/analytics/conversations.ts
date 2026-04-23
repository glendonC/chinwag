// Conversation analytics: conversation-to-edit correlation.

import { createLogger } from '../../../lib/logger.js';
import type { ConversationEditCorrelation } from '@chinmeister/shared/contracts/analytics.js';

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
  days: number,
): ConversationEditCorrelation[] {
  try {
    const rows = sql
      .exec(
        `WITH session_turns AS (
           SELECT session_id,
                  SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user_turns
           FROM conversation_events
           WHERE created_at > datetime('now', '-' || ? || ' days')
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
