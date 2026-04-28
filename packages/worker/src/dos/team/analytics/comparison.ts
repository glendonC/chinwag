// Period comparison analytics: current vs previous period metrics.
//
// Window alignment: `current` spans the last `days` days, `previous` spans the
// same length immediately before that. We deliberately do NOT clamp to
// SESSION_RETENTION_DAYS here - the retention cutoff is handled by the data
// itself (sessions older than 30d are pruned). At `days > 30` the previous
// window reaches into pruned data, queryPeriodMetrics returns null, and the
// client hides the delta. That matches the widget's value (sum of
// daily_trends over the same window) without manufacturing a mismatched
// shorter delta window.

import { createLogger } from '../../../lib/logger.js';
import type { PeriodComparison, PeriodMetrics } from '@chinmeister/shared/contracts/analytics.js';
import { type AnalyticsScope, withScope } from './scope.js';

const log = createLogger('TeamDO.analytics');

export function queryPeriodComparison(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): PeriodComparison {
  const effectiveDays = days;

  function queryPeriodMetrics(offsetStart: number, offsetEnd: number): PeriodMetrics | null {
    try {
      const { sql: q, params } = withScope(
        `SELECT
             COUNT(*) AS total_sessions,
             SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
             ROUND(AVG(
               ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60)
             ), 1) AS avg_duration_min,
             SUM(CASE WHEN got_stuck = 1 THEN 1 ELSE 0 END) AS stuck_sessions,
             COALESCE(SUM(edit_count), 0) AS total_edits,
             COALESCE(SUM(
               CASE WHEN ended_at IS NOT NULL
                 THEN ROUND((julianday(ended_at) - julianday(started_at)) * 24, 2)
                 ELSE 0
               END
             ), 0) AS total_session_hours,
             SUM(CASE WHEN memories_searched > 0 THEN 1 ELSE 0 END) AS sessions_with_memory
           FROM sessions
           WHERE started_at > datetime('now', '-' || ? || ' days')
             AND started_at <= datetime('now', '-' || ? || ' days')`,
        [offsetStart, offsetEnd],
        scope,
      );
      const rows = sql.exec(q, ...params).toArray();

      const r = (rows[0] || {}) as Record<string, unknown>;
      const total = (r.total_sessions as number) || 0;
      if (total === 0) return null;

      const completed = (r.completed as number) || 0;
      const totalHours = (r.total_session_hours as number) || 0;
      const totalEdits = (r.total_edits as number) || 0;
      const stuck = (r.stuck_sessions as number) || 0;

      // Memory hit rate from daily_metrics (period-scoped)
      // Scope: not applicable - daily_metrics has no per-user dimension
      let memoryHitRate = 0;
      try {
        const telRows = sql
          .exec(
            `SELECT
               COALESCE(SUM(CASE WHEN metric = 'memories_searched' THEN count ELSE 0 END), 0) AS searches,
               COALESCE(SUM(CASE WHEN metric = 'memories_search_hits' THEN count ELSE 0 END), 0) AS hits
             FROM daily_metrics
             WHERE date > date('now', '-' || ? || ' days')
               AND date <= date('now', '-' || ? || ' days')
               AND metric IN ('memories_searched', 'memories_search_hits')`,
            offsetStart,
            offsetEnd,
          )
          .toArray();
        const t = (telRows[0] || {}) as Record<string, unknown>;
        const searches = (t.searches as number) || 0;
        const hits = (t.hits as number) || 0;
        memoryHitRate = searches > 0 ? Math.round((hits / searches) * 1000) / 10 : 0;
      } catch {
        // telemetry is best-effort
      }

      return {
        completion_rate: Math.round((completed / total) * 1000) / 10,
        avg_duration_min: (r.avg_duration_min as number) || 0,
        stuckness_rate: Math.round((stuck / total) * 1000) / 10,
        memory_hit_rate: memoryHitRate,
        edit_velocity: totalHours > 0 ? Math.round((totalEdits / totalHours) * 10) / 10 : 0,
        total_sessions: total,
        // Cost fields are populated downstream by enrichPeriodComparisonCost
        // in dos/team/index.ts (getAnalytics + getAnalyticsForOwner), which
        // prices the current + previous window aggregates against today's
        // pricing snapshot. Null here is the pre-enrichment placeholder -
        // any code path that skips enrichment will see em-dashes in the UI.
        total_estimated_cost_usd: null,
        total_edits_in_token_sessions: 0,
        cost_per_edit: null,
      };
    } catch (err) {
      log.warn(`periodMetrics query failed: ${err}`);
      return null;
    }
  }

  const current = queryPeriodMetrics(effectiveDays, 0);
  const previous = queryPeriodMetrics(effectiveDays * 2, effectiveDays);

  return {
    current: current || {
      completion_rate: 0,
      avg_duration_min: 0,
      stuckness_rate: 0,
      memory_hit_rate: 0,
      edit_velocity: 0,
      total_sessions: 0,
      // Structural placeholders - see note on queryPeriodMetrics return.
      total_estimated_cost_usd: null,
      total_edits_in_token_sessions: 0,
      cost_per_edit: null,
    },
    previous,
  };
}
