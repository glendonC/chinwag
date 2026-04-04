// Advisory file locking -- claimFiles, releaseFiles, getLockedFiles.
// Each function takes `sql` as the first parameter.

import type { LockClaim, BlockedLock, LockEntry } from '../../types.js';
import { normalizePath } from '../../lib/text-utils.js';
import { normalizeRuntimeMetadata } from './runtime.js';
import { HEARTBEAT_ACTIVE_WINDOW_S } from '../../lib/constants.js';
import { buildInClause, sqlChanges } from '../../lib/validation.js';

export function claimFiles(
  sql: SqlStorage,
  resolvedAgentId: string,
  files: string[],
  handle: string,
  runtimeOrTool: string | Record<string, unknown> | null | undefined,
): LockClaim {
  const runtime = normalizeRuntimeMetadata(runtimeOrTool, resolvedAgentId);
  const normalized = files.map(normalizePath);
  const claimed: string[] = [];
  const blocked: BlockedLock[] = [];

  for (const file of normalized) {
    // Atomic claim: insert if free, no-op if already held by another agent.
    // ON CONFLICT DO UPDATE only if we already own it (refresh our lock).
    // The WHERE clause makes ownership enforcement part of the SQL constraint,
    // so there's no TOCTOU window between checking and writing.
    sql.exec(
      `INSERT INTO locks (file_path, agent_id, handle, host_tool, agent_surface, claimed_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(file_path) DO UPDATE SET
         handle = excluded.handle,
         host_tool = excluded.host_tool,
         agent_surface = excluded.agent_surface,
         claimed_at = datetime('now')
       WHERE locks.agent_id = excluded.agent_id`,
      file,
      resolvedAgentId,
      handle || 'unknown',
      runtime.hostTool,
      runtime.agentSurface,
    );

    // Use changes() to determine outcome: if 0 rows changed, the lock is held
    // by another agent (the WHERE clause prevented the update).
    const changed = sqlChanges(sql);
    if (changed === 0) {
      // Lock held by another agent -- fetch their details for the blocked response.
      const lock = sql
        .exec(
          'SELECT handle, host_tool, agent_surface, claimed_at FROM locks WHERE file_path = ?',
          file,
        )
        .toArray()[0] as Record<string, unknown>;
      blocked.push({
        file,
        held_by: lock.handle as string,
        tool: (lock.host_tool as string) || 'unknown',
        host_tool: (lock.host_tool as string) || 'unknown',
        agent_surface: (lock.agent_surface as string) || null,
        claimed_at: lock.claimed_at as string,
      });
    } else {
      claimed.push(file);
    }
  }

  return { ok: true, claimed, blocked };
}

export function releaseFiles(
  sql: SqlStorage,
  resolvedAgentId: string,
  files: string[] | null | undefined,
): { ok: true } {
  if (!files || files.length === 0) {
    // Release all locks for this agent
    sql.exec('DELETE FROM locks WHERE agent_id = ?', resolvedAgentId);
  } else {
    const normalized = files.map(normalizePath);
    for (const file of normalized) {
      sql.exec('DELETE FROM locks WHERE file_path = ? AND agent_id = ?', file, resolvedAgentId);
    }
  }
  return { ok: true };
}

export function getLockedFiles(
  sql: SqlStorage,
  connectedAgentIds: Set<string> = new Set(),
): { ok: true; locks: LockEntry[] } {
  const ws = buildInClause([...connectedAgentIds]);

  const locks = sql
    .exec(
      `SELECT l.file_path, l.agent_id, l.handle, l.host_tool, l.agent_surface, l.claimed_at,
            ROUND((julianday('now') - julianday(l.claimed_at)) * 1440) as minutes_held
     FROM locks l
     JOIN members m ON m.agent_id = l.agent_id
     WHERE m.last_heartbeat > datetime('now', '-' || ? || ' seconds')
        OR m.agent_id IN (${ws.sql})
     ORDER BY l.claimed_at DESC`,
      HEARTBEAT_ACTIVE_WINDOW_S,
      ...ws.params,
    )
    .toArray() as unknown as LockEntry[];

  return { ok: true, locks };
}
