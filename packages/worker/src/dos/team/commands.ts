// Command relay -- submit, claim, complete, query, expire.
// Commands are ephemeral directives from web dashboard to local daemons.
// Each function takes `sql` as the first parameter.

import { METRIC_KEYS } from '../../lib/constants.js';
import { sqlChanges } from '../../lib/validation.js';
import type { DOError } from '../../types.js';

const VALID_COMMAND_TYPES = new Set(['spawn', 'stop', 'message']);

export function submitCommand(
  sql: SqlStorage,
  type: string,
  payload: Record<string, unknown>,
  senderId: string,
  senderHandle: string,
  recordMetric: (metric: string) => void,
): { ok: true; id: string } | DOError {
  if (!VALID_COMMAND_TYPES.has(type)) {
    return { error: `Invalid command type: ${type}`, code: 'VALIDATION' };
  }
  const id = crypto.randomUUID();
  sql.exec(
    `INSERT INTO commands (id, type, payload, sender_id, sender_handle, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`,
    id,
    type,
    JSON.stringify(payload),
    senderId,
    senderHandle,
  );
  recordMetric(METRIC_KEYS.COMMANDS_SUBMITTED);
  return { ok: true, id };
}

export function claimCommand(
  sql: SqlStorage,
  commandId: string,
  claimedBy: string,
): { ok: true } | DOError {
  sql.exec(
    `UPDATE commands SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now')
     WHERE id = ? AND status = 'pending'`,
    claimedBy,
    commandId,
  );
  if (sqlChanges(sql) === 0) {
    return { error: 'Command not available', code: 'CONFLICT' };
  }
  return { ok: true };
}

export function completeCommand(
  sql: SqlStorage,
  commandId: string,
  daemonAgentId: string,
  status: 'completed' | 'failed',
  result: Record<string, unknown>,
): { ok: true } | DOError {
  sql.exec(
    `UPDATE commands SET status = ?, result = ?, completed_at = datetime('now')
     WHERE id = ? AND claimed_by = ? AND status = 'claimed'`,
    status,
    JSON.stringify(result),
    commandId,
    daemonAgentId,
  );
  if (sqlChanges(sql) === 0) {
    return { error: 'Command not found or not claimed by this daemon', code: 'NOT_FOUND' };
  }
  return { ok: true };
}

export function getPendingCommands(sql: SqlStorage): {
  ok: true;
  commands: Array<Record<string, unknown>>;
} {
  const rows = sql
    .exec(
      `SELECT id, type, payload, sender_handle, status, claimed_by, created_at
       FROM commands
       WHERE status IN ('pending', 'claimed')
         AND created_at > datetime('now', '-5 minutes')
       ORDER BY created_at ASC
       LIMIT 50`,
    )
    .toArray();
  return { ok: true, commands: rows as Array<Record<string, unknown>> };
}

export function expireCommands(sql: SqlStorage): void {
  sql.exec(
    `UPDATE commands SET status = 'expired'
     WHERE status = 'pending'
       AND created_at < datetime('now', '-5 minutes')`,
  );
  sql.exec(
    `DELETE FROM commands
     WHERE status IN ('completed', 'failed', 'expired')
       AND created_at < datetime('now', '-1 hour')`,
  );
}
