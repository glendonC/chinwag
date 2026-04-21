// Team analytics: member-level analytics.

import { createLogger } from '../../../lib/logger.js';
import type { MemberAnalytics, MemberDailyLineTrend } from '@chinwag/shared/contracts/analytics.js';

const log = createLogger('TeamDO.analytics');

export function queryMemberAnalytics(sql: SqlStorage, days: number): MemberAnalytics[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           handle,
           COUNT(*) AS sessions,
           SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN outcome = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
           SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate,
           ROUND(AVG(
             ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60)
           ), 1) AS avg_duration_min,
           COALESCE(SUM(edit_count), 0) AS total_edits,
           COALESCE(SUM(lines_added), 0) AS total_lines_added,
           COALESCE(SUM(lines_removed), 0) AS total_lines_removed,
           COALESCE(SUM(commit_count), 0) AS total_commits,
           COALESCE(SUM(
             CASE WHEN ended_at IS NOT NULL
               THEN ROUND((julianday(ended_at) - julianday(started_at)) * 24, 2)
               ELSE 0
             END
           ), 0) AS total_session_hours
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
         GROUP BY handle
         ORDER BY sessions DESC
         LIMIT 50`,
        days,
      )
      .toArray();

    // Get primary tool per handle in a second pass
    const toolRows = sql
      .exec(
        `SELECT handle, host_tool, COUNT(*) AS cnt
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND host_tool IS NOT NULL AND host_tool != 'unknown'
         GROUP BY handle, host_tool
         ORDER BY handle, cnt DESC`,
        days,
      )
      .toArray();

    const primaryTools = new Map<string, string>();
    for (const t of toolRows) {
      const row = t as Record<string, unknown>;
      const h = row.handle as string;
      if (!primaryTools.has(h)) primaryTools.set(h, row.host_tool as string);
    }

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      const handle = row.handle as string;
      return {
        handle,
        sessions: (row.sessions as number) || 0,
        completed: (row.completed as number) || 0,
        abandoned: (row.abandoned as number) || 0,
        failed: (row.failed as number) || 0,
        completion_rate: (row.completion_rate as number) || 0,
        avg_duration_min: (row.avg_duration_min as number) || 0,
        total_edits: (row.total_edits as number) || 0,
        total_lines_added: (row.total_lines_added as number) || 0,
        total_lines_removed: (row.total_lines_removed as number) || 0,
        total_commits: (row.total_commits as number) || 0,
        primary_tool: primaryTools.get(handle) || null,
        total_session_hours: (row.total_session_hours as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`memberAnalytics query failed: ${err}`);
    return [];
  }
}

// Per-teammate daily timeline. Scoped to the same top-50 handles as
// queryMemberAnalytics (ranked by total edits in the window) so the two
// fields agree on which handles exist. Uses the recursive-CTE spine +
// CROSS JOIN pattern from queryToolDaily for dense day axes — each
// handle's sparkline stays legible when they worked on non-contiguous days.
export function queryMemberDailyLines(sql: SqlStorage, days: number): MemberDailyLineTrend[] {
  try {
    const rows = sql
      .exec(
        `WITH RECURSIVE spine(day) AS (
           SELECT date('now', '-' || ? || ' days')
           UNION ALL
           SELECT date(day, '+1 day') FROM spine WHERE day < date('now')
         ),
         top_handles AS (
           SELECT handle FROM sessions
           WHERE started_at >= date('now', '-' || ? || ' days')
             AND handle IS NOT NULL
           GROUP BY handle
           ORDER BY COALESCE(SUM(edit_count), 0) DESC
           LIMIT 50
         )
         SELECT top_handles.handle AS handle,
                spine.day AS day,
                COUNT(s.id) AS sessions,
                COALESCE(SUM(s.edit_count), 0) AS edits,
                COALESCE(SUM(s.lines_added), 0) AS lines_added,
                COALESCE(SUM(s.lines_removed), 0) AS lines_removed
         FROM spine
         CROSS JOIN top_handles
         LEFT JOIN sessions s ON s.handle = top_handles.handle
           AND date(s.started_at) = spine.day
           AND s.started_at >= date('now', '-' || ? || ' days')
         GROUP BY top_handles.handle, spine.day
         ORDER BY spine.day ASC, top_handles.handle ASC`,
        days,
        days,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        handle: row.handle as string,
        day: row.day as string,
        sessions: (row.sessions as number) || 0,
        edits: (row.edits as number) || 0,
        lines_added: (row.lines_added as number) || 0,
        lines_removed: (row.lines_removed as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`memberDailyLines query failed: ${err}`);
    return [];
  }
}
