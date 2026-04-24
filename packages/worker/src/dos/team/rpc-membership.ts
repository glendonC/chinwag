import { isDOError } from '../../lib/errors.js';
import type { DOError, DOResult } from '../../types.js';
import { join, leave } from './membership.js';
import { normalizeRuntimeMetadata } from './runtime.js';
import type { RpcCtx } from './rpc-context.js';

export function joinRpc(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string,
  ownerHandle: string,
  runtimeOrTool: string | Record<string, unknown> | null = 'unknown',
): DOResult<{ ok: true }> {
  ctx.ensureSchema();
  const result = join(ctx.sql, agentId, ownerId, ownerHandle, runtimeOrTool, ctx.recordMetric);
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

export function leaveRpc(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string | null = null,
): DOResult<{ ok: true }> {
  ctx.ensureSchema();
  const result = leave(ctx.sql, agentId, ownerId, ctx.transact);
  if (!isDOError(result)) {
    ctx.lastHeartbeatBroadcast.delete(agentId);
    ctx.broadcastToWatchers({ type: 'member_left', agent_id: agentId });
  }
  return result;
}

// heartbeat intentionally stays inline in the TeamDO class: it owns the
// #lastHeartbeatBroadcast debounce timestamps that three call sites touch
// (leave, heartbeat, webSocketClose). Routing it through RpcCtx would work
// but muddies the debounce semantics for no structural win. 20-line method.
export type { DOError };
