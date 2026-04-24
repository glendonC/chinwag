import { isDOError } from '../../lib/errors.js';
import type { DOError } from '../../types.js';
import {
  submitCommand as submitCommandFn,
  getPendingCommands as getPendingCommandsFn,
} from './commands.js';
import { type RpcCtx, withMember } from './rpc-context.js';

export function submitCommandRpc(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string,
  senderHandle: string,
  type: string,
  payload: Record<string, unknown>,
): { ok: true; id: string; warning?: string } | DOError {
  return withMember(ctx, agentId, ownerId, () => {
    const result = submitCommandFn(ctx.sql, type, payload, ownerId, senderHandle, ctx.recordMetric);
    if (isDOError(result)) return result;

    // Executor broadcast first (daemon gets the command ASAP), then
    // watcher broadcast (dashboard animation). Order is load-bearing.
    ctx.broadcastToExecutors({
      type: 'command',
      id: result.id,
      command_type: type,
      payload,
    });
    ctx.broadcastToWatchers({
      type: 'command_status',
      id: result.id,
      status: 'pending',
      command_type: type,
      sender_handle: senderHandle,
    });

    const warning = ctx.hasExecutorConnected() ? undefined : 'no_executor_connected';
    return { ...result, ...(warning ? { warning } : {}) };
  });
}

export function getCommandsRpc(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string | null = null,
): ReturnType<typeof getPendingCommandsFn> | DOError {
  return withMember(ctx, agentId, ownerId, () => getPendingCommandsFn(ctx.sql));
}
