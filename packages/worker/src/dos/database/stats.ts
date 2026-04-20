// Community-intelligence stats -- the large aggregate query behind the public
// stats page. Rolls up user_metrics, user_tools, and user_models into global
// averages, per-tool/per-model effectiveness, tool combinations, completion-
// rate brackets, and tool-count distribution.
//
// Each function takes `sql` as the first parameter.

export interface CommunityStats {
  ok: true;
  totalUsers: number;
  totalSessions: number;
  totalEdits: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  topTools: string;
  topModels: string;
  globalAverages: Record<string, number>;
  toolEffectiveness: Array<Record<string, unknown>>;
  modelEffectiveness: Array<Record<string, unknown>>;
  toolCombinations: Array<Record<string, unknown>>;
  completionDistribution: Array<Record<string, unknown>>;
  toolCountDistribution: Array<Record<string, unknown>>;
}

export function getStats(sql: SqlStorage): CommunityStats {
  const users = sql.exec('SELECT COUNT(*) as count FROM users').toArray();
  const totalUsers = ((users[0] as Record<string, unknown>)?.count as number) || 0;

  // Global aggregates from user_metrics
  const agg = sql
    .exec(
      `SELECT
        COALESCE(SUM(total_sessions), 0) AS total_sessions,
        COALESCE(SUM(total_edits), 0) AS total_edits,
        COALESCE(SUM(total_lines_added), 0) AS total_lines_added,
        COALESCE(SUM(total_lines_removed), 0) AS total_lines_removed,
        COALESCE(SUM(total_input_tokens), 0) AS total_input_tokens,
        COALESCE(SUM(total_output_tokens), 0) AS total_output_tokens
      FROM user_metrics`,
    )
    .toArray();
  const ga = (agg[0] as Record<string, unknown>) || {};

  // Top tools across all users
  const tools = sql
    .exec(
      `SELECT tool, COUNT(*) AS users FROM user_tools GROUP BY tool ORDER BY users DESC LIMIT 10`,
    )
    .toArray() as Array<Record<string, unknown>>;

  // Top models across all users
  const models = sql
    .exec(
      `SELECT model, COUNT(*) AS users FROM user_models GROUP BY model ORDER BY users DESC LIMIT 10`,
    )
    .toArray() as Array<Record<string, unknown>>;

  // ── Community intelligence ──────────────────────────

  // Global averages across active developers
  let globalAverages: Record<string, number> = {};
  try {
    const avgRow = sql
      .exec(
        `SELECT
          ROUND(AVG(CAST(completed_sessions AS REAL) / NULLIF(total_sessions, 0) * 100), 1) AS avg_completion_rate,
          ROUND(AVG(CAST(total_edits AS REAL) / NULLIF(total_duration_min, 0)), 2) AS avg_edit_velocity,
          ROUND(AVG(CAST(total_stuck AS REAL) / NULLIF(total_sessions, 0) * 100), 1) AS avg_stuck_rate,
          ROUND(AVG(total_first_edit_s / NULLIF(sessions_with_first_edit, 0)), 1) AS avg_first_edit_s,
          ROUND(AVG(CAST(total_lines_added AS REAL) / NULLIF(total_sessions, 0)), 0) AS avg_lines_per_session,
          ROUND(AVG(total_duration_min / 60.0), 1) AS avg_focus_hours,
          ROUND(AVG(total_edits), 0) AS avg_total_edits,
          ROUND(AVG(total_sessions), 0) AS avg_total_sessions,
          ROUND(AVG(total_lines_added), 0) AS avg_total_lines_added,
          ROUND(AVG(total_input_tokens + total_output_tokens), 0) AS avg_total_tokens,
          ROUND(AVG(total_memories_saved), 1) AS avg_total_memories
        FROM user_metrics WHERE total_sessions >= 1`,
      )
      .toArray()[0] as Record<string, unknown> | undefined;
    if (avgRow) {
      globalAverages = {
        completion_rate: (avgRow.avg_completion_rate as number) || 0,
        edit_velocity: (avgRow.avg_edit_velocity as number) || 0,
        stuck_rate: (avgRow.avg_stuck_rate as number) || 0,
        first_edit_s: (avgRow.avg_first_edit_s as number) || 0,
        lines_per_session: (avgRow.avg_lines_per_session as number) || 0,
        focus_hours: (avgRow.avg_focus_hours as number) || 0,
        total_edits: (avgRow.avg_total_edits as number) || 0,
        total_sessions: (avgRow.avg_total_sessions as number) || 0,
        total_lines_added: (avgRow.avg_total_lines_added as number) || 0,
        total_tokens: (avgRow.avg_total_tokens as number) || 0,
        total_memories: (avgRow.avg_total_memories as number) || 0,
      };
    }
  } catch {
    /* ignore */
  }

  // Tool effectiveness: per-tool avg completion rate + velocity
  let toolEffectiveness: Array<Record<string, unknown>> = [];
  try {
    toolEffectiveness = sql
      .exec(
        `SELECT ut.tool,
          COUNT(*) AS users,
          ROUND(AVG(CAST(um.completed_sessions AS REAL) / NULLIF(um.total_sessions, 0) * 100), 1) AS avg_completion_rate,
          ROUND(AVG(CAST(um.total_edits AS REAL) / NULLIF(um.total_duration_min, 0)), 2) AS avg_edit_velocity,
          ROUND(AVG(um.total_first_edit_s / NULLIF(um.sessions_with_first_edit, 0)), 1) AS avg_first_edit_s
        FROM user_tools ut
        JOIN user_metrics um ON ut.handle = um.handle
        WHERE um.total_sessions >= 3
        GROUP BY ut.tool
        HAVING users >= 2
        ORDER BY avg_completion_rate DESC
        LIMIT 15`,
      )
      .toArray() as Array<Record<string, unknown>>;
  } catch {
    /* ignore */
  }

  // Model effectiveness: per-model avg completion rate
  let modelEffectiveness: Array<Record<string, unknown>> = [];
  try {
    modelEffectiveness = sql
      .exec(
        `SELECT umod.model,
          COUNT(*) AS users,
          ROUND(AVG(CAST(um.completed_sessions AS REAL) / NULLIF(um.total_sessions, 0) * 100), 1) AS avg_completion_rate,
          ROUND(AVG(CAST(um.total_edits AS REAL) / NULLIF(um.total_duration_min, 0)), 2) AS avg_edit_velocity
        FROM user_models umod
        JOIN user_metrics um ON umod.handle = um.handle
        WHERE um.total_sessions >= 3
        GROUP BY umod.model
        HAVING users >= 2
        ORDER BY avg_completion_rate DESC
        LIMIT 15`,
      )
      .toArray() as Array<Record<string, unknown>>;
  } catch {
    /* ignore */
  }

  // Tool combinations: most popular tool pairs
  let toolCombinations: Array<Record<string, unknown>> = [];
  try {
    toolCombinations = sql
      .exec(
        `SELECT t1.tool AS tool_a, t2.tool AS tool_b, COUNT(*) AS users
        FROM user_tools t1
        JOIN user_tools t2 ON t1.handle = t2.handle AND t1.tool < t2.tool
        GROUP BY t1.tool, t2.tool
        HAVING users >= 2
        ORDER BY users DESC
        LIMIT 10`,
      )
      .toArray() as Array<Record<string, unknown>>;
  } catch {
    /* ignore */
  }

  // Completion rate distribution: what brackets do users fall in
  let completionDistribution: Array<Record<string, unknown>> = [];
  try {
    completionDistribution = sql
      .exec(
        `SELECT
          CASE
            WHEN CAST(completed_sessions AS REAL) / total_sessions >= 0.9 THEN '90-100'
            WHEN CAST(completed_sessions AS REAL) / total_sessions >= 0.8 THEN '80-89'
            WHEN CAST(completed_sessions AS REAL) / total_sessions >= 0.7 THEN '70-79'
            WHEN CAST(completed_sessions AS REAL) / total_sessions >= 0.6 THEN '60-69'
            WHEN CAST(completed_sessions AS REAL) / total_sessions >= 0.5 THEN '50-59'
            ELSE '0-49'
          END AS bracket,
          COUNT(*) AS users
        FROM user_metrics
        WHERE total_sessions >= 1
        GROUP BY bracket
        ORDER BY bracket DESC`,
      )
      .toArray() as Array<Record<string, unknown>>;
  } catch {
    /* ignore */
  }

  // Tool count distribution: how many tools do developers use
  let toolCountDistribution: Array<Record<string, unknown>> = [];
  try {
    toolCountDistribution = sql
      .exec(
        `SELECT tool_count, COUNT(*) AS users
        FROM (SELECT handle, COUNT(*) AS tool_count FROM user_tools GROUP BY handle)
        GROUP BY tool_count
        ORDER BY tool_count`,
      )
      .toArray() as Array<Record<string, unknown>>;
  } catch {
    /* ignore */
  }

  return {
    ok: true as const,
    totalUsers,
    totalSessions: (ga.total_sessions as number) || 0,
    totalEdits: (ga.total_edits as number) || 0,
    totalLinesAdded: (ga.total_lines_added as number) || 0,
    totalLinesRemoved: (ga.total_lines_removed as number) || 0,
    topTools: JSON.stringify(tools.map((t) => ({ tool: t.tool, users: t.users }))),
    topModels: JSON.stringify(models.map((m) => ({ model: m.model, users: m.users }))),
    globalAverages,
    toolEffectiveness: toolEffectiveness.map((t) => ({
      tool: t.tool,
      users: t.users,
      completionRate: t.avg_completion_rate,
      editVelocity: t.avg_edit_velocity,
      firstEditS: t.avg_first_edit_s,
    })),
    modelEffectiveness: modelEffectiveness.map((m) => ({
      model: m.model,
      users: m.users,
      completionRate: m.avg_completion_rate,
      editVelocity: m.avg_edit_velocity,
    })),
    toolCombinations: toolCombinations.map((c) => ({
      toolA: c.tool_a,
      toolB: c.tool_b,
      users: c.users,
    })),
    completionDistribution: completionDistribution.map((d) => ({
      bracket: d.bracket,
      users: d.users,
    })),
    toolCountDistribution: toolCountDistribution.map((d) => ({
      count: d.tool_count,
      users: d.users,
    })),
  };
}
