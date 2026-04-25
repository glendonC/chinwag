// Messages RPC bodies extracted from TeamDO.
//
// Inter-agent messaging. sendMessage broadcasts a `message` event to
// watchers via the standard #op wrapper; getMessages is a per-caller read.

import type { DOError } from '../../types.js';
import { sendMessage as sendMessageFn, getMessages as getMessagesFn } from './messages.js';
import type { RpcCtx } from './rpc-ctx.js';

export async function rpcSendMessage(
  ctx: RpcCtx,
  agentId: string,
  handle: string,
  runtimeOrTool: string | Record<string, unknown> | null | undefined,
  text: string,
  targetAgent: string | null | undefined,
  ownerId: string | null = null,
): Promise<{ ok: true; id: string } | DOError> {
  return ctx.op(
    agentId,
    ownerId,
    (resolved) =>
      sendMessageFn(
        ctx.sql,
        resolved,
        handle,
        runtimeOrTool,
        text,
        targetAgent,
        ctx.boundRecordMetric,
      ),
    {
      broadcast: () => ({ type: 'message', from_handle: handle, text }),
    },
  );
}

export async function rpcGetMessages(
  ctx: RpcCtx,
  agentId: string,
  since: string | null | undefined,
  ownerId: string | null = null,
): Promise<ReturnType<typeof getMessagesFn> | DOError> {
  return ctx.withMember(agentId, ownerId, (resolved) => getMessagesFn(ctx.sql, resolved, since));
}
