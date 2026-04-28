// Session analytics: retry patterns, conflict correlation, stuckness, file overlap, scope complexity.

import { createLogger } from '../../../lib/logger.js';
import { row, rows as mapRows } from '../../../lib/row.js';
import type {
  RetryPattern,
  ConflictCorrelation,
  ConflictStats,
  StucknessStats,
  FileOverlapStats,
  FirstEditStats,
  ScopeComplexityBucket,
} from '@chinmeister/shared/contracts/analytics.js';
import { type AnalyticsScope, buildScopeFilter, withScope } from './scope.js';

const log = createLogger('TeamDO.analytics');

export function queryRetryPatterns(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): RetryPattern[] {
  try {
    // Audit 2026-04-21: Regrouped from (handle, file) to file only so the
    // top-N cannot be swallowed by a single noisy agent. Adds cross-agent
    // (COUNT DISTINCT handle) and cross-tool (GROUP_CONCAT DISTINCT host_tool)
    // aggregates - the cross-tool column is the substrate-unique angle that
    // elevates D1: only chinmeister sees the same file retried across Claude Code
    // + Cursor + Windsurf. `latest_outcome` still picks the most recent
    // session's outcome across all agents so "resolved" means the file's
    // current state regardless of who last touched it.
    const { sql: q, params } = withScope(
      `WITH file_sessions AS (
           SELECT s.id, s.handle, COALESCE(s.host_tool, 'unknown') AS host_tool,
             s.outcome, s.started_at, f.value AS file
           FROM sessions s, json_each(s.files_touched) f
           WHERE s.started_at > datetime('now', '-' || ? || ' days')
             AND s.files_touched != '[]'`,
      [days],
      scope,
      { handleColumn: 's.handle' },
    );
    const rows = sql
      .exec(
        `${q}
         ),
         file_stats AS (
           SELECT file,
             COUNT(DISTINCT id) AS attempts,
             COUNT(DISTINCT handle) AS agents,
             GROUP_CONCAT(DISTINCT host_tool) AS tools_csv,
             MAX(CASE WHEN outcome IN ('abandoned', 'failed') THEN 1 ELSE 0 END) AS has_failure
           FROM file_sessions
           GROUP BY file
           HAVING attempts >= 2 AND has_failure = 1
         ),
         latest_outcome AS (
           SELECT file, outcome AS final_outcome,
             ROW_NUMBER() OVER (PARTITION BY file ORDER BY started_at DESC) AS rn
           FROM file_sessions
         )
         SELECT fs.file, fs.attempts, fs.agents, fs.tools_csv, lo.final_outcome
         FROM file_stats fs
         JOIN latest_outcome lo ON lo.file = fs.file AND lo.rn = 1
         ORDER BY fs.attempts DESC
         LIMIT 30`,
        ...params,
      )
      .toArray();

    return mapRows(rows, (r) => {
      const finalOutcome = r.nullableString('final_outcome') || null;
      const toolsCsv = r.string('tools_csv');
      return {
        file: r.string('file'),
        attempts: r.number('attempts'),
        agents: r.number('agents'),
        tools: toolsCsv ? toolsCsv.split(',').filter(Boolean) : [],
        final_outcome: finalOutcome,
        resolved: finalOutcome === 'completed',
      };
    });
  } catch (err) {
    log.warn(`retryPatterns query failed: ${err}`);
    return [];
  }
}

export function queryConflictCorrelation(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): ConflictCorrelation[] {
  try {
    const { sql: q, params } = withScope(
      `SELECT
           CASE WHEN conflicts_hit > 0 THEN '1+ conflicts' ELSE 'no conflicts' END AS bucket,
           COUNT(*) AS sessions,
           SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')`,
      [days],
      scope,
    );
    const rows = sql
      .exec(
        `${q}
         GROUP BY bucket
         ORDER BY bucket`,
        ...params,
      )
      .toArray();

    return mapRows(rows, (r) => ({
      bucket: r.string('bucket'),
      sessions: r.number('sessions'),
      completed: r.number('completed'),
      completion_rate: r.number('completion_rate'),
    }));
  } catch (err) {
    log.warn(`conflictCorrelation query failed: ${err}`);
    return [];
  }
}

export function queryConflictStats(
  sql: SqlStorage,
  _scope: AnalyticsScope,
  days: number,
): ConflictStats {
  // Scope: not applicable - daily_metrics has no per-user dimension
  try {
    const rows = sql
      .exec(
        `SELECT metric, COALESCE(SUM(count), 0) AS cnt
         FROM daily_metrics
         WHERE metric IN ('conflicts_blocked', 'conflicts_found')
           AND date > date('now', '-' || ? || ' days')
         GROUP BY metric`,
        days,
      )
      .toArray();
    let blocked = 0;
    let found = 0;
    for (const raw of rows) {
      const r = row(raw);
      const metric = r.string('metric');
      if (metric === 'conflicts_blocked') blocked = r.number('cnt');
      if (metric === 'conflicts_found') found = r.number('cnt');
    }
    // Daily breakdown for the conflicts-blocked widget's enhanced trend
    // sparkline. Same source as the period total (daily_metrics rolled up
    // by date) so the sparkline sums to blocked_period exactly.
    const dailyRows = sql
      .exec(
        `SELECT date AS day, COALESCE(SUM(count), 0) AS blocked
         FROM daily_metrics
         WHERE metric = 'conflicts_blocked'
           AND date > date('now', '-' || ? || ' days')
         GROUP BY date
         ORDER BY date ASC`,
        days,
      )
      .toArray();
    const daily_blocked = mapRows(dailyRows, (r) => ({
      day: r.string('day'),
      blocked: r.number('blocked'),
    }));
    return { blocked_period: blocked, found_period: found, daily_blocked };
  } catch (err) {
    log.warn(`conflictStats query failed: ${err}`);
    return { blocked_period: 0, found_period: 0, daily_blocked: [] };
  }
}

export function queryStuckness(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): StucknessStats {
  try {
    const { sql: q, params } = withScope(
      `SELECT
           COUNT(*) AS total_sessions,
           SUM(CASE WHEN got_stuck = 1 THEN 1 ELSE 0 END) AS stuck_sessions,
           ROUND(CAST(SUM(CASE WHEN got_stuck = 1 THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS stuckness_rate,
           ROUND(CAST(SUM(CASE WHEN got_stuck = 1 AND outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(SUM(CASE WHEN got_stuck = 1 THEN 1 ELSE 0 END), 0) * 100, 1) AS stuck_completion_rate,
           ROUND(CAST(SUM(CASE WHEN got_stuck = 0 AND outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(SUM(CASE WHEN got_stuck = 0 THEN 1 ELSE 0 END), 0) * 100, 1) AS normal_completion_rate
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')`,
      [days],
      scope,
    );
    const rows = sql.exec(q, ...params).toArray();

    if (rows.length === 0)
      return {
        total_sessions: 0,
        stuck_sessions: 0,
        stuckness_rate: 0,
        stuck_completion_rate: 0,
        normal_completion_rate: 0,
      };

    const r = row(rows[0]);
    return {
      total_sessions: r.number('total_sessions'),
      stuck_sessions: r.number('stuck_sessions'),
      stuckness_rate: r.number('stuckness_rate'),
      stuck_completion_rate: r.number('stuck_completion_rate'),
      normal_completion_rate: r.number('normal_completion_rate'),
    };
  } catch (err) {
    log.warn(`stuckness query failed: ${err}`);
    return {
      total_sessions: 0,
      stuck_sessions: 0,
      stuckness_rate: 0,
      stuck_completion_rate: 0,
      normal_completion_rate: 0,
    };
  }
}

export function queryFileOverlap(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): FileOverlapStats {
  try {
    const { sql: inner, params } = withScope(
      `           SELECT file_path, COUNT(DISTINCT handle) AS agents
           FROM edits
           WHERE created_at > datetime('now', '-' || ? || ' days')`,
      [days],
      scope,
    );
    const rows = sql
      .exec(
        `SELECT
           COUNT(*) AS total_files,
           SUM(CASE WHEN agents >= 2 THEN 1 ELSE 0 END) AS overlapping_files
         FROM (
${inner}
           GROUP BY file_path
         )`,
        ...params,
      )
      .toArray();

    if (rows.length === 0) return { total_files: 0, overlapping_files: 0 };

    const r = row(rows[0]);
    return {
      total_files: r.number('total_files'),
      overlapping_files: r.number('overlapping_files'),
    };
  } catch (err) {
    log.warn(`fileOverlap query failed: ${err}`);
    return { total_files: 0, overlapping_files: 0 };
  }
}

export function queryFirstEditStats(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): FirstEditStats {
  const empty: FirstEditStats = {
    avg_minutes_to_first_edit: 0,
    median_minutes_to_first_edit: 0,
    by_tool: [],
  };
  try {
    const f = buildScopeFilter(scope);
    // Overall stats
    const { sql: overallQ, params: overallParams } = withScope(
      `SELECT
           ROUND(AVG(
             (julianday(first_edit_at) - julianday(started_at)) * 24 * 60
           ), 1) AS avg_min
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND first_edit_at IS NOT NULL`,
      [days],
      scope,
    );
    const overall = sql.exec(overallQ, ...overallParams).toArray();

    // Median via LIMIT/OFFSET - O(n log n) in SQLite, O(1) memory in JS
    const medianRow = sql
      .exec(
        `SELECT ROUND(mins, 1) AS mins FROM (
           SELECT (julianday(first_edit_at) - julianday(started_at)) * 24 * 60 AS mins
           FROM sessions
           WHERE started_at > datetime('now', '-' || ? || ' days')
             AND first_edit_at IS NOT NULL${f.sql}
           ORDER BY mins
           LIMIT 1
           OFFSET (SELECT COUNT(*) / 2 FROM sessions
                   WHERE started_at > datetime('now', '-' || ? || ' days')
                     AND first_edit_at IS NOT NULL${f.sql})
         )`,
        days,
        ...f.params,
        days,
        ...f.params,
      )
      .toArray();

    const median = medianRow.length > 0 ? row(medianRow[0]).number('mins') : 0;

    // By tool
    const { sql: toolQ, params: toolParams } = withScope(
      `SELECT
           host_tool,
           ROUND(AVG(
             (julianday(first_edit_at) - julianday(started_at)) * 24 * 60
           ), 1) AS avg_minutes,
           COUNT(*) AS sessions
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND first_edit_at IS NOT NULL
           AND host_tool IS NOT NULL AND host_tool != 'unknown'`,
      [days],
      scope,
    );
    const toolRows = sql
      .exec(
        `${toolQ}
         GROUP BY host_tool
         ORDER BY sessions DESC`,
        ...toolParams,
      )
      .toArray();

    const avgMin = overall.length > 0 ? row(overall[0]).number('avg_min') : 0;

    return {
      avg_minutes_to_first_edit: avgMin,
      median_minutes_to_first_edit: median,
      by_tool: mapRows(toolRows, (r) => ({
        host_tool: r.string('host_tool'),
        avg_minutes: r.number('avg_minutes'),
        sessions: r.number('sessions'),
      })),
    };
  } catch (err) {
    log.warn(`firstEditStats query failed: ${err}`);
    return empty;
  }
}

export function queryScopeComplexity(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): ScopeComplexityBucket[] {
  try {
    const { sql: inner, params } = withScope(
      `           SELECT *, json_array_length(files_touched) AS file_count
           FROM sessions
           WHERE started_at > datetime('now', '-' || ? || ' days')
             AND files_touched != '[]'`,
      [days],
      scope,
    );
    const rows = sql
      .exec(
        `SELECT
           CASE
             WHEN file_count = 1 THEN '1 file'
             WHEN file_count <= 3 THEN '2-3 files'
             WHEN file_count <= 7 THEN '4-7 files'
             WHEN file_count <= 15 THEN '8-15 files'
             ELSE '16+ files'
           END AS bucket,
           COUNT(*) AS sessions,
           ROUND(AVG(edit_count), 1) AS avg_edits,
           ROUND(AVG(
             ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60)
           ), 1) AS avg_duration_min,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate
         FROM (
${inner}
         )
         GROUP BY bucket
         ORDER BY
           CASE bucket
             WHEN '1 file' THEN 1
             WHEN '2-3 files' THEN 2
             WHEN '4-7 files' THEN 3
             WHEN '8-15 files' THEN 4
             ELSE 5
           END`,
        ...params,
      )
      .toArray();

    return mapRows(rows, (r) => ({
      bucket: r.string('bucket'),
      sessions: r.number('sessions'),
      avg_edits: r.number('avg_edits'),
      avg_duration_min: r.number('avg_duration_min'),
      completion_rate: r.number('completion_rate'),
    }));
  } catch (err) {
    log.warn(`scopeComplexity query failed: ${err}`);
    return [];
  }
}
