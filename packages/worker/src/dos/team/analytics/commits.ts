// Commit analytics: commit stats, tool breakdown, daily trends, outcome correlation.

import { createLogger } from '../../../lib/logger.js';
import type {
  CommitStats,
  CommitToolBreakdown,
  DailyCommit,
  CommitOutcomeCorrelation,
  CommitEditRatioBucket,
} from '@chinmeister/shared/contracts/analytics.js';
import { row, rows } from '../../../lib/row.js';
import { type AnalyticsScope, withScope } from './scope.js';

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
    // Totals - substantive commits only. Noise (dep bumps, formatting, WIP
    // checkpoints, merges) stays in the table for audit but is excluded from
    // analytics so per-session and per-tool averages aren't diluted.
    const { sql: totalsQ, params: totalsP } = withScope(
      `SELECT
           COUNT(*) AS total_commits,
           COUNT(DISTINCT session_id) AS sessions_with_commits
         FROM commits
         WHERE created_at > datetime('now', '-' || ? || ' days')
           AND is_noise = 0`,
      [days],
      scope,
    );
    const totalsRows = sql.exec(totalsQ, ...totalsP).toArray();
    const totals = row(totalsRows[0]);
    const totalCommits = totals.number('total_commits');
    const sessionsWithCommits = totals.number('sessions_with_commits');

    if (totalCommits === 0) return empty;

    // Total sessions in period for per-session average
    const { sql: sessQ, params: sessP } = withScope(
      `SELECT COUNT(*) AS total FROM sessions WHERE started_at > datetime('now', '-' || ? || ' days')`,
      [days],
      scope,
    );
    const sessionRows = sql.exec(sessQ, ...sessP).toArray();
    const totalSessions = row(sessionRows[0]).number('total') || 1;

    // Time-to-first-commit (mirrors first_edit_stats pattern)
    const { sql: ttfcQ, params: ttfcP } = withScope(
      `SELECT ROUND(AVG(
           ROUND((julianday(first_commit_at) - julianday(started_at)) * 24 * 60, 2)
         ), 1) AS avg_min
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND first_commit_at IS NOT NULL`,
      [days],
      scope,
    );
    const ttfcRows = sql.exec(ttfcQ, ...ttfcP).toArray();
    const avgTimeToFirstCommit = row(ttfcRows[0]).nullableNumber('avg_min');

    // By tool
    const { sql: toolQ, params: toolP } = withScope(
      `SELECT host_tool,
                COUNT(*) AS commits,
                ROUND(AVG(files_changed), 1) AS avg_files_changed,
                ROUND(AVG(lines_added + lines_removed), 1) AS avg_lines
         FROM commits
         WHERE created_at > datetime('now', '-' || ? || ' days')
           AND host_tool IS NOT NULL AND host_tool != 'unknown'
           AND is_noise = 0`,
      [days],
      scope,
    );
    const toolRows = sql
      .exec(
        `${toolQ}
         GROUP BY host_tool
         ORDER BY commits DESC`,
        ...toolP,
      )
      .toArray();
    const by_tool: CommitToolBreakdown[] = rows<CommitToolBreakdown>(toolRows, (r) => ({
      host_tool: r.string('host_tool'),
      commits: r.number('commits'),
      avg_files_changed: r.number('avg_files_changed'),
      avg_lines: r.number('avg_lines'),
    }));

    // Daily commits - substantive only. Day buckets follow the caller's
    // timezone via the offset modifier so a commit made at 11:55pm PT lands
    // on the same local day the user sees in the rest of the dashboard.
    const { sql: dailyQ, params: dailyP } = withScope(
      `SELECT date(datetime(committed_at, ? || ' minutes')) AS day, COUNT(*) AS commits
         FROM commits
         WHERE created_at > datetime('now', '-' || ? || ' days')
           AND is_noise = 0`,
      [tzOffsetMinutes, days],
      scope,
    );
    const dailyRows = sql
      .exec(
        `${dailyQ}
         GROUP BY day
         ORDER BY day ASC`,
        ...dailyP,
      )
      .toArray();
    const daily_commits: DailyCommit[] = rows<DailyCommit>(dailyRows, (r) => ({
      day: r.string('day'),
      commits: r.number('commits'),
    }));

    // Commit-to-outcome correlation: sessions with 0 commits vs 1+ commits
    const { sql: outcomeQ, params: outcomeP } = withScope(
      `SELECT
           CASE WHEN commit_count > 0 THEN 'with_commits' ELSE 'no_commits' END AS bucket,
           COUNT(*) AS sessions,
           SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND ended_at IS NOT NULL`,
      [days],
      scope,
    );
    const outcomeRows = sql
      .exec(
        `${outcomeQ}
         GROUP BY bucket`,
        ...outcomeP,
      )
      .toArray();
    const outcome_correlation: CommitOutcomeCorrelation[] = rows<CommitOutcomeCorrelation>(
      outcomeRows,
      (r) => {
        const sess = r.number('sessions');
        const comp = r.number('completed');
        return {
          bucket: r.string('bucket'),
          sessions: sess,
          completed: comp,
          completion_rate: sess > 0 ? Math.round((comp / sess) * 1000) / 10 : 0,
        };
      },
    );

    // Commit-to-edit ratio: bucket sessions by what fraction of edits resulted in commits
    const { sql: ratioQ, params: ratioP } = withScope(
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
           AND commit_count > 0`,
      [days],
      scope,
    );
    const ratioRows = sql
      .exec(
        `${ratioQ}
         GROUP BY bucket
         ORDER BY
           CASE bucket
             WHEN 'no_edits' THEN 1
             WHEN 'low (<10%)' THEN 2
             WHEN 'medium (10-50%)' THEN 3
             ELSE 4
           END`,
        ...ratioP,
      )
      .toArray();
    const commit_edit_ratio: CommitEditRatioBucket[] = rows<CommitEditRatioBucket>(
      ratioRows,
      (r) => {
        const sess = r.number('sessions');
        const comp = r.number('completed');
        return {
          bucket: r.string('bucket'),
          sessions: sess,
          completion_rate: sess > 0 ? Math.round((comp / sess) * 1000) / 10 : 0,
          avg_edits: r.number('avg_edits'),
          avg_commits: r.number('avg_commits'),
        };
      },
    );

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
