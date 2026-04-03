// Activity tracking — updateActivity, checkConflicts, reportFile.
// Each function takes `sql` as the first parameter.

import { normalizePath } from '../../lib/text-utils.js';
import { getErrorMessage } from '../../lib/errors.js';
import { createLogger } from '../../lib/logger.js';
import { HEARTBEAT_ACTIVE_WINDOW_S, ACTIVITY_MAX_FILES } from '../../lib/constants.js';
import { buildInClause, withTransaction } from '../../lib/validation.js';

const log = createLogger('TeamDO.activity');

export function updateActivity(sql, resolvedAgentId, files, summary, transact) {
  const normalized = files.map(normalizePath);

  return withTransaction(transact, () => {
    sql.exec(
      `INSERT INTO activities (agent_id, files, summary, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(agent_id) DO UPDATE SET
         files = excluded.files,
         summary = excluded.summary,
         updated_at = datetime('now')`,
      resolvedAgentId,
      JSON.stringify(normalized),
      summary,
    );
    sql.exec(
      "UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?",
      resolvedAgentId,
    );
    return { ok: true };
  });
}

export function checkConflicts(
  sql,
  resolvedAgentId,
  files,
  recordMetric,
  connectedAgentIds = new Set(),
) {
  // Active = recent heartbeat OR live WebSocket connection
  const wsAlive = [...connectedAgentIds];
  const ws = buildInClause(wsAlive);

  const others = sql
    .exec(
      `SELECT m.agent_id, m.handle AS owner_handle, m.host_tool AS tool, a.files, a.summary
     FROM members m
     LEFT JOIN activities a ON a.agent_id = m.agent_id
     WHERE m.agent_id != ?
       AND (m.last_heartbeat > datetime('now', '-' || ? || ' seconds')
            OR m.agent_id IN (${ws.sql}))`,
      resolvedAgentId,
      HEARTBEAT_ACTIVE_WINDOW_S,
      ...ws.params,
    )
    .toArray();

  const myFiles = new Set(files.map(normalizePath));
  const conflicts = [];

  for (const row of others) {
    if (!row.files) continue;
    let theirFiles = [];
    try {
      theirFiles = JSON.parse(row.files);
    } catch (err) {
      log.warn('malformed JSON in files for agent', {
        agentId: row.agent_id,
        error: getErrorMessage(err),
      });
      continue;
    }
    const overlap = theirFiles.filter((f) => myFiles.has(f));
    if (overlap.length > 0) {
      conflicts.push({
        owner_handle: row.owner_handle,
        tool: row.tool || 'unknown',
        files: overlap,
        summary: row.summary || '',
      });
    }
  }

  // Check file locks — only from active agents (heartbeat OR WebSocket)
  const lockedFiles = [];
  const fileList = [...myFiles];
  if (fileList.length > 0) {
    const placeholders = fileList.map(() => '?').join(',');
    const lockRows = sql
      .exec(
        `SELECT l.file_path, l.handle AS owner_handle, l.host_tool AS tool, l.claimed_at FROM locks l
       JOIN members m ON m.agent_id = l.agent_id
       WHERE l.file_path IN (${placeholders}) AND l.agent_id != ?
         AND (m.last_heartbeat > datetime('now', '-' || ? || ' seconds')
              OR m.agent_id IN (${ws.sql}))`,
        ...fileList,
        resolvedAgentId,
        HEARTBEAT_ACTIVE_WINDOW_S,
        ...ws.params,
      )
      .toArray();
    for (const lock of lockRows) {
      lockedFiles.push({
        file: lock.file_path,
        held_by: lock.owner_handle,
        tool: lock.tool || 'unknown',
        claimed_at: lock.claimed_at,
      });
    }
  }

  recordMetric('conflict_checks');
  // Record conflicts in active session for the requesting agent
  if (conflicts.length > 0 || lockedFiles.length > 0) {
    recordMetric('conflicts_found');
    sql.exec(
      `UPDATE sessions SET conflicts_hit = conflicts_hit + 1
       WHERE agent_id = ? AND ended_at IS NULL`,
      resolvedAgentId,
    );
  }

  return { ok: true, conflicts, locked: lockedFiles };
}

export function reportFile(sql, resolvedAgentId, filePath, transact) {
  const normalized = normalizePath(filePath);

  const existing = sql
    .exec('SELECT files FROM activities WHERE agent_id = ?', resolvedAgentId)
    .toArray();

  let files = [];
  if (existing.length > 0 && existing[0].files) {
    try {
      files = JSON.parse(existing[0].files);
    } catch (err) {
      log.warn('malformed JSON in stored files for agent', {
        agentId: resolvedAgentId,
        error: getErrorMessage(err),
      });
    }
  }

  if (!files.includes(normalized)) {
    files.push(normalized);
    if (files.length > ACTIVITY_MAX_FILES) files = files.slice(-ACTIVITY_MAX_FILES);
  }

  return withTransaction(transact, () => {
    sql.exec(
      `INSERT INTO activities (agent_id, files, summary, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(agent_id) DO UPDATE SET
         files = excluded.files,
         updated_at = datetime('now')`,
      resolvedAgentId,
      JSON.stringify(files),
      `Editing ${normalized}`,
    );
    sql.exec(
      "UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?",
      resolvedAgentId,
    );
    return { ok: true };
  });
}
