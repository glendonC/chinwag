// Analytics aggregation queries for workflow intelligence.
// All queries run on the sessions and daily_metrics tables within TeamDO.

import { createLogger } from '../../lib/logger.js';
import type {
  FileHeatmapEntry,
  DailyTrend,
  OutcomeCount,
  ToolDistribution,
  ToolOutcome,
  DailyMetricEntry,
  TeamAnalytics,
  HourlyBucket,
  ToolHourlyBucket,
  ToolDailyTrend,
  ModelOutcome,
  UserAnalytics,
  CompletionSummary,
  ToolComparison,
  WorkTypeDistribution,
  ToolWorkTypeBreakdown,
  FileChurnEntry,
  DurationBucket,
  ConcurrentEditEntry,
  MemberAnalytics,
  RetryPattern,
  ConflictCorrelation,
  EditVelocityTrend,
  MemoryUsageStats,
  WorkTypeOutcome,
  ConversationEditCorrelation,
  FileReworkEntry,
  DirectoryHeatmapEntry,
  StucknessStats,
  FileOverlapStats,
  AuditStalenessEntry,
  FirstEditStats,
  MemoryOutcomeCorrelation,
  MemoryAccessEntry,
  ScopeComplexityBucket,
  PromptEfficiencyTrend,
  HourlyEffectiveness,
  OutcomeTagCount,
  ToolHandoff,
  PeriodComparison,
  PeriodMetrics,
  TokenUsageStats,
  ToolCallStats,
  ToolCallFrequency,
  ToolCallErrorPattern,
  ToolCallTimeline,
  CommitStats,
  CommitToolBreakdown,
  DailyCommit,
  CommitOutcomeCorrelation,
  CommitEditRatioBucket,
} from '@chinwag/shared/contracts/analytics.js';
import { RESEARCH_TOOLS, EDIT_TOOLS, sqlInList } from '@chinwag/shared/tool-call-categories.js';

const log = createLogger('TeamDO.analytics');

const HEATMAP_LIMIT = 50;
const ANALYTICS_MAX_DAYS = 90;

export function getAnalytics(sql: SqlStorage, days: number): TeamAnalytics {
  const periodDays = Math.max(1, Math.min(days, ANALYTICS_MAX_DAYS));

  return {
    ok: true,
    period_days: periodDays,
    file_heatmap: queryFileHeatmap(sql, periodDays),
    daily_trends: queryDailyTrends(sql, periodDays),
    tool_distribution: queryToolDistribution(sql, periodDays),
    outcome_distribution: queryOutcomeDistribution(sql, periodDays),
    daily_metrics: queryDailyMetrics(sql, periodDays),
  };
}

function queryFileHeatmap(sql: SqlStorage, days: number): FileHeatmapEntry[] {
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

function queryDailyTrends(sql: SqlStorage, days: number): DailyTrend[] {
  try {
    const rows = sql
      .exec(
        `SELECT date(started_at) AS day,
                COUNT(*) AS sessions,
                COALESCE(SUM(edit_count), 0) AS edits,
                COALESCE(SUM(lines_added), 0) AS lines_added,
                COALESCE(SUM(lines_removed), 0) AS lines_removed,
                ROUND(AVG(
                  ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60)
                ), 1) AS avg_duration_min,
                SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN outcome = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
                SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
         GROUP BY date(started_at)
         ORDER BY day ASC`,
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

function queryToolDistribution(sql: SqlStorage, days: number): ToolDistribution[] {
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

function queryOutcomeDistribution(sql: SqlStorage, days: number): OutcomeCount[] {
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

function queryDailyMetrics(sql: SqlStorage, days: number): DailyMetricEntry[] {
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

function queryHourlyDistribution(sql: SqlStorage, days: number): HourlyBucket[] {
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

function queryToolHourly(sql: SqlStorage, days: number): ToolHourlyBucket[] {
  try {
    const rows = sql
      .exec(
        `SELECT host_tool,
                CAST(strftime('%H', started_at) AS INTEGER) AS hour,
                CAST(strftime('%w', started_at) AS INTEGER) AS dow,
                COUNT(*) AS sessions,
                COALESCE(SUM(edit_count), 0) AS edits
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND host_tool IS NOT NULL AND host_tool != 'unknown'
         GROUP BY host_tool, hour, dow
         ORDER BY host_tool, hour, dow`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        host_tool: row.host_tool as string,
        hour: (row.hour as number) || 0,
        dow: (row.dow as number) || 0,
        sessions: (row.sessions as number) || 0,
        edits: (row.edits as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`toolHourly query failed: ${err}`);
    return [];
  }
}

function queryToolDaily(sql: SqlStorage, days: number): ToolDailyTrend[] {
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

function queryModelPerformance(sql: SqlStorage, days: number): ModelOutcome[] {
  try {
    const rows = sql
      .exec(
        `SELECT agent_model,
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
           AND agent_model IS NOT NULL AND agent_model != ''
         GROUP BY agent_model, outcome
         ORDER BY count DESC`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        agent_model: row.agent_model as string,
        outcome: row.outcome as string,
        count: (row.count as number) || 0,
        avg_duration_min: (row.avg_duration_min as number) || 0,
        total_edits: (row.total_edits as number) || 0,
        total_lines_added: (row.total_lines_added as number) || 0,
        total_lines_removed: (row.total_lines_removed as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`modelPerformance query failed: ${err}`);
    return [];
  }
}

function queryToolOutcomes(sql: SqlStorage, days: number): ToolOutcome[] {
  try {
    const rows = sql
      .exec(
        `SELECT host_tool,
                COALESCE(outcome, 'unknown') AS outcome,
                COUNT(*) AS count
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND host_tool IS NOT NULL AND host_tool != 'unknown'
         GROUP BY host_tool, outcome
         ORDER BY count DESC`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        host_tool: row.host_tool as string,
        outcome: row.outcome as string,
        count: (row.count as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`toolOutcomes query failed: ${err}`);
    return [];
  }
}

// SQL CASE expression for classifying file paths into work types.
// Test patterns go first (most specific), then docs/styling/frontend/backend/config, else other.
const WORK_TYPE_CASE = `
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
const WORK_TYPE_CASE_VALUE = WORK_TYPE_CASE.replace(/file_path/g, 'value');

/** Classify a file path into a work type. JS-side mirror of the SQL CASE. */
export function classifyWorkType(filePath: string): string {
  const p = filePath.toLowerCase();
  if (p.includes('.test.') || p.includes('.spec.') || p.includes('__tests__')) return 'test';
  if (p.endsWith('.md') || p.includes('/docs/')) return 'docs';
  if (p.endsWith('.css') || p.endsWith('.scss') || p.includes('.module.css')) return 'styling';
  if (
    p.endsWith('.tsx') ||
    p.endsWith('.jsx') ||
    p.includes('/components/') ||
    p.includes('/views/') ||
    p.includes('/hooks/') ||
    p.includes('/pages/')
  )
    return 'frontend';
  if (
    p.includes('/routes/') ||
    p.includes('/dos/') ||
    p.includes('/api/') ||
    p.includes('/server/') ||
    p.includes('/workers/')
  )
    return 'backend';
  if (
    p.includes('package.json') ||
    p.includes('tsconfig') ||
    p.includes('wrangler') ||
    p.includes('.config.') ||
    p.includes('.eslint') ||
    p.includes('.prettier')
  )
    return 'config';
  return 'other';
}

function queryCompletionSummary(sql: SqlStorage, days: number): CompletionSummary {
  try {
    const current = sql
      .exec(
        `SELECT
           COUNT(*) AS total_sessions,
           SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN outcome = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
           SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN outcome IS NULL THEN 1 ELSE 0 END) AS unknown
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')`,
        days,
      )
      .toArray();

    const c = (current[0] || {}) as Record<string, unknown>;
    const total = (c.total_sessions as number) || 0;
    const completed = (c.completed as number) || 0;
    const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

    // Previous period for comparison
    let prevRate: number | null = null;
    try {
      const prev = sql
        .exec(
          `SELECT
             COUNT(*) AS total_sessions,
             SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed
           FROM sessions
           WHERE started_at > datetime('now', '-' || ? || ' days')
             AND started_at <= datetime('now', '-' || ? || ' days')`,
          days * 2,
          days,
        )
        .toArray();
      const p = (prev[0] || {}) as Record<string, unknown>;
      const pTotal = (p.total_sessions as number) || 0;
      const pCompleted = (p.completed as number) || 0;
      if (pTotal > 0) prevRate = Math.round((pCompleted / pTotal) * 1000) / 10;
    } catch {
      // previous period comparison is best-effort
    }

    return {
      total_sessions: total,
      completed,
      abandoned: (c.abandoned as number) || 0,
      failed: (c.failed as number) || 0,
      unknown: (c.unknown as number) || 0,
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

function queryToolComparison(sql: SqlStorage, days: number): ToolComparison[] {
  try {
    const rows = sql
      .exec(
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
           COALESCE(SUM(lines_removed), 0) AS total_lines_removed
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
        completed: (row.completed as number) || 0,
        abandoned: (row.abandoned as number) || 0,
        failed: (row.failed as number) || 0,
        completion_rate: (row.completion_rate as number) || 0,
        avg_duration_min: (row.avg_duration_min as number) || 0,
        total_edits: (row.total_edits as number) || 0,
        total_lines_added: (row.total_lines_added as number) || 0,
        total_lines_removed: (row.total_lines_removed as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`toolComparison query failed: ${err}`);
    return [];
  }
}

function queryWorkTypeDistribution(sql: SqlStorage, days: number): WorkTypeDistribution[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           ${WORK_TYPE_CASE} AS work_type,
           COUNT(DISTINCT session_id) AS sessions,
           COUNT(*) AS edits,
           COALESCE(SUM(lines_added), 0) AS lines_added,
           COALESCE(SUM(lines_removed), 0) AS lines_removed,
           COUNT(DISTINCT file_path) AS files
         FROM edits
         WHERE created_at > datetime('now', '-' || ? || ' days')
         GROUP BY work_type
         ORDER BY sessions DESC`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        work_type: row.work_type as string,
        sessions: (row.sessions as number) || 0,
        edits: (row.edits as number) || 0,
        lines_added: (row.lines_added as number) || 0,
        lines_removed: (row.lines_removed as number) || 0,
        files: (row.files as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`workTypeDistribution query failed: ${err}`);
    return [];
  }
}

function queryToolWorkType(sql: SqlStorage, days: number): ToolWorkTypeBreakdown[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           host_tool,
           ${WORK_TYPE_CASE} AS work_type,
           COUNT(DISTINCT session_id) AS sessions,
           COUNT(*) AS edits
         FROM edits
         WHERE created_at > datetime('now', '-' || ? || ' days')
           AND host_tool IS NOT NULL AND host_tool != 'unknown'
         GROUP BY host_tool, work_type
         ORDER BY host_tool, sessions DESC`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        host_tool: row.host_tool as string,
        work_type: row.work_type as string,
        sessions: (row.sessions as number) || 0,
        edits: (row.edits as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`toolWorkType query failed: ${err}`);
    return [];
  }
}

function queryFileChurn(sql: SqlStorage, days: number): FileChurnEntry[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           file_path AS file,
           COUNT(DISTINCT session_id) AS session_count,
           COUNT(*) AS total_edits,
           COALESCE(SUM(lines_added + lines_removed), 0) AS total_lines
         FROM edits
         WHERE created_at > datetime('now', '-' || ? || ' days')
         GROUP BY file_path
         HAVING session_count >= 2
         ORDER BY session_count DESC
         LIMIT 30`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        file: row.file as string,
        session_count: (row.session_count as number) || 0,
        total_edits: (row.total_edits as number) || 0,
        total_lines: (row.total_lines as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`fileChurn query failed: ${err}`);
    return [];
  }
}

function queryDurationDistribution(sql: SqlStorage, days: number): DurationBucket[] {
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

function queryConcurrentEdits(sql: SqlStorage, days: number): ConcurrentEditEntry[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           file_path AS file,
           COUNT(DISTINCT handle) AS agents,
           COUNT(*) AS edit_count
         FROM edits
         WHERE created_at > datetime('now', '-' || ? || ' days')
         GROUP BY file_path
         HAVING agents >= 2
         ORDER BY agents DESC, edit_count DESC
         LIMIT 20`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        file: row.file as string,
        agents: (row.agents as number) || 0,
        edit_count: (row.edit_count as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`concurrentEdits query failed: ${err}`);
    return [];
  }
}

function queryMemberAnalytics(sql: SqlStorage, days: number): MemberAnalytics[] {
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
           COALESCE(SUM(commit_count), 0) AS total_commits
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
      };
    });
  } catch (err) {
    log.warn(`memberAnalytics query failed: ${err}`);
    return [];
  }
}

function queryRetryPatterns(sql: SqlStorage, days: number): RetryPattern[] {
  try {
    // Find files that were touched by the same handle across multiple sessions,
    // where at least one prior session was abandoned or failed.
    // This indicates retry/rework patterns.
    const rows = sql
      .exec(
        `SELECT
           s.handle,
           f.value AS file,
           COUNT(DISTINCT s.id) AS attempts,
           (SELECT outcome FROM sessions s2, json_each(s2.files_touched) f2
            WHERE s2.handle = s.handle AND f2.value = f.value
              AND s2.started_at > datetime('now', '-' || ? || ' days')
            ORDER BY s2.started_at DESC LIMIT 1) AS final_outcome
         FROM sessions s, json_each(s.files_touched) f
         WHERE s.started_at > datetime('now', '-' || ? || ' days')
           AND s.files_touched != '[]'
           AND EXISTS (
             SELECT 1 FROM sessions s3, json_each(s3.files_touched) f3
             WHERE s3.handle = s.handle AND f3.value = f.value
               AND s3.id != s.id
               AND s3.outcome IN ('abandoned', 'failed')
               AND s3.started_at > datetime('now', '-' || ? || ' days')
           )
         GROUP BY s.handle, f.value
         HAVING attempts >= 2
         ORDER BY attempts DESC
         LIMIT 30`,
        days,
        days,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      const finalOutcome = (row.final_outcome as string) || null;
      return {
        handle: row.handle as string,
        file: row.file as string,
        attempts: (row.attempts as number) || 0,
        final_outcome: finalOutcome,
        resolved: finalOutcome === 'completed',
      };
    });
  } catch (err) {
    log.warn(`retryPatterns query failed: ${err}`);
    return [];
  }
}

function queryConflictCorrelation(sql: SqlStorage, days: number): ConflictCorrelation[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           CASE WHEN conflicts_hit > 0 THEN '1+ conflicts' ELSE 'no conflicts' END AS bucket,
           COUNT(*) AS sessions,
           SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
         GROUP BY bucket
         ORDER BY bucket`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        bucket: row.bucket as string,
        sessions: (row.sessions as number) || 0,
        completed: (row.completed as number) || 0,
        completion_rate: (row.completion_rate as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`conflictCorrelation query failed: ${err}`);
    return [];
  }
}

function queryEditVelocity(sql: SqlStorage, days: number): EditVelocityTrend[] {
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

function queryMemoryUsage(sql: SqlStorage, days: number): MemoryUsageStats {
  try {
    // Total memories
    const totalRow = sql.exec('SELECT COUNT(*) AS cnt FROM memories').one() as Record<
      string,
      unknown
    >;
    const total = (totalRow?.cnt as number) || 0;

    // Memories created/updated in period
    const periodRow = sql
      .exec(
        `SELECT
           SUM(CASE WHEN created_at > datetime('now', '-' || ? || ' days') THEN 1 ELSE 0 END) AS created,
           SUM(CASE WHEN updated_at > datetime('now', '-' || ? || ' days')
                      AND updated_at != created_at THEN 1 ELSE 0 END) AS updated
         FROM memories`,
        days,
        days,
      )
      .one() as Record<string, unknown>;

    // Stale memories (not accessed in 30+ days)
    const staleRow = sql
      .exec(
        `SELECT COUNT(*) AS cnt FROM memories
         WHERE (last_accessed_at IS NULL AND created_at < datetime('now', '-30 days'))
            OR (last_accessed_at IS NOT NULL AND last_accessed_at < datetime('now', '-30 days'))`,
      )
      .one() as Record<string, unknown>;

    // Average memory age
    const ageRow = sql
      .exec(
        "SELECT ROUND(AVG(julianday('now') - julianday(created_at)), 1) AS avg_age FROM memories",
      )
      .one() as Record<string, unknown>;

    // Search telemetry from daily_metrics (period-scoped, not lifetime)
    const searchRow = sql
      .exec(
        `SELECT COALESCE(SUM(CASE WHEN metric = 'memories_searched' THEN count ELSE 0 END), 0) AS searches,
                COALESCE(SUM(CASE WHEN metric = 'memories_search_hits' THEN count ELSE 0 END), 0) AS hits
         FROM daily_metrics
         WHERE date > date('now', '-' || ? || ' days')
           AND metric IN ('memories_searched', 'memories_search_hits')`,
        days,
      )
      .one() as Record<string, unknown>;

    const searches = (searchRow?.searches as number) || 0;
    const hits = (searchRow?.hits as number) || 0;

    return {
      total_memories: total,
      searches,
      searches_with_results: hits,
      search_hit_rate: searches > 0 ? Math.round((hits / searches) * 1000) / 10 : 0,
      memories_created_period: (periodRow?.created as number) || 0,
      memories_updated_period: (periodRow?.updated as number) || 0,
      stale_memories: (staleRow?.cnt as number) || 0,
      avg_memory_age_days: (ageRow?.avg_age as number) || 0,
    };
  } catch (err) {
    log.warn(`memoryUsage query failed: ${err}`);
    return {
      total_memories: 0,
      searches: 0,
      searches_with_results: 0,
      search_hit_rate: 0,
      memories_created_period: 0,
      memories_updated_period: 0,
      stale_memories: 0,
      avg_memory_age_days: 0,
    };
  }
}

function queryFileHeatmapEnhanced(sql: SqlStorage, days: number): FileHeatmapEntry[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           value AS file,
           COUNT(*) AS touch_count,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS outcome_rate,
           COALESCE(SUM(lines_added), 0) AS total_lines_added,
           COALESCE(SUM(lines_removed), 0) AS total_lines_removed
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
        work_type: classifyWorkType(row.file as string),
        outcome_rate: (row.outcome_rate as number) || 0,
        total_lines_added: (row.total_lines_added as number) || 0,
        total_lines_removed: (row.total_lines_removed as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`fileHeatmapEnhanced query failed: ${err}`);
    return [];
  }
}

// ── Extended analytics queries (phase 2) ─────────

function queryWorkTypeOutcomes(sql: SqlStorage, days: number): WorkTypeOutcome[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           ${WORK_TYPE_CASE_VALUE} AS work_type,
           COUNT(DISTINCT s.id) AS sessions,
           SUM(CASE WHEN s.outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN s.outcome = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
           SUM(CASE WHEN s.outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
           ROUND(CAST(SUM(CASE WHEN s.outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(DISTINCT s.id), 0) * 100, 1) AS completion_rate
         FROM sessions s, json_each(s.files_touched) f
         WHERE s.started_at > datetime('now', '-' || ? || ' days')
           AND s.files_touched != '[]'
         GROUP BY work_type
         ORDER BY sessions DESC`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        work_type: row.work_type as string,
        sessions: (row.sessions as number) || 0,
        completed: (row.completed as number) || 0,
        abandoned: (row.abandoned as number) || 0,
        failed: (row.failed as number) || 0,
        completion_rate: (row.completion_rate as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`workTypeOutcomes query failed: ${err}`);
    return [];
  }
}

function queryConversationEditCorrelation(
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
           CASE
             WHEN t.user_turns <= 5 THEN '1-5 turns'
             WHEN t.user_turns <= 15 THEN '6-15 turns'
             WHEN t.user_turns <= 30 THEN '16-30 turns'
             ELSE '30+ turns'
           END AS bucket,
           COUNT(*) AS sessions,
           ROUND(AVG(s.edit_count), 1) AS avg_edits,
           ROUND(AVG(s.lines_added + s.lines_removed), 1) AS avg_lines,
           ROUND(CAST(SUM(CASE WHEN s.outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate
         FROM session_turns t
         JOIN sessions s ON s.id = t.session_id
         GROUP BY bucket
         ORDER BY
           CASE bucket
             WHEN '1-5 turns' THEN 1
             WHEN '6-15 turns' THEN 2
             WHEN '16-30 turns' THEN 3
             ELSE 4
           END`,
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

function queryFileRework(sql: SqlStorage, days: number): FileReworkEntry[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           e.file_path AS file,
           COUNT(*) AS total_edits,
           SUM(CASE WHEN s.outcome IN ('abandoned', 'failed') THEN 1 ELSE 0 END) AS failed_edits,
           ROUND(CAST(SUM(CASE WHEN s.outcome IN ('abandoned', 'failed') THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS rework_ratio
         FROM edits e
         JOIN sessions s ON s.id = e.session_id
         WHERE e.created_at > datetime('now', '-' || ? || ' days')
         GROUP BY e.file_path
         HAVING total_edits >= 3 AND failed_edits >= 1
         ORDER BY rework_ratio DESC
         LIMIT 30`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        file: row.file as string,
        total_edits: (row.total_edits as number) || 0,
        failed_edits: (row.failed_edits as number) || 0,
        rework_ratio: (row.rework_ratio as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`fileRework query failed: ${err}`);
    return [];
  }
}

/** Extract directory from a file path (up to 3 segments deep). */
function extractDirectory(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  // Keep up to 3 directory segments for meaningful grouping
  const dirParts = parts.slice(0, Math.min(parts.length - 1, 3));
  return dirParts.length > 0 ? dirParts.join('/') : '.';
}

function queryDirectoryHeatmap(sql: SqlStorage, days: number): DirectoryHeatmapEntry[] {
  try {
    // Query file-level data and roll up to directories in JS
    // (SQLite lacks a clean dirname function)
    const rows = sql
      .exec(
        `SELECT
           value AS file,
           COUNT(*) AS touch_count,
           COALESCE(SUM(lines_added + lines_removed), 0) AS total_lines,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate
         FROM sessions, json_each(sessions.files_touched)
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND files_touched != '[]'
         GROUP BY value`,
        days,
      )
      .toArray();

    const dirMap = new Map<
      string,
      {
        touch_count: number;
        file_count: number;
        total_lines: number;
        completed_sum: number;
        total_sum: number;
      }
    >();

    for (const r of rows) {
      const row = r as Record<string, unknown>;
      const dir = extractDirectory(row.file as string);
      const existing = dirMap.get(dir) || {
        touch_count: 0,
        file_count: 0,
        total_lines: 0,
        completed_sum: 0,
        total_sum: 0,
      };
      const touches = (row.touch_count as number) || 0;
      existing.touch_count += touches;
      existing.file_count += 1;
      existing.total_lines += (row.total_lines as number) || 0;
      existing.completed_sum += ((row.completion_rate as number) || 0) * touches;
      existing.total_sum += touches;
      dirMap.set(dir, existing);
    }

    return [...dirMap.entries()]
      .map(([directory, v]) => ({
        directory,
        touch_count: v.touch_count,
        file_count: v.file_count,
        total_lines: v.total_lines,
        completion_rate:
          v.total_sum > 0 ? Math.round((v.completed_sum / v.total_sum) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.touch_count - a.touch_count)
      .slice(0, 30);
  } catch (err) {
    log.warn(`directoryHeatmap query failed: ${err}`);
    return [];
  }
}

function queryStuckness(sql: SqlStorage, days: number): StucknessStats {
  try {
    const rows = sql
      .exec(
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
        days,
      )
      .toArray();

    if (rows.length === 0)
      return {
        total_sessions: 0,
        stuck_sessions: 0,
        stuckness_rate: 0,
        stuck_completion_rate: 0,
        normal_completion_rate: 0,
      };

    const row = rows[0] as Record<string, unknown>;
    return {
      total_sessions: (row.total_sessions as number) || 0,
      stuck_sessions: (row.stuck_sessions as number) || 0,
      stuckness_rate: (row.stuckness_rate as number) || 0,
      stuck_completion_rate: (row.stuck_completion_rate as number) || 0,
      normal_completion_rate: (row.normal_completion_rate as number) || 0,
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

function queryFileOverlap(sql: SqlStorage, days: number): FileOverlapStats {
  try {
    const rows = sql
      .exec(
        `SELECT
           COUNT(*) AS total_files,
           SUM(CASE WHEN agents >= 2 THEN 1 ELSE 0 END) AS overlapping_files
         FROM (
           SELECT file_path, COUNT(DISTINCT handle) AS agents
           FROM edits
           WHERE created_at > datetime('now', '-' || ? || ' days')
           GROUP BY file_path
         )`,
        days,
      )
      .toArray();

    if (rows.length === 0) return { total_files: 0, overlapping_files: 0, overlap_rate: 0 };

    const row = rows[0] as Record<string, unknown>;
    const total = (row.total_files as number) || 0;
    const overlapping = (row.overlapping_files as number) || 0;
    return {
      total_files: total,
      overlapping_files: overlapping,
      overlap_rate: total > 0 ? Math.round((overlapping / total) * 1000) / 10 : 0,
    };
  } catch (err) {
    log.warn(`fileOverlap query failed: ${err}`);
    return { total_files: 0, overlapping_files: 0, overlap_rate: 0 };
  }
}

function queryAuditStaleness(sql: SqlStorage, days: number): AuditStalenessEntry[] {
  try {
    // Find directories with significant past activity that haven't been touched recently
    const rows = sql
      .exec(
        `SELECT
           file_path,
           MAX(created_at) AS last_edit,
           COUNT(*) AS edit_count
         FROM edits
         WHERE created_at > datetime('now', '-' || ? || ' days')
         GROUP BY file_path
         HAVING edit_count >= 3`,
        days,
      )
      .toArray();

    // Roll up to directory level and filter for stale ones
    const dirMap = new Map<string, { last_edit: string; edit_count: number }>();

    for (const r of rows) {
      const row = r as Record<string, unknown>;
      const dir = extractDirectory(row.file_path as string);
      const existing = dirMap.get(dir);
      const lastEdit = row.last_edit as string;
      const editCount = (row.edit_count as number) || 0;

      if (!existing || lastEdit > existing.last_edit) {
        dirMap.set(dir, {
          last_edit: lastEdit,
          edit_count: (existing?.edit_count || 0) + editCount,
        });
      } else {
        existing.edit_count += editCount;
      }
    }

    const now = Date.now();
    return [...dirMap.entries()]
      .map(([directory, v]) => {
        const daysSince = Math.round((now - new Date(v.last_edit + 'Z').getTime()) / 86400000);
        return {
          directory,
          last_edit: v.last_edit,
          days_since: daysSince,
          prior_edit_count: v.edit_count,
        };
      })
      .filter((e) => e.days_since >= 14 && e.prior_edit_count >= 5)
      .sort((a, b) => b.days_since - a.days_since)
      .slice(0, 20);
  } catch (err) {
    log.warn(`auditStaleness query failed: ${err}`);
    return [];
  }
}

function queryFirstEditStats(sql: SqlStorage, days: number): FirstEditStats {
  const empty: FirstEditStats = {
    avg_minutes_to_first_edit: 0,
    median_minutes_to_first_edit: 0,
    by_tool: [],
  };
  try {
    // Overall stats
    const overall = sql
      .exec(
        `SELECT
           ROUND(AVG(
             (julianday(first_edit_at) - julianday(started_at)) * 24 * 60
           ), 1) AS avg_min
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND first_edit_at IS NOT NULL`,
        days,
      )
      .toArray();

    // Median via sorted middle value
    const medianRows = sql
      .exec(
        `SELECT ROUND((julianday(first_edit_at) - julianday(started_at)) * 24 * 60, 1) AS mins
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND first_edit_at IS NOT NULL
         ORDER BY mins`,
        days,
      )
      .toArray();

    let median = 0;
    if (medianRows.length > 0) {
      const midIdx = Math.floor(medianRows.length / 2);
      median = ((medianRows[midIdx] as Record<string, unknown>).mins as number) || 0;
    }

    // By tool
    const toolRows = sql
      .exec(
        `SELECT
           host_tool,
           ROUND(AVG(
             (julianday(first_edit_at) - julianday(started_at)) * 24 * 60
           ), 1) AS avg_minutes,
           COUNT(*) AS sessions
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND first_edit_at IS NOT NULL
           AND host_tool IS NOT NULL AND host_tool != 'unknown'
         GROUP BY host_tool
         ORDER BY sessions DESC`,
        days,
      )
      .toArray();

    const avgMin = ((overall[0] as Record<string, unknown>)?.avg_min as number) || 0;

    return {
      avg_minutes_to_first_edit: avgMin,
      median_minutes_to_first_edit: median,
      by_tool: toolRows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          host_tool: row.host_tool as string,
          avg_minutes: (row.avg_minutes as number) || 0,
          sessions: (row.sessions as number) || 0,
        };
      }),
    };
  } catch (err) {
    log.warn(`firstEditStats query failed: ${err}`);
    return empty;
  }
}

function queryMemoryOutcomeCorrelation(sql: SqlStorage, days: number): MemoryOutcomeCorrelation[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           CASE WHEN memories_searched > 0 THEN 'used memory' ELSE 'no memory' END AS bucket,
           COUNT(*) AS sessions,
           SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
         GROUP BY bucket
         ORDER BY bucket`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        bucket: row.bucket as string,
        sessions: (row.sessions as number) || 0,
        completed: (row.completed as number) || 0,
        completion_rate: (row.completion_rate as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`memoryOutcomeCorrelation query failed: ${err}`);
    return [];
  }
}

function queryTopMemories(sql: SqlStorage, days: number): MemoryAccessEntry[] {
  try {
    const rows = sql
      .exec(
        `SELECT id, text, access_count, last_accessed_at, created_at
         FROM memories
         WHERE access_count > 0
           AND (last_accessed_at IS NOT NULL AND last_accessed_at > datetime('now', '-' || ? || ' days'))
         ORDER BY access_count DESC
         LIMIT 20`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      const text = row.text as string;
      return {
        id: row.id as string,
        text_preview: text.length > 120 ? text.slice(0, 120) + '...' : text,
        access_count: (row.access_count as number) || 0,
        last_accessed_at: (row.last_accessed_at as string) || null,
        created_at: row.created_at as string,
      };
    });
  } catch (err) {
    log.warn(`topMemories query failed: ${err}`);
    return [];
  }
}

// ── Phase 3 analytics queries ─────────────────────

function queryScopeComplexity(sql: SqlStorage, days: number): ScopeComplexityBucket[] {
  try {
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
           SELECT *, json_array_length(files_touched) AS file_count
           FROM sessions
           WHERE started_at > datetime('now', '-' || ? || ' days')
             AND files_touched != '[]'
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
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        bucket: row.bucket as string,
        sessions: (row.sessions as number) || 0,
        avg_edits: (row.avg_edits as number) || 0,
        avg_duration_min: (row.avg_duration_min as number) || 0,
        completion_rate: (row.completion_rate as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`scopeComplexity query failed: ${err}`);
    return [];
  }
}

function queryPromptEfficiency(sql: SqlStorage, days: number): PromptEfficiencyTrend[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           date(ce.created_at) AS day,
           ROUND(
             CAST(SUM(CASE WHEN ce.role = 'user' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(AVG(s.edit_count), 0),
           1) AS avg_turns_per_edit,
           COUNT(DISTINCT s.id) AS sessions
         FROM conversation_events ce
         JOIN sessions s ON s.id = ce.session_id
         WHERE ce.created_at > datetime('now', '-' || ? || ' days')
           AND s.edit_count > 0
         GROUP BY date(ce.created_at)
         ORDER BY day ASC`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        day: row.day as string,
        avg_turns_per_edit: (row.avg_turns_per_edit as number) || 0,
        sessions: (row.sessions as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`promptEfficiency query failed: ${err}`);
    return [];
  }
}

function queryHourlyEffectiveness(sql: SqlStorage, days: number): HourlyEffectiveness[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           CAST(strftime('%H', started_at) AS INTEGER) AS hour,
           COUNT(*) AS sessions,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate,
           ROUND(AVG(edit_count), 1) AS avg_edits
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
         GROUP BY hour
         ORDER BY hour`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        hour: (row.hour as number) || 0,
        sessions: (row.sessions as number) || 0,
        completion_rate: (row.completion_rate as number) || 0,
        avg_edits: (row.avg_edits as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`hourlyEffectiveness query failed: ${err}`);
    return [];
  }
}

function queryOutcomeTags(sql: SqlStorage, days: number): OutcomeTagCount[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           value AS tag,
           COALESCE(outcome, 'unknown') AS outcome,
           COUNT(*) AS count
         FROM sessions, json_each(sessions.outcome_tags)
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND outcome_tags != '[]'
         GROUP BY tag, outcome
         ORDER BY count DESC
         LIMIT 30`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        tag: row.tag as string,
        outcome: row.outcome as string,
        count: (row.count as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`outcomeTags query failed: ${err}`);
    return [];
  }
}

function queryToolHandoffs(sql: SqlStorage, days: number): ToolHandoff[] {
  try {
    // Find files touched by different tools within 24h windows
    const rows = sql
      .exec(
        `SELECT
           a.host_tool AS from_tool,
           b.host_tool AS to_tool,
           COUNT(DISTINCT a.file_path) AS file_count,
           ROUND(CAST(SUM(CASE WHEN s.outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(DISTINCT s.id), 0) * 100, 1) AS handoff_completion_rate
         FROM edits a
         JOIN edits b ON a.file_path = b.file_path
           AND b.created_at > a.created_at
           AND b.created_at < datetime(a.created_at, '+1 day')
           AND a.host_tool != b.host_tool
         JOIN sessions s ON s.id = b.session_id
         WHERE a.created_at > datetime('now', '-' || ? || ' days')
         GROUP BY from_tool, to_tool
         HAVING file_count >= 2
         ORDER BY file_count DESC
         LIMIT 10`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        from_tool: row.from_tool as string,
        to_tool: row.to_tool as string,
        file_count: (row.file_count as number) || 0,
        handoff_completion_rate: (row.handoff_completion_rate as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`toolHandoffs query failed: ${err}`);
    return [];
  }
}

// ── Period-over-period comparison ────────────────────
// Computes current and previous period snapshots for core metrics.
// Previous period is capped to session retention (30 days) to avoid
// silently returning empty data for longer ranges.

const SESSION_RETENTION_DAYS = 30;

function queryPeriodComparison(sql: SqlStorage, days: number): PeriodComparison {
  const effectiveDays = Math.min(days, SESSION_RETENTION_DAYS);

  function queryPeriodMetrics(offsetStart: number, offsetEnd: number): PeriodMetrics | null {
    try {
      const rows = sql
        .exec(
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
          offsetStart,
          offsetEnd,
        )
        .toArray();

      const r = (rows[0] || {}) as Record<string, unknown>;
      const total = (r.total_sessions as number) || 0;
      if (total === 0) return null;

      const completed = (r.completed as number) || 0;
      const totalHours = (r.total_session_hours as number) || 0;
      const totalEdits = (r.total_edits as number) || 0;
      const stuck = (r.stuck_sessions as number) || 0;

      // Memory hit rate from daily_metrics (period-scoped)
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
    },
    previous,
  };
}

// ── Token usage analytics ───────────────────────────

function queryTokenUsage(sql: SqlStorage, days: number): TokenUsageStats {
  // Cost enrichment happens outside this function (dos/team/pricing-enrich.ts)
  // so queryTokenUsage stays pure SQL: raw token sums per model / per tool,
  // no resolver, no cost math, no DO RPC. estimated_cost_usd is left at its
  // default (null) and filled in by enrichAnalyticsWithPricing before the
  // response leaves the DO.
  const empty: TokenUsageStats = {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cache_read_tokens: 0,
    total_cache_creation_tokens: 0,
    avg_input_per_session: 0,
    avg_output_per_session: 0,
    sessions_with_token_data: 0,
    sessions_without_token_data: 0,
    total_estimated_cost_usd: 0,
    pricing_refreshed_at: null,
    pricing_is_stale: false,
    models_without_pricing: [],
    models_without_pricing_total: 0,
    by_model: [],
    by_tool: [],
  };

  try {
    // Totals — only count sessions that have token data (non-NULL input_tokens
    // is the presence signal; cache fields may still be NULL on sessions
    // uploaded before phase 2 even if input/output were captured).
    const totals = sql
      .exec(
        `SELECT
           COALESCE(SUM(input_tokens), 0) AS total_input,
           COALESCE(SUM(output_tokens), 0) AS total_output,
           COALESCE(SUM(cache_read_tokens), 0) AS total_cache_read,
           COALESCE(SUM(cache_creation_tokens), 0) AS total_cache_creation,
           COUNT(CASE WHEN input_tokens IS NOT NULL THEN 1 END) AS with_data,
           COUNT(CASE WHEN input_tokens IS NULL THEN 1 END) AS without_data
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')`,
        days,
      )
      .toArray();

    const t = (totals[0] || {}) as Record<string, unknown>;
    const totalInput = (t.total_input as number) || 0;
    const totalOutput = (t.total_output as number) || 0;
    const totalCacheRead = (t.total_cache_read as number) || 0;
    const totalCacheCreation = (t.total_cache_creation as number) || 0;
    const withData = (t.with_data as number) || 0;
    const withoutData = (t.without_data as number) || 0;

    if (withData === 0) {
      return { ...empty, sessions_without_token_data: withoutData };
    }

    // By model
    const modelRows = sql
      .exec(
        `SELECT agent_model,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
                COUNT(*) AS sessions
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND input_tokens IS NOT NULL
           AND agent_model IS NOT NULL AND agent_model != ''
         GROUP BY agent_model
         ORDER BY input_tokens DESC`,
        days,
      )
      .toArray();

    // By tool
    const toolRows = sql
      .exec(
        `SELECT host_tool,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
                COUNT(*) AS sessions
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND input_tokens IS NOT NULL
           AND host_tool IS NOT NULL AND host_tool != 'unknown'
         GROUP BY host_tool
         ORDER BY input_tokens DESC`,
        days,
      )
      .toArray();

    const byModel = modelRows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        agent_model: row.agent_model as string,
        input_tokens: (row.input_tokens as number) || 0,
        output_tokens: (row.output_tokens as number) || 0,
        cache_read_tokens: (row.cache_read_tokens as number) || 0,
        cache_creation_tokens: (row.cache_creation_tokens as number) || 0,
        sessions: (row.sessions as number) || 0,
        // Populated by enrichAnalyticsWithPricing, not here.
        estimated_cost_usd: null,
      };
    });

    return {
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      total_cache_read_tokens: totalCacheRead,
      total_cache_creation_tokens: totalCacheCreation,
      avg_input_per_session: withData > 0 ? Math.round(totalInput / withData) : 0,
      avg_output_per_session: withData > 0 ? Math.round(totalOutput / withData) : 0,
      sessions_with_token_data: withData,
      sessions_without_token_data: withoutData,
      total_estimated_cost_usd: 0,
      pricing_refreshed_at: null,
      pricing_is_stale: false,
      models_without_pricing: [],
      models_without_pricing_total: 0,
      by_model: byModel,
      by_tool: toolRows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          host_tool: row.host_tool as string,
          input_tokens: (row.input_tokens as number) || 0,
          output_tokens: (row.output_tokens as number) || 0,
          cache_read_tokens: (row.cache_read_tokens as number) || 0,
          cache_creation_tokens: (row.cache_creation_tokens as number) || 0,
          sessions: (row.sessions as number) || 0,
        };
      }),
    };
  } catch (err) {
    log.warn(`tokenUsage query failed: ${err}`);
    return empty;
  }
}

// ── Tool call analytics ─────────────────────────────

function queryToolCallStats(sql: SqlStorage, days: number): ToolCallStats {
  const empty: ToolCallStats = {
    total_calls: 0,
    total_errors: 0,
    error_rate: 0,
    avg_duration_ms: 0,
    calls_per_session: 0,
    research_to_edit_ratio: 0,
    frequency: [],
    error_patterns: [],
    hourly_activity: [],
  };

  try {
    // Totals
    const totalsRow = sql
      .exec(
        `SELECT COUNT(*) AS total_calls,
                COALESCE(SUM(is_error), 0) AS total_errors,
                ROUND(AVG(duration_ms), 0) AS avg_duration_ms,
                COUNT(DISTINCT session_id) AS distinct_sessions
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')`,
        days,
      )
      .toArray()[0] as Record<string, unknown> | undefined;

    if (!totalsRow || (totalsRow.total_calls as number) === 0) return empty;

    const totalCalls = (totalsRow.total_calls as number) || 0;
    const totalErrors = (totalsRow.total_errors as number) || 0;
    const distinctSessions = (totalsRow.distinct_sessions as number) || 1;

    // Research-to-edit ratio. Tool lists come from the shared classifier
    // in packages/shared/tool-call-categories.ts — do not hardcode here.
    const researchList = sqlInList(RESEARCH_TOOLS);
    const editList = sqlInList(EDIT_TOOLS);
    const ratioRow = sql
      .exec(
        `SELECT
           SUM(CASE WHEN tool IN (${researchList}) THEN 1 ELSE 0 END) AS research,
           SUM(CASE WHEN tool IN (${editList}) THEN 1 ELSE 0 END) AS edits
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')`,
        days,
      )
      .toArray()[0] as Record<string, unknown> | undefined;

    const researchCount = (ratioRow?.research as number) || 0;
    const editCount = (ratioRow?.edits as number) || 1;

    // Per-tool frequency
    const freqRows = sql
      .exec(
        `SELECT tool,
                COUNT(*) AS calls,
                COALESCE(SUM(is_error), 0) AS errors,
                ROUND(AVG(duration_ms), 0) AS avg_duration_ms,
                COUNT(DISTINCT session_id) AS sessions
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')
         GROUP BY tool
         ORDER BY calls DESC
         LIMIT 25`,
        days,
      )
      .toArray();

    const frequency: ToolCallFrequency[] = freqRows.map((r) => {
      const row = r as Record<string, unknown>;
      const calls = (row.calls as number) || 0;
      const errors = (row.errors as number) || 0;
      return {
        tool: row.tool as string,
        calls,
        errors,
        error_rate: calls > 0 ? Math.round((errors / calls) * 10000) / 100 : 0,
        avg_duration_ms: (row.avg_duration_ms as number) || 0,
        sessions: (row.sessions as number) || 0,
      };
    });

    // Error patterns — most common tool+error_preview combos
    const errorRows = sql
      .exec(
        `SELECT tool, error_preview, COUNT(*) AS count
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')
           AND is_error = 1
           AND error_preview IS NOT NULL
         GROUP BY tool, error_preview
         ORDER BY count DESC
         LIMIT 15`,
        days,
      )
      .toArray();

    const error_patterns: ToolCallErrorPattern[] = errorRows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        tool: row.tool as string,
        error_preview: row.error_preview as string,
        count: (row.count as number) || 0,
      };
    });

    // Hourly activity
    const hourlyRows = sql
      .exec(
        `SELECT CAST(strftime('%H', called_at) AS INTEGER) AS hour,
                COUNT(*) AS calls,
                COALESCE(SUM(is_error), 0) AS errors
         FROM tool_calls
         WHERE called_at > datetime('now', '-' || ? || ' days')
         GROUP BY hour
         ORDER BY hour`,
        days,
      )
      .toArray();

    const hourly_activity: ToolCallTimeline[] = hourlyRows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        hour: (row.hour as number) || 0,
        calls: (row.calls as number) || 0,
        errors: (row.errors as number) || 0,
      };
    });

    return {
      total_calls: totalCalls,
      total_errors: totalErrors,
      error_rate: totalCalls > 0 ? Math.round((totalErrors / totalCalls) * 10000) / 100 : 0,
      avg_duration_ms: (totalsRow.avg_duration_ms as number) || 0,
      calls_per_session: Math.round((totalCalls / distinctSessions) * 10) / 10,
      research_to_edit_ratio: Math.round((researchCount / editCount) * 10) / 10,
      frequency,
      error_patterns,
      hourly_activity,
    };
  } catch (err) {
    log.warn(`toolCallStats query failed: ${err}`);
    return empty;
  }
}

// -- Commit analytics --

function queryCommitStats(sql: SqlStorage, days: number): CommitStats {
  const empty: CommitStats = {
    total_commits: 0,
    commits_per_session: 0,
    sessions_with_commits: 0,
    avg_time_to_first_commit_min: null,
    by_tool: [],
    daily_commits: [],
    outcome_correlation: [],
    commit_edit_ratio: [],
  };

  try {
    // Totals
    const totalsRows = sql
      .exec(
        `SELECT
           COUNT(*) AS total_commits,
           COUNT(DISTINCT session_id) AS sessions_with_commits
         FROM commits
         WHERE created_at > datetime('now', '-' || ? || ' days')`,
        days,
      )
      .toArray();
    const totals = (totalsRows[0] || {}) as Record<string, unknown>;
    const totalCommits = (totals.total_commits as number) || 0;
    const sessionsWithCommits = (totals.sessions_with_commits as number) || 0;

    if (totalCommits === 0) return empty;

    // Total sessions in period for per-session average
    const sessionRows = sql
      .exec(
        `SELECT COUNT(*) AS total FROM sessions WHERE started_at > datetime('now', '-' || ? || ' days')`,
        days,
      )
      .toArray();
    const totalSessions = ((sessionRows[0] as Record<string, unknown>)?.total as number) || 1;

    // Time-to-first-commit (mirrors first_edit_stats pattern)
    const ttfcRows = sql
      .exec(
        `SELECT ROUND(AVG(
           ROUND((julianday(first_commit_at) - julianday(started_at)) * 24 * 60, 2)
         ), 1) AS avg_min
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND first_commit_at IS NOT NULL`,
        days,
      )
      .toArray();
    const avgTimeToFirstCommit =
      ((ttfcRows[0] as Record<string, unknown>)?.avg_min as number) ?? null;

    // By tool
    const toolRows = sql
      .exec(
        `SELECT host_tool,
                COUNT(*) AS commits,
                ROUND(AVG(files_changed), 1) AS avg_files_changed,
                ROUND(AVG(lines_added + lines_removed), 1) AS avg_lines
         FROM commits
         WHERE created_at > datetime('now', '-' || ? || ' days')
           AND host_tool IS NOT NULL AND host_tool != 'unknown'
         GROUP BY host_tool
         ORDER BY commits DESC`,
        days,
      )
      .toArray();
    const by_tool: CommitToolBreakdown[] = toolRows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        host_tool: row.host_tool as string,
        commits: (row.commits as number) || 0,
        avg_files_changed: (row.avg_files_changed as number) || 0,
        avg_lines: (row.avg_lines as number) || 0,
      };
    });

    // Daily commits
    const dailyRows = sql
      .exec(
        `SELECT date(committed_at) AS day, COUNT(*) AS commits
         FROM commits
         WHERE created_at > datetime('now', '-' || ? || ' days')
         GROUP BY day
         ORDER BY day ASC`,
        days,
      )
      .toArray();
    const daily_commits: DailyCommit[] = dailyRows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        day: row.day as string,
        commits: (row.commits as number) || 0,
      };
    });

    // Commit-to-outcome correlation: sessions with 0 commits vs 1+ commits
    const outcomeRows = sql
      .exec(
        `SELECT
           CASE WHEN commit_count > 0 THEN 'with_commits' ELSE 'no_commits' END AS bucket,
           COUNT(*) AS sessions,
           SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND ended_at IS NOT NULL
         GROUP BY bucket`,
        days,
      )
      .toArray();
    const outcome_correlation: CommitOutcomeCorrelation[] = outcomeRows.map((r) => {
      const row = r as Record<string, unknown>;
      const sess = (row.sessions as number) || 0;
      const comp = (row.completed as number) || 0;
      return {
        bucket: row.bucket as string,
        sessions: sess,
        completed: comp,
        completion_rate: sess > 0 ? Math.round((comp / sess) * 1000) / 10 : 0,
      };
    });

    // Commit-to-edit ratio: bucket sessions by what fraction of edits resulted in commits
    const ratioRows = sql
      .exec(
        `SELECT
           CASE
             WHEN edit_count = 0 THEN 'no_edits'
             WHEN CAST(commit_count AS REAL) / edit_count < 0.1 THEN 'low (<10%)'
             WHEN CAST(commit_count AS REAL) / edit_count < 0.5 THEN 'medium (10-50%)'
             ELSE 'high (50%+)'
           END AS bucket,
           COUNT(*) AS sessions,
           SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
           ROUND(AVG(edit_count), 1) AS avg_edits,
           ROUND(AVG(commit_count), 1) AS avg_commits
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND ended_at IS NOT NULL
           AND commit_count > 0
         GROUP BY bucket
         ORDER BY
           CASE bucket
             WHEN 'no_edits' THEN 1
             WHEN 'low (<10%)' THEN 2
             WHEN 'medium (10-50%)' THEN 3
             ELSE 4
           END`,
        days,
      )
      .toArray();
    const commit_edit_ratio: CommitEditRatioBucket[] = ratioRows.map((r) => {
      const row = r as Record<string, unknown>;
      const sess = (row.sessions as number) || 0;
      const comp = (row.completed as number) || 0;
      return {
        bucket: row.bucket as string,
        sessions: sess,
        completion_rate: sess > 0 ? Math.round((comp / sess) * 1000) / 10 : 0,
        avg_edits: (row.avg_edits as number) || 0,
        avg_commits: (row.avg_commits as number) || 0,
      };
    });

    return {
      total_commits: totalCommits,
      commits_per_session: Math.round((totalCommits / totalSessions) * 100) / 100,
      sessions_with_commits: sessionsWithCommits,
      avg_time_to_first_commit_min: avgTimeToFirstCommit,
      by_tool,
      daily_commits,
      outcome_correlation,
      commit_edit_ratio,
    };
  } catch (err) {
    log.warn(`commitStats query failed: ${err}`);
    return empty;
  }
}

export function getExtendedAnalytics(
  sql: SqlStorage,
  days: number,
): Omit<UserAnalytics, 'teams_included' | 'degraded'> {
  const base = getAnalytics(sql, days);
  return {
    ...base,
    // Override basic heatmap with enhanced version
    file_heatmap: queryFileHeatmapEnhanced(sql, days),
    hourly_distribution: queryHourlyDistribution(sql, days),
    tool_hourly: queryToolHourly(sql, days),
    tool_daily: queryToolDaily(sql, days),
    model_outcomes: queryModelPerformance(sql, days),
    tool_outcomes: queryToolOutcomes(sql, days),
    completion_summary: queryCompletionSummary(sql, days),
    tool_comparison: queryToolComparison(sql, days),
    work_type_distribution: queryWorkTypeDistribution(sql, days),
    tool_work_type: queryToolWorkType(sql, days),
    file_churn: queryFileChurn(sql, days),
    duration_distribution: queryDurationDistribution(sql, days),
    concurrent_edits: queryConcurrentEdits(sql, days),
    member_analytics: queryMemberAnalytics(sql, days),
    retry_patterns: queryRetryPatterns(sql, days),
    conflict_correlation: queryConflictCorrelation(sql, days),
    edit_velocity: queryEditVelocity(sql, days),
    memory_usage: queryMemoryUsage(sql, days),
    work_type_outcomes: queryWorkTypeOutcomes(sql, days),
    conversation_edit_correlation: queryConversationEditCorrelation(sql, days),
    file_rework: queryFileRework(sql, days),
    directory_heatmap: queryDirectoryHeatmap(sql, days),
    stuckness: queryStuckness(sql, days),
    file_overlap: queryFileOverlap(sql, days),
    audit_staleness: queryAuditStaleness(sql, days),
    first_edit_stats: queryFirstEditStats(sql, days),
    memory_outcome_correlation: queryMemoryOutcomeCorrelation(sql, days),
    top_memories: queryTopMemories(sql, days),
    scope_complexity: queryScopeComplexity(sql, days),
    prompt_efficiency: queryPromptEfficiency(sql, days),
    hourly_effectiveness: queryHourlyEffectiveness(sql, days),
    outcome_tags: queryOutcomeTags(sql, days),
    tool_handoffs: queryToolHandoffs(sql, days),
    period_comparison: queryPeriodComparison(sql, days),
    token_usage: queryTokenUsage(sql, days),
    tool_call_stats: queryToolCallStats(sql, days),
    commit_stats: queryCommitStats(sql, days),
  };
}
