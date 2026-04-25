// Commit analytics: commit stats, tool breakdown, daily trends, outcome correlation.

import { createLogger } from '../../../lib/logger.js';
import type {
  CommitStats,
  CommitToolBreakdown,
  DailyCommit,
  CommitOutcomeCorrelation,
  CommitEditRatioBucket,
} from '@chinmeister/shared/contracts/analytics.js';
import { type AnalyticsScope, buildScopeFilter } from './scope.js';

const log = createLogger('TeamDO.analytics');

export function queryCommitStats(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
  tzOffsetMinutes: number = 0,
): CommitStats {
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
    // Totals — substantive commits only. Noise (dep bumps, formatting, WIP
    // checkpoints, merges) stays in the table for audit but is excluded from
    // analytics so per-session and per-tool averages aren't diluted.
    const fTotals = buildScopeFilter(scope);
    const totalsRows = sql
      .exec(
        `SELECT
           COUNT(*) AS total_commits,
           COUNT(DISTINCT session_id) AS sessions_with_commits
         FROM commits
         WHERE created_at > datetime('now', '-' || ? || ' days')
           AND is_noise = 0${fTotals.sql}`,
        days,
        ...fTotals.params,
      )
      .toArray();
    const totals = (totalsRows[0] || {}) as Record<string, unknown>;
    const totalCommits = (totals.total_commits as number) || 0;
    const sessionsWithCommits = (totals.sessions_with_commits as number) || 0;

    if (totalCommits === 0) return empty;

    // Total sessions in period for per-session average
    const fSess = buildScopeFilter(scope);
    const sessionRows = sql
      .exec(
        `SELECT COUNT(*) AS total FROM sessions WHERE started_at > datetime('now', '-' || ? || ' days')${fSess.sql}`,
        days,
        ...fSess.params,
      )
      .toArray();
    const totalSessions = ((sessionRows[0] as Record<string, unknown>)?.total as number) || 1;

    // Time-to-first-commit (mirrors first_edit_stats pattern)
    const fTtfc = buildScopeFilter(scope);
    const ttfcRows = sql
      .exec(
        `SELECT ROUND(AVG(
           ROUND((julianday(first_commit_at) - julianday(started_at)) * 24 * 60, 2)
         ), 1) AS avg_min
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND first_commit_at IS NOT NULL${fTtfc.sql}`,
        days,
        ...fTtfc.params,
      )
      .toArray();
    const avgTimeToFirstCommit =
      ((ttfcRows[0] as Record<string, unknown>)?.avg_min as number) ?? null;

    // By tool
    const fTool = buildScopeFilter(scope);
    const toolRows = sql
      .exec(
        `SELECT host_tool,
                COUNT(*) AS commits,
                ROUND(AVG(files_changed), 1) AS avg_files_changed,
                ROUND(AVG(lines_added + lines_removed), 1) AS avg_lines
         FROM commits
         WHERE created_at > datetime('now', '-' || ? || ' days')
           AND host_tool IS NOT NULL AND host_tool != 'unknown'
           AND is_noise = 0${fTool.sql}
         GROUP BY host_tool
         ORDER BY commits DESC`,
        days,
        ...fTool.params,
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

    // Daily commits — substantive only. Day buckets follow the caller's
    // timezone via the offset modifier so a commit made at 11:55pm PT lands
    // on the same local day the user sees in the rest of the dashboard.
    const fDaily = buildScopeFilter(scope);
    const dailyRows = sql
      .exec(
        `SELECT date(datetime(committed_at, ? || ' minutes')) AS day, COUNT(*) AS commits
         FROM commits
         WHERE created_at > datetime('now', '-' || ? || ' days')
           AND is_noise = 0${fDaily.sql}
         GROUP BY day
         ORDER BY day ASC`,
        tzOffsetMinutes,
        days,
        ...fDaily.params,
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
    const fOutcome = buildScopeFilter(scope);
    const outcomeRows = sql
      .exec(
        `SELECT
           CASE WHEN commit_count > 0 THEN 'with_commits' ELSE 'no_commits' END AS bucket,
           COUNT(*) AS sessions,
           SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND ended_at IS NOT NULL${fOutcome.sql}
         GROUP BY bucket`,
        days,
        ...fOutcome.params,
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
    const fRatio = buildScopeFilter(scope);
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
           AND commit_count > 0${fRatio.sql}
         GROUP BY bucket
         ORDER BY
           CASE bucket
             WHEN 'no_edits' THEN 1
             WHEN 'low (<10%)' THEN 2
             WHEN 'medium (10-50%)' THEN 3
             ELSE 4
           END`,
        days,
        ...fRatio.params,
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
