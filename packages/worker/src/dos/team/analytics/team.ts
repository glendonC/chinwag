// Team analytics: member-level analytics.

import { createLogger } from '../../../lib/logger.js';
import type {
  MemberAnalytics,
  MemberDailyLineTrend,
} from '@chinmeister/shared/contracts/analytics.js';
import { row, rows } from '../../../lib/row.js';
import { type AnalyticsScope } from './scope.js';

const log = createLogger('TeamDO.analytics');

// Uncapped distinct-handle count for the window. Ships alongside the top-50
// `queryMemberAnalytics` rows so the renderer can honestly surface a "+N more"
// affordance when the team has more active members than the rendered list.
// Without this, LIMIT 50 truncation was silent.
export function queryMemberCount(sql: SqlStorage, _scope: AnalyticsScope, days: number): number {
  try {
    // Scope intentionally ignored — this metric is cross-member by design (team cohort view).
    const countRows = sql
      .exec(
        `SELECT COUNT(DISTINCT handle) AS total
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND handle IS NOT NULL`,
        days,
      )
      .toArray();
    return row(countRows[0]).number('total');
  } catch (err) {
    log.warn(`memberCount query failed: ${err}`);
    return 0;
  }
}

export function queryMemberAnalytics(
  sql: SqlStorage,
  _scope: AnalyticsScope,
  days: number,
): MemberAnalytics[] {
  try {
    // Scope intentionally ignored — this metric is cross-member by design (team cohort view).
    // Audit 2026-04-21: SQL trimmed to the fields the contract still carries.
    // See memberAnalyticsSchema for the list of dropped fields and rationale.
    const memberRows = sql
      .exec(
        `SELECT
           handle,
           COUNT(*) AS sessions,
           SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate,
           COALESCE(SUM(edit_count), 0) AS total_edits,
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
      const r = row(t);
      const h = r.string('handle');
      if (!primaryTools.has(h)) primaryTools.set(h, r.string('host_tool'));
    }

    return rows<MemberAnalytics>(memberRows, (r) => {
      const handle = r.string('handle');
      return {
        handle,
        sessions: r.number('sessions'),
        completed: r.number('completed'),
        completion_rate: r.number('completion_rate'),
        total_edits: r.number('total_edits'),
        primary_tool: primaryTools.get(handle) || null,
        total_session_hours: r.number('total_session_hours'),
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
export function queryMemberDailyLines(
  sql: SqlStorage,
  _scope: AnalyticsScope,
  days: number,
): MemberDailyLineTrend[] {
  try {
    // Scope intentionally ignored — this metric is cross-member by design (team cohort view).
    const dailyRows = sql
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

    return rows<MemberDailyLineTrend>(dailyRows, (r) => ({
      handle: r.string('handle'),
      day: r.string('day'),
      sessions: r.number('sessions'),
      edits: r.number('edits'),
      lines_added: r.number('lines_added'),
      lines_removed: r.number('lines_removed'),
    }));
  } catch (err) {
    log.warn(`memberDailyLines query failed: ${err}`);
    return [];
  }
}
