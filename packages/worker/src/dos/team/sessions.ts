// Session tracking (observability) -- startSession, endSession, recordEdit, getSessionHistory.
// Each function takes `sql` as the first parameter.

import type { DOResult, SessionInfo } from '../../types.js';
import { normalizePath } from '../../lib/text-utils.js';
import { createLogger } from '../../lib/logger.js';
import { safeParse } from '../../lib/safe-parse.js';
import { normalizeRuntimeMetadata } from './runtime.js';
import { HEARTBEAT_STALE_WINDOW_S, ACTIVITY_MAX_FILES, METRIC_KEYS } from '../../lib/constants.js';
import { sqlChanges, withTransaction } from '../../lib/validation.js';

const log = createLogger('TeamDO.sessions');

export function startSession(
  sql: SqlStorage,
  resolvedAgentId: string,
  handle: string,
  framework: string | null | undefined,
  runtimeOrTool: string | Record<string, unknown> | null | undefined,
  transact: <T>(fn: () => T) => T,
): DOResult<{ ok: true; session_id: string }> {
  const runtime = normalizeRuntimeMetadata(runtimeOrTool, resolvedAgentId);
  const id = crypto.randomUUID();

  // Transaction ensures old sessions are closed and the new one is created
  // atomically. Without this, closing orphans but failing the INSERT leaves
  // the agent with no session record.
  return withTransaction(transact, () => {
    sql.exec(
      `UPDATE sessions SET ended_at = datetime('now') WHERE agent_id = ? AND ended_at IS NULL`,
      resolvedAgentId,
    );
    sql.exec(
      `UPDATE sessions SET ended_at = datetime('now')
       WHERE handle = ? AND ended_at IS NULL
       AND agent_id NOT IN (
         SELECT agent_id FROM members
         WHERE last_heartbeat > datetime('now', '-' || ? || ' seconds')
       )`,
      handle,
      HEARTBEAT_STALE_WINDOW_S,
    );

    sql.exec(
      `INSERT INTO sessions (id, agent_id, handle, framework, host_tool, agent_surface, transport, agent_model, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      id,
      resolvedAgentId,
      handle,
      framework || 'unknown',
      runtime.hostTool,
      runtime.agentSurface,
      runtime.transport,
      runtime.model,
    );
    return { ok: true as const, session_id: id };
  });
}

export function enrichSessionModel(
  sql: SqlStorage,
  resolvedAgentId: string,
  model: string,
  recordMetric: (metric: string) => void,
  transact: <T>(fn: () => T) => T,
): { ok: true } {
  withTransaction(transact, () => {
    sql.exec(
      `UPDATE sessions SET agent_model = ? WHERE agent_id = ? AND ended_at IS NULL AND agent_model IS NULL`,
      model,
      resolvedAgentId,
    );
    sql.exec(
      `UPDATE members SET agent_model = ? WHERE agent_id = ? AND agent_model IS NULL`,
      model,
      resolvedAgentId,
    );
  });
  recordMetric(`${METRIC_KEYS.MODEL_PREFIX}${model}`);
  return { ok: true };
}

export function endSession(
  sql: SqlStorage,
  resolvedAgentId: string,
  sessionId: string,
): DOResult<{ ok: true }> {
  sql.exec(
    `UPDATE sessions SET ended_at = datetime('now') WHERE id = ? AND agent_id = ? AND ended_at IS NULL`,
    sessionId,
    resolvedAgentId,
  );
  if (sqlChanges(sql) === 0)
    return { error: 'Session not found or not owned by this agent', code: 'NOT_FOUND' };
  return { ok: true };
}

export function recordEdit(
  sql: SqlStorage,
  resolvedAgentId: string,
  filePath: string,
): { ok: true; skipped?: boolean } {
  const normalized = normalizePath(filePath);

  // Find the active session for this agent (or resolved session)
  const sessions = sql
    .exec(
      'SELECT id, files_touched FROM sessions WHERE agent_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
      resolvedAgentId,
    )
    .toArray();

  if (sessions.length === 0) return { ok: true, skipped: true }; // No active session

  const session = sessions[0] as Record<string, unknown>;
  let files = safeParse(
    (session.files_touched as string) || '[]',
    `recordEdit session=${session.id} files_touched`,
    [] as string[],
    log,
  );
  if (!files.includes(normalized)) {
    files.push(normalized);
    if (files.length > ACTIVITY_MAX_FILES) files = files.slice(-ACTIVITY_MAX_FILES);
  }

  sql.exec(
    `UPDATE sessions SET edit_count = edit_count + 1, files_touched = ? WHERE id = ?`,
    JSON.stringify(files),
    session.id as string,
  );
  return { ok: true };
}

export function getSessionHistory(
  sql: SqlStorage,
  days: number,
): { ok: true; sessions: SessionInfo[] } {
  const sessions = sql
    .exec(
      `SELECT handle AS owner_handle, framework, host_tool, agent_surface, transport, agent_model, started_at, ended_at,
           edit_count, files_touched, conflicts_hit, memories_saved,
           ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60) as duration_minutes
     FROM sessions
     WHERE started_at > datetime('now', '-' || ? || ' days')
     ORDER BY started_at DESC
     LIMIT 50`,
      days,
    )
    .toArray();

  return {
    ok: true,
    sessions: sessions.map((s) => {
      const row = s as Record<string, unknown>;
      return {
        ...row,
        files_touched: safeParse(
          (row.files_touched as string) || '[]',
          `getSessionHistory handle=${row.owner_handle} files_touched`,
          [] as string[],
          log,
        ),
      } as unknown as SessionInfo;
    }),
  };
}
