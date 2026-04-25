// Outcome analytics: model performance, tool outcomes, work type classification.

import { createLogger } from '../../../lib/logger.js';
import { row, rows } from '../../../lib/row.js';
import type {
  ModelOutcome,
  ToolOutcome,
  CompletionSummary,
  ToolComparison,
  WorkTypeDistribution,
  ToolWorkTypeBreakdown,
  WorkTypeOutcome,
} from '@chinmeister/shared/contracts/analytics.js';
import { type AnalyticsScope, withScope } from './scope.js';
// The JS classifier and the canonical WORK_TYPES list live in shared so
// the web package, demo fixtures, and the worker all agree on the same
// enum. The SQL CASE below must stay in lockstep with that JS classifier
// — any rule change goes in both places, and work-type.test.js pins
// behavior for a canonical set of paths.
export { classifyWorkType, WORK_TYPES } from '@chinmeister/shared/analytics/work-type.js';
export type { WorkType } from '@chinmeister/shared/analytics/work-type.js';

const log = createLogger('TeamDO.analytics');

// SQL CASE expression for classifying file paths into work types. Must
// stay semantically equivalent to classifyWorkType() in @chinmeister/shared.
// Test patterns go first (most specific), then docs/styling/frontend/backend/config, else other.
export const WORK_TYPE_CASE = `
  CASE
    WHEN file_path LIKE '%.test.%' OR file_path LIKE '%.spec.%' OR file_path LIKE '%__tests__%' THEN 'test'
    WHEN file_path LIKE '%.md' OR file_path LIKE '%/docs/%' THEN 'docs'
    WHEN file_path LIKE '%.css' OR file_path LIKE '%.scss' OR file_path LIKE '%.module.css' THEN 'styling'
    WHEN file_path LIKE '%.tsx' OR file_path LIKE '%.jsx'
      OR file_path LIKE '%/components/%' OR file_path LIKE '%/views/%'
      OR file_path LIKE '%/hooks/%' OR file_path LIKE '%/pages/%' THEN 'frontend'
    WHEN file_path LIKE '%/routes/%' OR file_path LIKE '%/dos/%'
      OR file_path LIKE '%/api/%' OR file_path LIKE '%/server/%'
      OR file_path LIKE '%/workers/%' THEN 'backend'
    WHEN file_path LIKE '%package.json' OR file_path LIKE '%tsconfig%'
      OR file_path LIKE '%wrangler%' OR file_path LIKE '%.config.%'
      OR file_path LIKE '%.eslint%' OR file_path LIKE '%.prettier%' THEN 'config'
    ELSE 'other'
  END`;

// Same classification for files from the sessions.files_touched JSON array
// where the column alias is 'value' (from json_each).
export const WORK_TYPE_CASE_VALUE = WORK_TYPE_CASE.replace(/file_path/g, 'value');

export function queryModelPerformance(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): ModelOutcome[] {
  try {
    // GROUP BY includes host_tool so the models widget can show cross-tool
    // attribution per model (Claude Code ran Sonnet for X sessions, Cursor
    // ran it for Y). Rows where host_tool is null collapse into a single
    // per-model null-tool bucket — they still count toward the model total
    // but drop out of the per-tool breakdown in the renderer.
    const { sql: q, params } = withScope(
      `SELECT agent_model,
                host_tool,
                COALESCE(outcome, 'unknown') AS outcome,
                COUNT(*) AS count,
                ROUND(AVG(
                  ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60)
                ), 1) AS avg_duration_min,
                COALESCE(SUM(edit_count), 0) AS total_edits,
                COALESCE(SUM(lines_added), 0) AS total_lines_added,
                COALESCE(SUM(lines_removed), 0) AS total_lines_removed
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND agent_model IS NOT NULL AND agent_model != ''`,
      [days],
      scope,
    );
    const rawRows = sql
      .exec(
        `${q}
         GROUP BY agent_model, host_tool, outcome
         ORDER BY count DESC`,
        ...params,
      )
      .toArray();

    return rows<ModelOutcome>(rawRows, (r) => ({
      agent_model: r.string('agent_model'),
      host_tool: r.string('host_tool') || null,
      outcome: r.string('outcome'),
      count: r.number('count'),
      avg_duration_min: r.number('avg_duration_min'),
      total_edits: r.number('total_edits'),
      total_lines_added: r.number('total_lines_added'),
      total_lines_removed: r.number('total_lines_removed'),
    }));
  } catch (err) {
    log.warn(`modelPerformance query failed: ${err}`);
    return [];
  }
}

export function queryToolOutcomes(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): ToolOutcome[] {
  try {
    const { sql: q, params } = withScope(
      `SELECT host_tool,
                COALESCE(outcome, 'unknown') AS outcome,
                COUNT(*) AS count
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND host_tool IS NOT NULL AND host_tool != 'unknown'`,
      [days],
      scope,
    );
    const rawRows = sql
      .exec(
        `${q}
         GROUP BY host_tool, outcome
         ORDER BY count DESC`,
        ...params,
      )
      .toArray();

    return rows<ToolOutcome>(rawRows, (r) => ({
      host_tool: r.string('host_tool'),
      outcome: r.string('outcome'),
      count: r.number('count'),
    }));
  } catch (err) {
    log.warn(`toolOutcomes query failed: ${err}`);
    return [];
  }
}

export function queryCompletionSummary(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): CompletionSummary {
  try {
    const { sql: currentQ, params: currentParams } = withScope(
      `SELECT
           COUNT(*) AS total_sessions,
           SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN outcome = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
           SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN outcome IS NULL THEN 1 ELSE 0 END) AS unknown
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')`,
      [days],
      scope,
    );
    const current = sql.exec(currentQ, ...currentParams).toArray();

    const c = row(current[0]);
    const total = c.number('total_sessions');
    const completed = c.number('completed');
    const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

    // Previous period for comparison
    let prevRate: number | null = null;
    try {
      const { sql: prevQ, params: prevParams } = withScope(
        `SELECT
             COUNT(*) AS total_sessions,
             SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed
           FROM sessions
           WHERE started_at > datetime('now', '-' || ? || ' days')
             AND started_at <= datetime('now', '-' || ? || ' days')`,
        [days * 2, days],
        scope,
      );
      const prev = sql.exec(prevQ, ...prevParams).toArray();
      const p = row(prev[0]);
      const pTotal = p.number('total_sessions');
      const pCompleted = p.number('completed');
      if (pTotal > 0) prevRate = Math.round((pCompleted / pTotal) * 1000) / 10;
    } catch {
      // previous period comparison is best-effort
    }

    return {
      total_sessions: total,
      completed,
      abandoned: c.number('abandoned'),
      failed: c.number('failed'),
      unknown: c.number('unknown'),
      completion_rate: completionRate,
      prev_completion_rate: prevRate,
    };
  } catch (err) {
    log.warn(`completionSummary query failed: ${err}`);
    return {
      total_sessions: 0,
      completed: 0,
      abandoned: 0,
      failed: 0,
      unknown: 0,
      completion_rate: 0,
      prev_completion_rate: null,
    };
  }
}

export function queryToolComparison(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): ToolComparison[] {
  try {
    const { sql: q, params } = withScope(
      `SELECT
           host_tool,
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
           COALESCE(SUM(
             CASE WHEN ended_at IS NOT NULL
               THEN ROUND((julianday(ended_at) - julianday(started_at)) * 24, 2)
               ELSE 0
             END
           ), 0) AS total_session_hours
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND host_tool IS NOT NULL AND host_tool != 'unknown'`,
      [days],
      scope,
    );
    const rawRows = sql
      .exec(
        `${q}
         GROUP BY host_tool
         ORDER BY sessions DESC`,
        ...params,
      )
      .toArray();

    return rows<ToolComparison>(rawRows, (r) => ({
      host_tool: r.string('host_tool'),
      sessions: r.number('sessions'),
      completed: r.number('completed'),
      abandoned: r.number('abandoned'),
      failed: r.number('failed'),
      completion_rate: r.number('completion_rate'),
      avg_duration_min: r.number('avg_duration_min'),
      total_edits: r.number('total_edits'),
      total_lines_added: r.number('total_lines_added'),
      total_lines_removed: r.number('total_lines_removed'),
      total_session_hours: r.number('total_session_hours'),
    }));
  } catch (err) {
    log.warn(`toolComparison query failed: ${err}`);
    return [];
  }
}

export function queryWorkTypeDistribution(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): WorkTypeDistribution[] {
  try {
    const { sql: q, params } = withScope(
      `SELECT
           ${WORK_TYPE_CASE} AS work_type,
           COUNT(DISTINCT session_id) AS sessions,
           COUNT(*) AS edits,
           COALESCE(SUM(lines_added), 0) AS lines_added,
           COALESCE(SUM(lines_removed), 0) AS lines_removed,
           COUNT(DISTINCT file_path) AS files
         FROM edits
         WHERE created_at > datetime('now', '-' || ? || ' days')`,
      [days],
      scope,
    );
    const rawRows = sql
      .exec(
        `${q}
         GROUP BY work_type
         ORDER BY sessions DESC`,
        ...params,
      )
      .toArray();

    return rows<WorkTypeDistribution>(rawRows, (r) => ({
      work_type: r.string('work_type'),
      sessions: r.number('sessions'),
      edits: r.number('edits'),
      lines_added: r.number('lines_added'),
      lines_removed: r.number('lines_removed'),
      files: r.number('files'),
    }));
  } catch (err) {
    log.warn(`workTypeDistribution query failed: ${err}`);
    return [];
  }
}

export function queryToolWorkType(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): ToolWorkTypeBreakdown[] {
  try {
    const { sql: q, params } = withScope(
      `SELECT
           host_tool,
           ${WORK_TYPE_CASE} AS work_type,
           COUNT(DISTINCT session_id) AS sessions,
           COUNT(*) AS edits
         FROM edits
         WHERE created_at > datetime('now', '-' || ? || ' days')
           AND host_tool IS NOT NULL AND host_tool != 'unknown'`,
      [days],
      scope,
    );
    const rawRows = sql
      .exec(
        `${q}
         GROUP BY host_tool, work_type
         ORDER BY host_tool, sessions DESC`,
        ...params,
      )
      .toArray();

    return rows<ToolWorkTypeBreakdown>(rawRows, (r) => ({
      host_tool: r.string('host_tool'),
      work_type: r.string('work_type'),
      sessions: r.number('sessions'),
      edits: r.number('edits'),
    }));
  } catch (err) {
    log.warn(`toolWorkType query failed: ${err}`);
    return [];
  }
}

export function queryWorkTypeOutcomes(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): WorkTypeOutcome[] {
  try {
    // Assign each session to its PRIMARY work type (the type with the most
    // files) to avoid double-counting sessions that touch multiple types.
    const { sql: q, params } = withScope(
      `WITH session_work_type AS (
           SELECT s.id, s.outcome,
             (SELECT ${WORK_TYPE_CASE_VALUE} AS wt
              FROM json_each(s.files_touched) f
              GROUP BY wt ORDER BY COUNT(*) DESC LIMIT 1) AS work_type
           FROM sessions s
           WHERE s.started_at > datetime('now', '-' || ? || ' days')
             AND s.files_touched != '[]'`,
      [days],
      scope,
      { handleColumn: 's.handle' },
    );
    const rawRows = sql
      .exec(
        `${q}
         )
         SELECT
           work_type,
           COUNT(*) AS sessions,
           SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN outcome = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
           SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate
         FROM session_work_type
         GROUP BY work_type
         ORDER BY sessions DESC`,
        ...params,
      )
      .toArray();

    return rows<WorkTypeOutcome>(rawRows, (r) => ({
      work_type: r.string('work_type'),
      sessions: r.number('sessions'),
      completed: r.number('completed'),
      abandoned: r.number('abandoned'),
      failed: r.number('failed'),
      completion_rate: r.number('completion_rate'),
    }));
  } catch (err) {
    log.warn(`workTypeOutcomes query failed: ${err}`);
    return [];
  }
}
