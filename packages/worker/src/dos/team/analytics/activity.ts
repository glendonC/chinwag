// Activity analytics: hourly/daily distributions, duration, edit velocity.

import { createLogger } from '../../../lib/logger.js';
import type {
  HourlyBucket,
  ToolDailyTrend,
  DurationBucket,
  EditVelocityTrend,
} from '@chinwag/shared/contracts/analytics.js';

const log = createLogger('TeamDO.analytics');

export function queryHourlyDistribution(sql: SqlStorage, days: number): HourlyBucket[] {
  try {
    const rows = sql
      .exec(
        `SELECT CAST(strftime('%H', started_at) AS INTEGER) AS hour,
                CAST(strftime('%w', started_at) AS INTEGER) AS dow,
                COUNT(*) AS sessions,
                COALESCE(SUM(edit_count), 0) AS edits
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
         GROUP BY hour, dow
         ORDER BY hour, dow`,
        days,
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

export function queryToolDaily(sql: SqlStorage, days: number): ToolDailyTrend[] {
  try {
    const rows = sql
      .exec(
        `SELECT host_tool,
                date(started_at) AS day,
                COUNT(*) AS sessions,
                COALESCE(SUM(edit_count), 0) AS edits,
                COALESCE(SUM(lines_added), 0) AS lines_added,
                COALESCE(SUM(lines_removed), 0) AS lines_removed,
                ROUND(AVG(
                  ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60)
                ), 1) AS avg_duration_min
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND host_tool IS NOT NULL AND host_tool != 'unknown'
         GROUP BY host_tool, day
         ORDER BY day ASC, host_tool ASC`,
        days,
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

export function queryDurationDistribution(sql: SqlStorage, days: number): DurationBucket[] {
  try {
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
             AND ended_at IS NOT NULL
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

export function queryEditVelocity(sql: SqlStorage, days: number): EditVelocityTrend[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           date(started_at) AS day,
           COALESCE(SUM(edit_count), 0) AS total_edits,
           COALESCE(SUM(lines_added + lines_removed), 0) AS total_lines,
           SUM(
             ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24, 2)
           ) AS total_hours
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND ended_at IS NOT NULL
         GROUP BY date(started_at)
         ORDER BY day ASC`,
        days,
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
