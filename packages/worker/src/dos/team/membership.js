// Team membership — join, leave, heartbeat.
// Each function takes `sql` as the first parameter and operates on the members table.

import { normalizeRuntimeMetadata } from './runtime.js';

export function join(sql, agentId, ownerId, ownerHandle, runtimeOrTool, recordMetric) {
  const runtime = normalizeRuntimeMetadata(runtimeOrTool, agentId);
  // Prevent agent_id spoofing: reject if already claimed by a different user
  const existing = sql.exec('SELECT owner_id FROM members WHERE agent_id = ?', agentId).toArray();
  if (existing.length > 0 && existing[0].owner_id !== ownerId) {
    return { error: 'Agent ID already claimed by another user' };
  }

  sql.exec(
    `INSERT INTO members (agent_id, owner_id, owner_handle, tool, host_tool, agent_surface, transport, joined_at, last_heartbeat)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(agent_id) DO UPDATE SET
       owner_id = excluded.owner_id,
       owner_handle = excluded.owner_handle,
       tool = excluded.tool,
       host_tool = excluded.host_tool,
       agent_surface = excluded.agent_surface,
       transport = excluded.transport,
       last_heartbeat = datetime('now')`,
    agentId, ownerId, ownerHandle, runtime.tool, runtime.hostTool, runtime.agentSurface, runtime.transport
  );
  recordMetric('joins');
  recordMetric(`tool:${runtime.tool}`);
  recordMetric(`host:${runtime.hostTool}`);
  if (runtime.agentSurface) recordMetric(`surface:${runtime.agentSurface}`);
  if (runtime.transport) recordMetric(`transport:${runtime.transport}`);
  return { ok: true };
}

export function leave(sql, agentId, ownerId) {
  // Verify ownership before allowing leave
  if (ownerId) {
    const existing = sql.exec('SELECT owner_id FROM members WHERE agent_id = ?', agentId).toArray();
    if (existing.length > 0 && existing[0].owner_id !== ownerId) {
      return { error: 'Not your agent' };
    }
  }

  sql.exec('DELETE FROM locks WHERE agent_id = ?', agentId);
  sql.exec('DELETE FROM activities WHERE agent_id = ?', agentId);
  sql.exec('DELETE FROM members WHERE agent_id = ?', agentId);
  const changed = sql.exec('SELECT changes() as c').toArray();
  // Fallback: if specific agent_id not found, remove all agents for this owner
  // (handles legacy callers sending user UUID as agentId)
  if (changed[0].c === 0) {
    sql.exec('DELETE FROM locks WHERE agent_id IN (SELECT agent_id FROM members WHERE owner_id = ?)', agentId);
    sql.exec('DELETE FROM activities WHERE agent_id IN (SELECT agent_id FROM members WHERE owner_id = ?)', agentId);
    sql.exec('DELETE FROM members WHERE owner_id = ?', agentId);
  }
  return { ok: true };
}

export function heartbeat(sql, resolvedAgentId) {
  sql.exec("UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?", resolvedAgentId);
  const row = sql.exec('SELECT changes() as c').toArray();
  if (row[0].c === 0) return { error: 'Not a member of this team' };
  return { ok: true };
}
