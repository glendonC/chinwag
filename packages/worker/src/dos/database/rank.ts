// Global developer rank -- the single big CTE that percentile-ranks a user
// across 8 independent dimensions (completion rate, edit velocity, tool
// diversity, first-edit latency, stuck rate, lines/session, total lines,
// focus hours). The UI consumes the raw percentiles -- no composite score is
// computed here because any weighted mean across incomparable axes would be a
// fabricated number.
//
// Each function takes `sql` as the first parameter.

export function getUserGlobalRank(
  sql: SqlStorage,
  handle: string,
): { ok: true; rank: Record<string, unknown> | null; total_developers: number } {
  const countRow = sql
    .exec('SELECT COUNT(*) AS cnt FROM user_metrics WHERE total_sessions >= 1')
    .toArray();
  const totalDevelopers = ((countRow[0] as Record<string, unknown>)?.cnt as number) || 0;

  if (totalDevelopers === 0) {
    return { ok: true, rank: null, total_developers: 0 };
  }

  // Check if user exists in metrics
  const userRow = sql.exec('SELECT 1 FROM user_metrics WHERE handle = ?', handle).toArray();
  if (userRow.length === 0) {
    return { ok: true, rank: null, total_developers: totalDevelopers };
  }

  const rows = sql
    .exec(
      `WITH base AS (
        SELECT
          um.handle,
          um.total_sessions,
          um.completed_sessions,
          um.total_edits,
          um.total_lines_added,
          um.total_lines_removed,
          um.total_duration_min,
          um.total_stuck,
          um.total_memories_saved,
          um.total_memories_searched,
          um.total_first_edit_s,
          um.sessions_with_first_edit,
          um.total_input_tokens,
          um.total_output_tokens,
          CAST(um.completed_sessions AS REAL) / NULLIF(um.total_sessions, 0) * 100 AS completion_rate,
          CAST(um.total_edits AS REAL) / NULLIF(um.total_duration_min, 0) AS edit_velocity,
          (SELECT COUNT(*) FROM user_tools ut WHERE ut.handle = um.handle) AS tool_count,
          CASE WHEN um.sessions_with_first_edit > 0
            THEN um.total_first_edit_s / um.sessions_with_first_edit ELSE NULL END AS avg_first_edit_s,
          CAST(um.total_stuck AS REAL) / NULLIF(um.total_sessions, 0) * 100 AS stuck_rate,
          CAST(um.total_lines_added AS REAL) / NULLIF(um.total_sessions, 0) AS lines_per_session,
          um.total_lines_added AS total_lines,
          ROUND(um.total_duration_min / 60.0, 1) AS focus_hours
        FROM user_metrics um
        WHERE um.total_sessions >= 1
      ),
      ranked AS (
        SELECT *,
          ROUND(PERCENT_RANK() OVER (ORDER BY completion_rate) * 100) AS completion_rate_pct,
          ROUND(PERCENT_RANK() OVER (ORDER BY edit_velocity) * 100) AS edit_velocity_pct,
          ROUND(PERCENT_RANK() OVER (ORDER BY tool_count) * 100) AS tool_diversity_pct,
          ROUND(PERCENT_RANK() OVER (ORDER BY avg_first_edit_s DESC) * 100) AS first_edit_pct,
          ROUND(PERCENT_RANK() OVER (ORDER BY stuck_rate DESC) * 100) AS stuck_rate_pct,
          ROUND(PERCENT_RANK() OVER (ORDER BY lines_per_session) * 100) AS lines_per_session_pct,
          ROUND(PERCENT_RANK() OVER (ORDER BY total_lines) * 100) AS total_lines_pct,
          ROUND(PERCENT_RANK() OVER (ORDER BY focus_hours) * 100) AS focus_hours_pct
        FROM base
      )
      SELECT * FROM ranked WHERE handle = ?`,
      handle,
    )
    .toArray();

  if (rows.length === 0) {
    return { ok: true, rank: null, total_developers: totalDevelopers };
  }

  const rank = rows[0] as Record<string, unknown>;

  // No composite "effectiveness score" — the 8 raw percentile dimensions
  // (completion_rate_pct, edit_velocity_pct, tool_diversity_pct,
  // first_edit_pct, stuck_rate_pct, lines_per_session_pct,
  // total_lines_pct, focus_hours_pct) are what the UI consumes. Any
  // weighted mean across incomparable axes would be a fabricated number.

  return { ok: true, rank, total_developers: totalDevelopers };
}
