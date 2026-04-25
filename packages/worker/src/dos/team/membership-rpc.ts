// Membership RPC bodies extracted from TeamDO.
//
// Pure functions over RpcCtx — see rpc-ctx.ts for the dependency shape.
// Class methods on TeamDO delegate here so the DO shell stays a thin facade
// over the hibernation-sensitive boundary.

import type { DOResult, DOError } from '../../types.js';
import { isDOError } from '../../lib/errors.js';
import { join, leave, heartbeat as heartbeatFn } from './membership.js';
import { normalizeRuntimeMetadata } from './runtime.js';
import { HEARTBEAT_BROADCAST_DEBOUNCE_MS } from '../../lib/constants.js';
import type { RpcCtx } from './rpc-ctx.js';

export async function rpcJoin(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string,
  ownerHandle: string,
  runtimeOrTool: string | Record<string, unknown> | null = 'unknown',
): Promise<DOResult<{ ok: true }>> {
  ctx.ensureSchema();
  const result = join(ctx.sql, agentId, ownerId, ownerHandle, runtimeOrTool, ctx.boundRecordMetric);
  if (!isDOError(result)) {
    const tool = normalizeRuntimeMetadata(runtimeOrTool, agentId).hostTool;
    ctx.broadcastToWatchers({
      type: 'member_joined',
      agent_id: agentId,
      handle: ownerHandle,
      tool: tool || 'unknown',
    });
  }
  return result;
}

export async function rpcLeave(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string | null = null,
): Promise<DOResult<{ ok: true }>> {
  ctx.ensureSchema();
  const result = leave(ctx.sql, agentId, ownerId, ctx.transact);
  if (!isDOError(result)) {
    ctx.lastHeartbeatBroadcast.delete(agentId);
    ctx.broadcastToWatchers({ type: 'member_left', agent_id: agentId });
  }
  return result;
}

export async function rpcHeartbeat(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string | null = null,
): Promise<DOResult<{ ok: true }> | DOError> {
  return ctx.withMember(agentId, ownerId, (resolved) => {
    const result = heartbeatFn(ctx.sql, resolved);
    if (!isDOError(result)) {
      const now = Date.now();
      const last = ctx.lastHeartbeatBroadcast.get(resolved) || 0;
      if (now - last >= HEARTBEAT_BROADCAST_DEBOUNCE_MS) {
        ctx.lastHeartbeatBroadcast.set(resolved, now);
        ctx.broadcastToWatchers(
          { type: 'heartbeat', agent_id: resolved, ts: now },
          { invalidateCache: false },
        );
      }
    }
    return result;
  });
}
