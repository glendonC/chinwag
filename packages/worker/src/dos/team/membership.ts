// Team membership -- join, leave, heartbeat.
// Each function takes `sql` as the first parameter and operates on the members table.

import type { DOResult } from '../../types.js';
import { normalizeRuntimeMetadata } from './runtime.js';
import { METRIC_KEYS } from '../../lib/constants.js';
import { sqlChanges, withTransaction } from '../../lib/validation.js';

/**
 * Join a team. Atomic ownership-safe upsert: re-joining refreshes heartbeat,
 * but an agent_id owned by another user is rejected.
 */
export function join(
  sql: SqlStorage,
  agentId: string,
  ownerId: string,
  handle: string,
  runtimeOrTool: string | Record<string, unknown> | null | undefined,
  recordMetric: (metric: string) => void,
): DOResult<{ ok: true }> {
  const runtime = normalizeRuntimeMetadata(runtimeOrTool, agentId);

  // Atomic ownership-safe upsert: INSERT the new member, but ON CONFLICT only
  // update if the existing row belongs to the same owner. This makes spoofing
  // protection part of the SQL constraint rather than a separate SELECT+check,
  // eliminating any TOCTOU window by construction.
  sql.exec(
    `INSERT INTO members (agent_id, owner_id, handle, host_tool, agent_surface, transport, joined_at, last_heartbeat)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(agent_id) DO UPDATE SET
       handle = excluded.handle,
       host_tool = excluded.host_tool,
       agent_surface = excluded.agent_surface,
       transport = excluded.transport,
       last_heartbeat = datetime('now')
     WHERE members.owner_id = excluded.owner_id`,
    agentId,
    ownerId,
    handle,
    runtime.hostTool,
    runtime.agentSurface,
    runtime.transport,
  );

  // If nothing was inserted or updated, the agent_id is owned by someone else.
  if (sqlChanges(sql) === 0) {
    return { error: 'Agent ID already claimed by another user', code: 'AGENT_CLAIMED' };
  }

  recordMetric(METRIC_KEYS.JOINS);
  recordMetric(`${METRIC_KEYS.HOST_PREFIX}${runtime.hostTool}`);
  if (runtime.agentSurface) recordMetric(`${METRIC_KEYS.SURFACE_PREFIX}${runtime.agentSurface}`);
  if (runtime.transport) recordMetric(`${METRIC_KEYS.TRANSPORT_PREFIX}${runtime.transport}`);
  return { ok: true };
}

/**
 * Leave a team. Removes member, their activity, and their locks.
 * If ownerId is provided, only removes if the agent belongs to that owner.
 */
export function leave(
  sql: SqlStorage,
  agentId: string,
  ownerId: string | null,
  transact: <T>(fn: () => T) => T,
): DOResult<{ ok: true }> {
  // Wrap in transaction so locks/activities/members are removed atomically.
  // Without this, a partial failure could orphan locks or activities.
  return withTransaction(transact, () => {
    if (ownerId) {
      sql.exec(
        'DELETE FROM locks WHERE agent_id = ? AND agent_id IN (SELECT agent_id FROM members WHERE agent_id = ? AND owner_id = ?)',
        agentId,
        agentId,
        ownerId,
      );
      sql.exec(
        'DELETE FROM activities WHERE agent_id = ? AND agent_id IN (SELECT agent_id FROM members WHERE agent_id = ? AND owner_id = ?)',
        agentId,
        agentId,
        ownerId,
      );
      sql.exec('DELETE FROM members WHERE agent_id = ? AND owner_id = ?', agentId, ownerId);
      if (sqlChanges(sql) === 0) {
        const exists = sql.exec('SELECT 1 FROM members WHERE agent_id = ?', agentId).toArray();
        if (exists.length > 0) {
          return { error: 'Not your agent', code: 'NOT_OWNER' };
        }
      }
    } else {
      sql.exec('DELETE FROM locks WHERE agent_id = ?', agentId);
      sql.exec('DELETE FROM activities WHERE agent_id = ?', agentId);
      sql.exec('DELETE FROM members WHERE agent_id = ?', agentId);
      if (sqlChanges(sql) === 0) {
        sql.exec(
          'DELETE FROM locks WHERE agent_id IN (SELECT agent_id FROM members WHERE owner_id = ?)',
          agentId,
        );
        sql.exec(
          'DELETE FROM activities WHERE agent_id IN (SELECT agent_id FROM members WHERE owner_id = ?)',
          agentId,
        );
        sql.exec('DELETE FROM members WHERE owner_id = ?', agentId);
      }
    }
    return { ok: true };
  });
}

/** Bump an agent's heartbeat timestamp. */
export function heartbeat(sql: SqlStorage, resolvedAgentId: string): DOResult<{ ok: true }> {
  sql.exec(
    "UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?",
    resolvedAgentId,
  );
  if (sqlChanges(sql) === 0) return { error: 'Not a member of this team', code: 'NOT_MEMBER' };
  return { ok: true };
}
