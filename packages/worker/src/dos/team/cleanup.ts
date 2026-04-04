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
import { HEARTBEAT_STALE_WINDOW_S, SESSION_RETENTION_DAYS } from '../../lib/constants.js';

const log = createLogger('TeamDO:cleanup');

export function runCleanup(
  sql: SqlStorage,
  connectedAgentIds: Set<string>,
  transact: <T>(fn: () => T) => T,
): void {
  const ws = buildInClause([...connectedAgentIds]);

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

    step('close orphaned sessions', () =>
      sql.exec(
        `UPDATE sessions SET ended_at = datetime('now')
           WHERE ended_at IS NULL
           AND agent_id NOT IN (
             SELECT agent_id FROM members
             WHERE last_heartbeat > datetime('now', '-' || ? || ' seconds')
               OR agent_id IN (${ws.sql})
           )`,
        HEARTBEAT_STALE_WINDOW_S,
        ...ws.params,
      ),
    );

    step('delete old telemetry', () =>
      sql.exec("DELETE FROM telemetry WHERE last_at < datetime('now', '-30 days')"),
    );
  });
}
