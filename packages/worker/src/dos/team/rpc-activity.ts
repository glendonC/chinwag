import type { DOError, DOResult } from '../../types.js';
import {
  updateActivity as updateActivityFn,
  checkConflicts as checkConflictsFn,
  reportFile as reportFileFn,
} from './activity.js';
import { type RpcCtx, op, withMember } from './rpc-context.js';

export function updateActivityRpc(
  ctx: RpcCtx,
  agentId: string,
  files: string[],
  summary: string,
  ownerId: string | null = null,
): DOResult<{ ok: true }> | DOError {
  return op(
    ctx,
    agentId,
    ownerId,
    (resolved) => updateActivityFn(ctx.sql, resolved, files, summary, ctx.transact),
    {
      broadcast: (_r, resolved) => ({ type: 'activity', agent_id: resolved, files, summary }),
    },
  );
}

export function checkConflictsRpc(
  ctx: RpcCtx,
  agentId: string,
  files: string[],
  ownerId: string | null = null,
  source: 'hook' | 'advisory' = 'advisory',
): ReturnType<typeof checkConflictsFn> | DOError {
  return withMember(ctx, agentId, ownerId, (resolved) =>
    checkConflictsFn(
      ctx.sql,
      resolved,
      files,
      ctx.recordMetric,
      ctx.getConnectedAgentIds(),
      source,
    ),
  );
}

export function reportFileRpc(
  ctx: RpcCtx,
  agentId: string,
  filePath: string,
  ownerId: string | null = null,
): DOResult<{ ok: true }> | DOError {
  return op(
    ctx,
    agentId,
    ownerId,
    (resolved) => reportFileFn(ctx.sql, resolved, filePath, ctx.transact),
    {
      broadcast: (_r, resolved) => ({ type: 'file', agent_id: resolved, file: filePath }),
    },
  );
}
