// Session tracking (observability) — startSession, endSession, recordEdit, getSessionHistory.
// Each function takes `sql` as the first parameter.

import { normalizePath } from '../../lib/text-utils.js';
import { normalizeRuntimeMetadata } from './runtime.js';

const HEARTBEAT_STALE_SECONDS = 300;
const ACTIVITY_MAX_FILES = 50;

export function startSession(sql, resolvedAgentId, handle, framework, runtimeOrTool) {
  const runtime = normalizeRuntimeMetadata(runtimeOrTool, resolvedAgentId);
  // End any existing open session for this agent
  sql.exec(
    `UPDATE sessions SET ended_at = datetime('now') WHERE agent_id = ? AND ended_at IS NULL`,
    resolvedAgentId
  );
  // Also close orphaned sessions for same owner where agent is no longer active
  // (handles agent_id changes, e.g. --tool flag added/removed)
  sql.exec(
    `UPDATE sessions SET ended_at = datetime('now')
     WHERE owner_handle = ? AND ended_at IS NULL
     AND agent_id NOT IN (
       SELECT agent_id FROM members
       WHERE last_heartbeat > datetime('now', '-' || ? || ' seconds')
     )`,
    handle, HEARTBEAT_STALE_SECONDS
  );

  const id = crypto.randomUUID();
  sql.exec(
    `INSERT INTO sessions (id, agent_id, owner_handle, framework, host_tool, agent_surface, transport, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    id, resolvedAgentId, handle, framework || 'unknown', runtime.hostTool, runtime.agentSurface, runtime.transport
  );
  return { ok: true, session_id: id };
}

export function endSession(sql, resolvedAgentId, sessionId) {
  sql.exec(
    `UPDATE sessions SET ended_at = datetime('now') WHERE id = ? AND agent_id = ? AND ended_at IS NULL`,
    sessionId, resolvedAgentId
  );
  const changed = sql.exec('SELECT changes() as c').toArray();
  if (changed[0].c === 0) return { error: 'Session not found or not owned by this agent' };
  return { ok: true };
}

export function recordEdit(sql, resolvedAgentId, filePath) {
  const normalized = normalizePath(filePath);

  // Find the active session for this agent (or resolved session)
  const sessions = sql.exec(
    'SELECT id, files_touched FROM sessions WHERE agent_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
    resolvedAgentId
  ).toArray();

  if (sessions.length === 0) return { ok: true, skipped: true }; // No active session — caller can log if needed

  const session = sessions[0];
  let files = JSON.parse(session.files_touched || '[]');
  if (!files.includes(normalized)) {
    files.push(normalized);
    if (files.length > ACTIVITY_MAX_FILES) files = files.slice(-ACTIVITY_MAX_FILES);
  }

  sql.exec(
    `UPDATE sessions SET edit_count = edit_count + 1, files_touched = ? WHERE id = ?`,
    JSON.stringify(files), session.id
  );
  return { ok: true };
}

export function getSessionHistory(sql, days) {
  const sessions = sql.exec(
    `SELECT owner_handle, framework, host_tool, agent_surface, transport, started_at, ended_at,
           edit_count, files_touched, conflicts_hit, memories_saved,
           ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60) as duration_minutes
     FROM sessions
     WHERE started_at > datetime('now', '-' || ? || ' days')
     ORDER BY started_at DESC
     LIMIT 50`,
    days
  ).toArray();

  return {
    sessions: sessions.map(s => ({
      ...s,
      files_touched: JSON.parse(s.files_touched || '[]'),
    })),
  };
}
