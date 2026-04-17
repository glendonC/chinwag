// Per-user lifetime metric accumulation -- one row per handle in `user_metrics`.
// Rolls up every finished session into handle-scoped counters that drive the
// global rank query and the community-intelligence stats page.
//
// Each function takes `sql` as the first parameter.

import type { DOError } from '../../types.js';

export function updateUserMetrics(
  sql: SqlStorage,
  handle: string,
  summary: Record<string, unknown>,
): { ok: true } | DOError {
  const outcome = (summary.outcome as string) || null;
  const editCount = Number(summary.edit_count) || 0;
  const linesAdded = Number(summary.lines_added) || 0;
  const linesRemoved = Number(summary.lines_removed) || 0;
  const durationMin = Number(summary.duration_min) || 0;
  const inputTokens = Number(summary.input_tokens) || 0;
  const outputTokens = Number(summary.output_tokens) || 0;
  // Cache token fields default to 0 for sessions closed before phase 2
  // where the columns didn't exist. Anthropic prompt-cached sessions make
  // these the dominant input-side volume, so omitting the rollup would
  // permanently undercount heavy-cache users on the lifetime metrics.
  const cacheReadTokens = Number(summary.cache_read_tokens) || 0;
  const cacheCreationTokens = Number(summary.cache_creation_tokens) || 0;
  const gotStuck = Number(summary.got_stuck) || 0;
  const memoriesSaved = Number(summary.memories_saved) || 0;
  const memoriesSearched = Number(summary.memories_searched) || 0;
  const hostTool = (summary.host_tool as string) || null;
  const agentModel = (summary.agent_model as string) || null;

  // Compute first-edit latency in seconds (if first_edit_at exists)
  let firstEditS = 0;
  let hasFirstEdit = 0;
  const firstEditAt = summary.first_edit_at as string | null;
  const startedAt = summary.started_at as string | null;
  if (firstEditAt && startedAt) {
    const diff =
      (new Date(String(firstEditAt).replace(' ', 'T') + 'Z').getTime() -
        new Date(String(startedAt).replace(' ', 'T') + 'Z').getTime()) /
      1000;
    if (diff >= 0) {
      firstEditS = diff;
      hasFirstEdit = 1;
    }
  }

  const completed = outcome === 'completed' ? 1 : 0;
  const abandoned = outcome === 'abandoned' ? 1 : 0;
  const failed = outcome === 'failed' ? 1 : 0;

  sql.exec(
    `INSERT INTO user_metrics (handle, total_sessions, completed_sessions, abandoned_sessions, failed_sessions,
      total_edits, total_lines_added, total_lines_removed, total_duration_min,
      total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens,
      total_stuck, total_memories_saved, total_memories_searched,
      total_first_edit_s, sessions_with_first_edit)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(handle) DO UPDATE SET
      total_sessions = total_sessions + 1,
      completed_sessions = completed_sessions + excluded.completed_sessions,
      abandoned_sessions = abandoned_sessions + excluded.abandoned_sessions,
      failed_sessions = failed_sessions + excluded.failed_sessions,
      total_edits = total_edits + excluded.total_edits,
      total_lines_added = total_lines_added + excluded.total_lines_added,
      total_lines_removed = total_lines_removed + excluded.total_lines_removed,
      total_duration_min = total_duration_min + excluded.total_duration_min,
      total_input_tokens = total_input_tokens + excluded.total_input_tokens,
      total_output_tokens = total_output_tokens + excluded.total_output_tokens,
      total_cache_read_tokens = total_cache_read_tokens + excluded.total_cache_read_tokens,
      total_cache_creation_tokens = total_cache_creation_tokens + excluded.total_cache_creation_tokens,
      total_stuck = total_stuck + excluded.total_stuck,
      total_memories_saved = total_memories_saved + excluded.total_memories_saved,
      total_memories_searched = total_memories_searched + excluded.total_memories_searched,
      total_first_edit_s = total_first_edit_s + excluded.total_first_edit_s,
      sessions_with_first_edit = sessions_with_first_edit + excluded.sessions_with_first_edit,
      updated_at = datetime('now')`,
    handle,
    completed,
    abandoned,
    failed,
    editCount,
    linesAdded,
    linesRemoved,
    durationMin,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    gotStuck,
    memoriesSaved,
    memoriesSearched,
    firstEditS,
    hasFirstEdit,
  );

  if (hostTool && hostTool !== 'unknown') {
    sql.exec('INSERT OR IGNORE INTO user_tools (handle, tool) VALUES (?, ?)', handle, hostTool);
  }
  if (agentModel) {
    sql.exec('INSERT OR IGNORE INTO user_models (handle, model) VALUES (?, ?)', handle, agentModel);
  }

  return { ok: true };
}
