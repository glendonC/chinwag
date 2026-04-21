// Activity tracking -- updateActivity, checkConflicts, reportFile.
// Each function takes `sql` as the first parameter.

import type { DOResult } from '../../types.js';
import { normalizePath } from '../../lib/text-utils.js';
import { createLogger } from '../../lib/logger.js';
import { safeParse } from '../../lib/safe-parse.js';
import { HEARTBEAT_ACTIVE_WINDOW_S, ACTIVITY_MAX_FILES, METRIC_KEYS } from '../../lib/constants.js';
import { buildInClause, withTransaction } from '../../lib/validation.js';

const log = createLogger('TeamDO.activity');

interface ConflictEntry {
  owner_handle: string;
  tool: string;
  files: string[];
  summary: string;
}

interface LockedFileEntry {
  file: string;
  held_by: string;
  tool: string;
  claimed_at: string;
}

interface ConflictCheckResult {
  ok: true;
  conflicts: ConflictEntry[];
  locked: LockedFileEntry[];
}

export function updateActivity(
  sql: SqlStorage,
  resolvedAgentId: string,
  files: string[],
  summary: string,
  transact: <T>(fn: () => T) => T,
): DOResult<{ ok: true }> {
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
    return { ok: true as const };
  });
}

export function checkConflicts(
  sql: SqlStorage,
  resolvedAgentId: string,
  files: string[],
  recordMetric: (metric: string) => void,
  connectedAgentIds: Set<string> = new Set(),
  source: 'hook' | 'advisory' = 'advisory',
): ConflictCheckResult {
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
  const conflicts: ConflictEntry[] = [];

  for (const row of others) {
    const r = row as Record<string, unknown>;
    if (!r.files) continue;
    const theirFiles = safeParse(
      r.files as string,
      `checkConflicts agent=${r.agent_id} files`,
      [] as string[],
      log,
    );
    if (theirFiles.length === 0) continue;
    const overlap = theirFiles.filter((f: string) => myFiles.has(f));
    if (overlap.length > 0) {
      conflicts.push({
        owner_handle: r.owner_handle as string,
        tool: (r.tool as string) || 'unknown',
        files: overlap,
        summary: (r.summary as string) || '',
      });
    }
  }

  // Check file locks -- only from active agents (heartbeat OR WebSocket)
  const lockedFiles: LockedFileEntry[] = [];
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
      const l = lock as Record<string, unknown>;
      lockedFiles.push({
        file: l.file_path as string,
        held_by: l.owner_handle as string,
        tool: (l.tool as string) || 'unknown',
        claimed_at: l.claimed_at as string,
      });
    }
  }

  recordMetric(METRIC_KEYS.CONFLICT_CHECKS);
  // Record conflicts in active session for the requesting agent
  if (conflicts.length > 0 || lockedFiles.length > 0) {
    recordMetric(METRIC_KEYS.CONFLICTS_FOUND);
    // Hook-sourced calls that find conflicts always block the edit (the hook
    // exits non-zero on any issue). Count those separately so the dashboard
    // can surface prevention, not just detection.
    if (source === 'hook') recordMetric(METRIC_KEYS.CONFLICTS_BLOCKED);
    sql.exec(
      `UPDATE sessions SET conflicts_hit = conflicts_hit + 1
       WHERE agent_id = ? AND ended_at IS NULL`,
      resolvedAgentId,
    );
  }

  return { ok: true, conflicts, locked: lockedFiles };
}

export function reportFile(
  sql: SqlStorage,
  resolvedAgentId: string,
  filePath: string,
  transact: <T>(fn: () => T) => T,
): DOResult<{ ok: true }> {
  const normalized = normalizePath(filePath);

  const existing = sql
    .exec('SELECT files FROM activities WHERE agent_id = ?', resolvedAgentId)
    .toArray();

  let files: string[] = [];
  if (existing.length > 0 && (existing[0] as Record<string, unknown>).files) {
    files = safeParse(
      (existing[0] as Record<string, unknown>).files as string,
      `reportFile agent=${resolvedAgentId} stored files`,
      [] as string[],
      log,
    );
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
    return { ok: true as const };
  });
}
