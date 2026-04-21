// Analytics core: base analytics assembly and foundational queries.

import { createLogger } from '../../../lib/logger.js';
import type {
  FileHeatmapEntry,
  DailyTrend,
  OutcomeCount,
  ToolDistribution,
  DailyMetricEntry,
  TeamAnalytics,
} from '@chinwag/shared/contracts/analytics.js';

const log = createLogger('TeamDO.analytics');

export const HEATMAP_LIMIT = 50;
export const ANALYTICS_MAX_DAYS = 90;

export function getAnalytics(
  sql: SqlStorage,
  days: number,
  tzOffsetMinutes: number = 0,
): TeamAnalytics {
  const periodDays = Math.max(1, Math.min(days, ANALYTICS_MAX_DAYS));

  return {
    ok: true,
    period_days: periodDays,
    file_heatmap: queryFileHeatmap(sql, periodDays),
    daily_trends: queryDailyTrends(sql, periodDays, tzOffsetMinutes),
    tool_distribution: queryToolDistribution(sql, periodDays),
    outcome_distribution: queryOutcomeDistribution(sql, periodDays),
    daily_metrics: queryDailyMetrics(sql, periodDays),
    files_touched_total: queryFilesTouchedTotal(sql, periodDays),
  };
}

// Uncapped count of distinct files edited in the period. Reads from the
// `edits` table (one row per edit event) so neither the HEATMAP_LIMIT=50
// list cap nor the ACTIVITY_MAX_FILES=50 per-session JSON cap apply. The
// ranked file_heatmap list and this scalar answer different questions and
// are computed from different sources on purpose.
export function queryFilesTouchedTotal(sql: SqlStorage, days: number): number {
  try {
    const rows = sql
      .exec(
        `SELECT COUNT(DISTINCT file_path) AS total
         FROM edits
         WHERE created_at > datetime('now', '-' || ? || ' days')`,
        days,
      )
      .toArray();
    const row = rows[0] as Record<string, unknown> | undefined;
    return (row?.total as number) ?? 0;
  } catch (err) {
    log.warn(`filesTouchedTotal query failed: ${err}`);
    return 0;
  }
}

export function queryFileHeatmap(sql: SqlStorage, days: number): FileHeatmapEntry[] {
  try {
    const rows = sql
      .exec(
        `SELECT value AS file, COUNT(*) AS touch_count
         FROM sessions, json_each(sessions.files_touched)
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND files_touched != '[]'
         GROUP BY value
         ORDER BY touch_count DESC
         LIMIT ?`,
        days,
        HEATMAP_LIMIT,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        file: row.file as string,
        touch_count: (row.touch_count as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`fileHeatmap query failed: ${err}`);
    return [];
  }
}

export function queryDailyTrends(
  sql: SqlStorage,
  days: number,
  tzOffsetMinutes: number = 0,
): DailyTrend[] {
  // Spine is generated in the caller's local TZ via the tzOffsetMinutes
  // modifier. Session timestamps are stored UTC and shifted at match time.
  // The UTC pre-filter keeps a 1-day buffer so the index on started_at still
  // prunes the scan regardless of TZ. Every day in the period appears in the
  // result — days with zero sessions return a row of zeros so the resulting
  // sparkline can't elide gaps and misrepresent activity density.
  try {
    const rows = sql
      .exec(
        `WITH RECURSIVE spine(day) AS (
           SELECT date('now', ? || ' minutes', '-' || ? || ' days')
           UNION ALL
           SELECT date(day, '+1 day') FROM spine WHERE day < date('now', ? || ' minutes')
         )
         SELECT spine.day AS day,
                COUNT(s.id) AS sessions,
                COALESCE(SUM(s.edit_count), 0) AS edits,
                COALESCE(SUM(s.lines_added), 0) AS lines_added,
                COALESCE(SUM(s.lines_removed), 0) AS lines_removed,
                COALESCE(ROUND(AVG(
                  ROUND((julianday(COALESCE(s.ended_at, datetime('now'))) - julianday(s.started_at)) * 24 * 60)
                ), 1), 0) AS avg_duration_min,
                COALESCE(SUM(CASE WHEN s.outcome = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
                COALESCE(SUM(CASE WHEN s.outcome = 'abandoned' THEN 1 ELSE 0 END), 0) AS abandoned,
                COALESCE(SUM(CASE WHEN s.outcome = 'failed' THEN 1 ELSE 0 END), 0) AS failed
         FROM spine
         LEFT JOIN sessions s ON date(datetime(s.started_at, ? || ' minutes')) = spine.day
           AND s.started_at >= date('now', '-' || ? || ' days', '-1 day')
         GROUP BY spine.day
         ORDER BY spine.day ASC`,
        tzOffsetMinutes,
        days,
        tzOffsetMinutes,
        tzOffsetMinutes,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        day: row.day as string,
        sessions: (row.sessions as number) || 0,
        edits: (row.edits as number) || 0,
        lines_added: (row.lines_added as number) || 0,
        lines_removed: (row.lines_removed as number) || 0,
        avg_duration_min: (row.avg_duration_min as number) || 0,
        completed: (row.completed as number) || 0,
        abandoned: (row.abandoned as number) || 0,
        failed: (row.failed as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`dailyTrends query failed: ${err}`);
    return [];
  }
}

export function queryToolDistribution(sql: SqlStorage, days: number): ToolDistribution[] {
  try {
    const rows = sql
      .exec(
        `SELECT host_tool,
                COUNT(*) AS sessions,
                COALESCE(SUM(edit_count), 0) AS edits
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND host_tool IS NOT NULL AND host_tool != 'unknown'
         GROUP BY host_tool
         ORDER BY sessions DESC`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        host_tool: row.host_tool as string,
        sessions: (row.sessions as number) || 0,
        edits: (row.edits as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`toolDistribution query failed: ${err}`);
    return [];
  }
}

export function queryOutcomeDistribution(sql: SqlStorage, days: number): OutcomeCount[] {
  try {
    const rows = sql
      .exec(
        `SELECT COALESCE(outcome, 'unknown') AS outcome,
                COUNT(*) AS count
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
         GROUP BY outcome
         ORDER BY count DESC`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        outcome: row.outcome as string,
        count: (row.count as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`outcomeDistribution query failed: ${err}`);
    return [];
  }
}

export function queryDailyMetrics(sql: SqlStorage, days: number): DailyMetricEntry[] {
  try {
    const rows = sql
      .exec(
        `SELECT date, metric, count
         FROM daily_metrics
         WHERE date > date('now', '-' || ? || ' days')
         ORDER BY date ASC, metric ASC`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        date: row.date as string,
        metric: row.metric as string,
        count: (row.count as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`dailyMetrics query failed: ${err}`);
    return [];
  }
}
