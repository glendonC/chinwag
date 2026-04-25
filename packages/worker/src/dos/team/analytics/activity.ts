// Activity analytics: hourly/daily distributions, duration, edit velocity.

import { createLogger } from '../../../lib/logger.js';
import type {
  HourlyBucket,
  ToolDailyTrend,
  DurationBucket,
  EditVelocityTrend,
} from '@chinmeister/shared/contracts/analytics.js';
import { type AnalyticsScope, buildScopeFilter } from './scope.js';

const log = createLogger('TeamDO.analytics');

export function queryHourlyDistribution(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
  tzOffsetMinutes: number = 0,
): HourlyBucket[] {
  // Hour and day-of-week are extracted from the session's local timestamp.
  // With tzOffsetMinutes=0 this is UTC; with a negative offset (e.g. PST)
  // the heatmap reflects when sessions happen in the user's local day.
  try {
    const f = buildScopeFilter(scope);
    const rows = sql
      .exec(
        `SELECT CAST(strftime('%H', datetime(started_at, ? || ' minutes')) AS INTEGER) AS hour,
                CAST(strftime('%w', datetime(started_at, ? || ' minutes')) AS INTEGER) AS dow,
                COUNT(*) AS sessions,
                COALESCE(SUM(edit_count), 0) AS edits
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')${f.sql}
         GROUP BY hour, dow
         ORDER BY hour, dow`,
        tzOffsetMinutes,
        tzOffsetMinutes,
        days,
        ...f.params,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        hour: (row.hour as number) || 0,
        dow: (row.dow as number) || 0,
        sessions: (row.sessions as number) || 0,
        edits: (row.edits as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`hourlyDistribution query failed: ${err}`);
    return [];
  }
}

export function queryToolDaily(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
  tzOffsetMinutes: number = 0,
): ToolDailyTrend[] {
  // Per-tool zero-fill: cross-join a local-TZ spine with distinct tools so
  // each tool's sparkline has a dense day axis in the caller's time zone.
  //
  // Scope filter applies twice: in the `tools` CTE (so tools never used by
  // the scoped user are excluded entirely) and in the LEFT JOIN ON clause
  // (so days are zero for the scoped user even if other users were active).
  try {
    const fTools = buildScopeFilter(scope);
    const fJoin = buildScopeFilter(scope, { handleColumn: 's.handle' });
    const rows = sql
      .exec(
        `WITH RECURSIVE spine(day) AS (
           SELECT date('now', ? || ' minutes', '-' || ? || ' days')
           UNION ALL
           SELECT date(day, '+1 day') FROM spine WHERE day < date('now', ? || ' minutes')
         ),
         tools AS (
           SELECT DISTINCT host_tool FROM sessions
           WHERE host_tool IS NOT NULL AND host_tool != 'unknown'
             AND started_at >= date('now', '-' || ? || ' days', '-1 day')${fTools.sql}
         )
         SELECT tools.host_tool AS host_tool,
                spine.day AS day,
                COUNT(s.id) AS sessions,
                COALESCE(SUM(s.edit_count), 0) AS edits,
                COALESCE(SUM(s.lines_added), 0) AS lines_added,
                COALESCE(SUM(s.lines_removed), 0) AS lines_removed,
                COALESCE(ROUND(AVG(
                  ROUND((julianday(COALESCE(s.ended_at, datetime('now'))) - julianday(s.started_at)) * 24 * 60)
                ), 1), 0) AS avg_duration_min
         FROM spine
         CROSS JOIN tools
         LEFT JOIN sessions s ON s.host_tool = tools.host_tool
           AND date(datetime(s.started_at, ? || ' minutes')) = spine.day
           AND s.started_at >= date('now', '-' || ? || ' days', '-1 day')${fJoin.sql}
         GROUP BY tools.host_tool, spine.day
         ORDER BY spine.day ASC, tools.host_tool ASC`,
        tzOffsetMinutes,
        days,
        tzOffsetMinutes,
        days,
        ...fTools.params,
        tzOffsetMinutes,
        days,
        ...fJoin.params,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        host_tool: row.host_tool as string,
        day: row.day as string,
        sessions: (row.sessions as number) || 0,
        edits: (row.edits as number) || 0,
        lines_added: (row.lines_added as number) || 0,
        lines_removed: (row.lines_removed as number) || 0,
        avg_duration_min: (row.avg_duration_min as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`toolDaily query failed: ${err}`);
    return [];
  }
}

export function queryDurationDistribution(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): DurationBucket[] {
  try {
    const f = buildScopeFilter(scope);
    const rows = sql
      .exec(
        `SELECT
           CASE
             WHEN duration_min < 5 THEN '0-5m'
             WHEN duration_min < 15 THEN '5-15m'
             WHEN duration_min < 30 THEN '15-30m'
             WHEN duration_min < 60 THEN '30-60m'
             ELSE '60m+'
           END AS bucket,
           COUNT(*) AS count
         FROM (
           SELECT ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60) AS duration_min
           FROM sessions
           WHERE started_at > datetime('now', '-' || ? || ' days')
             AND ended_at IS NOT NULL${f.sql}
         )
         GROUP BY bucket
         ORDER BY
           CASE bucket
             WHEN '0-5m' THEN 1
             WHEN '5-15m' THEN 2
             WHEN '15-30m' THEN 3
             WHEN '30-60m' THEN 4
             ELSE 5
           END`,
        days,
        ...f.params,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        bucket: row.bucket as string,
        count: (row.count as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`durationDistribution query failed: ${err}`);
    return [];
  }
}

export function queryEditVelocity(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
  tzOffsetMinutes: number = 0,
): EditVelocityTrend[] {
  // Local-TZ zero-fill spine. Closed sessions only; the `ended_at IS NOT NULL`
  // predicate stays on the join.
  //
  // Scope filter goes in the LEFT JOIN ON so spine days with no matching
  // sessions still emit a zero row for the scoped user.
  try {
    const f = buildScopeFilter(scope, { handleColumn: 's.handle' });
    const rows = sql
      .exec(
        `WITH RECURSIVE spine(day) AS (
           SELECT date('now', ? || ' minutes', '-' || ? || ' days')
           UNION ALL
           SELECT date(day, '+1 day') FROM spine WHERE day < date('now', ? || ' minutes')
         )
         SELECT spine.day AS day,
                COALESCE(SUM(s.edit_count), 0) AS total_edits,
                COALESCE(SUM(s.lines_added + s.lines_removed), 0) AS total_lines,
                COALESCE(SUM(
                  ROUND((julianday(s.ended_at) - julianday(s.started_at)) * 24, 2)
                ), 0) AS total_hours
         FROM spine
         LEFT JOIN sessions s ON date(datetime(s.started_at, ? || ' minutes')) = spine.day
           AND s.started_at >= date('now', '-' || ? || ' days', '-1 day')
           AND s.ended_at IS NOT NULL${f.sql}
         GROUP BY spine.day
         ORDER BY spine.day ASC`,
        tzOffsetMinutes,
        days,
        tzOffsetMinutes,
        tzOffsetMinutes,
        days,
        ...f.params,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      const hours = (row.total_hours as number) || 0;
      const edits = (row.total_edits as number) || 0;
      const lines = (row.total_lines as number) || 0;
      return {
        day: row.day as string,
        edits_per_hour: hours > 0 ? Math.round((edits / hours) * 10) / 10 : 0,
        lines_per_hour: hours > 0 ? Math.round((lines / hours) * 10) / 10 : 0,
        total_session_hours: Math.round(hours * 100) / 100,
      };
    });
  } catch (err) {
    log.warn(`editVelocity query failed: ${err}`);
    return [];
  }
}
