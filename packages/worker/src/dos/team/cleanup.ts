// Stale member eviction and data pruning.
//
// Evicts members whose heartbeat is older than HEARTBEAT_STALE_WINDOW_S,
// UNLESS they have an active WebSocket connection. Also prunes old sessions,
// messages, orphaned locks, and stale telemetry.
//
// All deletions run inside a single transaction so partial cleanup can't
// leave inconsistent state (e.g. activities deleted but their parent
// member still present).

import { getErrorMessage } from '../../lib/errors.js';
import { createLogger } from '../../lib/logger.js';
import { buildInClause, withTransaction } from '../../lib/validation.js';
import {
  HEARTBEAT_STALE_WINDOW_S,
  SESSION_RETENTION_DAYS,
  DAILY_METRICS_RETENTION_DAYS,
} from '../../lib/constants.js';
import { expireCommands as expireCommandsFn } from './commands.js';

const log = createLogger('TeamDO:cleanup');

/**
 * Summary payload for an orphan session that the sweep just closed. The caller
 * pushes each of these to DatabaseDO.updateUserMetrics so lifetime percentile
 * ranks don't silently skip users whose MCP didn't shut down gracefully.
 */
export interface OrphanSummary {
  handle: string;
  summary: Record<string, unknown>;
}

export function runCleanup(
  sql: SqlStorage,
  connectedAgentIds: Set<string>,
  transact: <T>(fn: () => T) => T,
): OrphanSummary[] {
  const ws = buildInClause([...connectedAgentIds]);
  const orphans: OrphanSummary[] = [];

  /** Run a cleanup query, logging on failure without aborting the transaction. */
  const step = (label: string, fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      log.error(`${label} failed`, { error: getErrorMessage(err) });
    }
  };

  withTransaction(transact, () => {
    step('clamp future heartbeats', () =>
      sql.exec(
        "UPDATE members SET last_heartbeat = datetime('now') WHERE last_heartbeat > datetime('now')",
      ),
    );

    step('delete stale activities', () =>
      sql.exec(
        `DELETE FROM activities WHERE agent_id IN (
            SELECT agent_id FROM members
            WHERE last_heartbeat < datetime('now', '-' || ? || ' seconds')
              AND agent_id NOT IN (${ws.sql})
          )`,
        HEARTBEAT_STALE_WINDOW_S,
        ...ws.params,
      ),
    );

    step('delete stale members', () =>
      sql.exec(
        `DELETE FROM members
           WHERE last_heartbeat < datetime('now', '-' || ? || ' seconds')
             AND agent_id NOT IN (${ws.sql})`,
        HEARTBEAT_STALE_WINDOW_S,
        ...ws.params,
      ),
    );

    step('delete old sessions', () =>
      sql.exec(
        `DELETE FROM sessions WHERE started_at < datetime('now', '-' || ? || ' days')`,
        SESSION_RETENTION_DAYS,
      ),
    );

    step('delete old messages', () =>
      sql.exec("DELETE FROM messages WHERE created_at < datetime('now', '-1 hour')"),
    );

    step('delete orphaned locks', () =>
      sql.exec(
        `DELETE FROM locks WHERE agent_id NOT IN (
            SELECT agent_id FROM members
            WHERE last_heartbeat > datetime('now', '-' || ? || ' seconds')
              OR agent_id IN (${ws.sql})
          )`,
        HEARTBEAT_STALE_WINDOW_S,
        ...ws.params,
      ),
    );

    // Mark orphaned sessions as stuck. These are sessions where the agent's heartbeat
    // expired (15+ min without activity) while the session was still open - strong signal
    // the agent was genuinely stuck or crashed, not a graceful disconnect (which would
    // have called endSession before the heartbeat window expired).
    //
    // SELECT-then-UPDATE pattern (not a raw UPDATE) so the sweep can collect summaries
    // for DatabaseDO.updateUserMetrics. Without this hop the orphans close in the
    // session log but never roll up to user_metrics, leaving users with no global
    // rank and percentile widgets reading zeros.
    step('close orphaned sessions', () => {
      const rows = sql
        .exec(
          `SELECT s.id, s.handle, s.host_tool, s.agent_model, s.edit_count, s.lines_added, s.lines_removed,
                  s.input_tokens, s.output_tokens, s.cache_read_tokens, s.cache_creation_tokens,
                  s.memories_saved, s.memories_searched,
                  s.first_edit_at, s.started_at,
                  COALESCE(s.active_min, 0) AS active_min,
                  ROUND((julianday('now') - julianday(s.started_at)) * 24 * 60, 2) AS duration_min,
                  s.outcome,
                  COALESCE((SELECT COUNT(*) FROM tool_calls WHERE session_id = s.id), 0) AS tool_call_count,
                  COALESCE((SELECT SUM(is_error) FROM tool_calls WHERE session_id = s.id), 0) AS errored_tool_call_count
             FROM sessions s
            WHERE s.ended_at IS NULL
              AND s.agent_id NOT IN (
                SELECT agent_id FROM members
                WHERE last_heartbeat > datetime('now', '-' || ? || ' seconds')
                  OR agent_id IN (${ws.sql})
              )`,
          HEARTBEAT_STALE_WINDOW_S,
          ...ws.params,
        )
        .toArray() as Array<Record<string, unknown>>;

      for (const row of rows) {
        const id = row.id as string;
        const handle = row.handle as string;
        if (!id || !handle) continue;

        sql.exec(
          `UPDATE sessions SET ended_at = datetime('now'), got_stuck = 1
             WHERE id = ? AND ended_at IS NULL`,
          id,
        );

        // An orphan never hit reportOutcome, so the outcome field is typically null.
        // Classify as 'abandoned' - the clean-path heuristic uses duration > 5 min as
        // the abandonment threshold, and every orphan here crossed the 15-min stale
        // window, so 'abandoned' is always correct.
        orphans.push({
          handle,
          summary: {
            outcome: (row.outcome as string | null) ?? 'abandoned',
            edit_count: row.edit_count,
            lines_added: row.lines_added,
            lines_removed: row.lines_removed,
            duration_min: row.duration_min,
            active_min: row.active_min,
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
            cache_read_tokens: row.cache_read_tokens,
            cache_creation_tokens: row.cache_creation_tokens,
            got_stuck: 1,
            memories_saved: row.memories_saved,
            memories_searched: row.memories_searched,
            host_tool: row.host_tool,
            agent_model: row.agent_model,
            first_edit_at: row.first_edit_at,
            started_at: row.started_at,
            tool_call_count: row.tool_call_count,
            errored_tool_call_count: row.errored_tool_call_count,
          },
        });
      }
    });

    step('delete old edits', () =>
      sql.exec(
        `DELETE FROM edits WHERE created_at < datetime('now', '-' || ? || ' days')`,
        SESSION_RETENTION_DAYS,
      ),
    );

    step('expire stale commands', () => expireCommandsFn(sql));

    step('delete old telemetry', () =>
      sql.exec("DELETE FROM telemetry WHERE last_at < datetime('now', '-30 days')"),
    );

    step('delete old daily metrics', () =>
      sql.exec(
        `DELETE FROM daily_metrics WHERE date < date('now', '-' || ? || ' days')`,
        DAILY_METRICS_RETENTION_DAYS,
      ),
    );
  });

  return orphans;
}

/**
 * Scan historically-closed sessions for handles missing from user_metrics and
 * build rollup payloads. Self-healing backfill: catches the pre-orphan-fix
 * drift where sessions had `ended_at` set but never wrote to user_metrics,
 * and any future rollup-path bug that leaves similar gaps.
 *
 * Idempotency: caller passes the set of handles that already have a
 * user_metrics row. Only handles absent from that set are backfilled.
 * Emitted updateUserMetrics calls use the same per-session INSERT path that
 * the clean-end and orphan-close paths use, so re-running on a fully-backfilled
 * dataset is a no-op (no handles match the missing filter).
 */
export function collectHandleBackfills(
  sql: SqlStorage,
  handlesWithMetrics: Set<string>,
): OrphanSummary[] {
  const distinctHandles = sql
    .exec(`SELECT DISTINCT handle FROM sessions WHERE ended_at IS NOT NULL AND handle != ''`)
    .toArray() as Array<{ handle: string }>;

  const missing = distinctHandles
    .map((r) => r.handle)
    .filter((h) => h && !handlesWithMetrics.has(h));

  if (missing.length === 0) return [];

  const placeholders = missing.map(() => '?').join(',');
  const rows = sql
    .exec(
      `SELECT s.handle, s.host_tool, s.agent_model, s.edit_count, s.lines_added, s.lines_removed,
              s.input_tokens, s.output_tokens, s.cache_read_tokens, s.cache_creation_tokens,
              s.got_stuck, s.memories_saved, s.memories_searched,
              s.first_edit_at, s.started_at,
              COALESCE(s.active_min, 0) AS active_min,
              ROUND((julianday(COALESCE(s.ended_at, datetime('now'))) - julianday(s.started_at)) * 24 * 60, 2) AS duration_min,
              s.outcome,
              COALESCE((SELECT COUNT(*) FROM tool_calls WHERE session_id = s.id), 0) AS tool_call_count,
              COALESCE((SELECT SUM(is_error) FROM tool_calls WHERE session_id = s.id), 0) AS errored_tool_call_count
         FROM sessions s
        WHERE s.ended_at IS NOT NULL AND s.handle IN (${placeholders})`,
      ...missing,
    )
    .toArray() as Array<Record<string, unknown>>;

  const backfills: OrphanSummary[] = [];
  for (const row of rows) {
    const handle = row.handle as string;
    if (!handle) continue;
    backfills.push({
      handle,
      summary: {
        outcome: (row.outcome as string | null) ?? 'abandoned',
        edit_count: row.edit_count,
        lines_added: row.lines_added,
        lines_removed: row.lines_removed,
        duration_min: row.duration_min,
        active_min: row.active_min,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_read_tokens: row.cache_read_tokens,
        cache_creation_tokens: row.cache_creation_tokens,
        got_stuck: row.got_stuck,
        memories_saved: row.memories_saved,
        memories_searched: row.memories_searched,
        host_tool: row.host_tool,
        agent_model: row.agent_model,
        first_edit_at: row.first_edit_at,
        started_at: row.started_at,
        tool_call_count: row.tool_call_count,
        errored_tool_call_count: row.errored_tool_call_count,
      },
    });
  }
  return backfills;
}
