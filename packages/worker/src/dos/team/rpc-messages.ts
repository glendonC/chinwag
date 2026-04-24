import type { DOError } from '../../types.js';
import { sendMessage as sendMessageFn, getMessages as getMessagesFn } from './messages.js';
import { type RpcCtx, op, withMember } from './rpc-context.js';

export function sendMessageRpc(
  ctx: RpcCtx,
  agentId: string,
  handle: string,
  runtimeOrTool: string | Record<string, unknown> | null | undefined,
  text: string,
  targetAgent: string | null | undefined,
  ownerId: string | null = null,
): { ok: true; id: string } | DOError {
  return op(
    ctx,
    agentId,
    ownerId,
    (resolved) =>
      sendMessageFn(ctx.sql, resolved, handle, runtimeOrTool, text, targetAgent, ctx.recordMetric),
    {
      broadcast: () => ({ type: 'message', from_handle: handle, text }),
    },
  );
}

export function getMessagesRpc(
  ctx: RpcCtx,
  agentId: string,
  since: string | null | undefined,
  ownerId: string | null = null,
): ReturnType<typeof getMessagesFn> | DOError {
  return withMember(ctx, agentId, ownerId, (resolved) => getMessagesFn(ctx.sql, resolved, since));
}
