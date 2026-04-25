// Commands (daemon relay) RPC bodies extracted from TeamDO.
//
// submitCommand fans out two broadcasts (one to executors, one to watchers)
// and surfaces a `no_executor_connected` warning when no daemon is online.
// getCommands is the executor's read of the pending queue.

import type { DOError } from '../../types.js';
import { isDOError } from '../../lib/errors.js';
import {
  submitCommand as submitCommandFn,
  getPendingCommands as getPendingCommandsFn,
} from './commands.js';
import type { RpcCtx } from './rpc-ctx.js';

export async function rpcSubmitCommand(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string,
  senderHandle: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; id: string; warning?: string } | DOError> {
  return ctx.withMember(agentId, ownerId, () => {
    const result = submitCommandFn(
      ctx.sql,
      type,
      payload,
      ownerId,
      senderHandle,
      ctx.boundRecordMetric,
    );
    if (isDOError(result)) return result;

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

export async function rpcGetPendingCommands(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string | null = null,
): Promise<ReturnType<typeof getPendingCommandsFn> | DOError> {
  return ctx.withMember(agentId, ownerId, () => getPendingCommandsFn(ctx.sql));
}
