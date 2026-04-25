// Activity RPC bodies extracted from TeamDO.
//
// updateActivity / checkConflicts / reportFile are the write-side and
// read-side of the agent activity tracker. updateActivity and reportFile
// broadcast deltas to watchers; checkConflicts reads only.

import type { DOResult, DOError } from '../../types.js';
import {
  updateActivity as updateActivityFn,
  checkConflicts as checkConflictsFn,
  reportFile as reportFileFn,
} from './activity.js';
import type { RpcCtx } from './rpc-ctx.js';

export async function rpcUpdateActivity(
  ctx: RpcCtx,
  agentId: string,
  files: string[],
  summary: string,
  ownerId: string | null = null,
): Promise<DOResult<{ ok: true }> | DOError> {
  return ctx.op(
    agentId,
    ownerId,
    (resolved) => updateActivityFn(ctx.sql, resolved, files, summary, ctx.transact),
    {
      broadcast: (_r, resolved) => ({ type: 'activity', agent_id: resolved, files, summary }),
    },
  );
}

export async function rpcCheckConflicts(
  ctx: RpcCtx,
  agentId: string,
  files: string[],
  ownerId: string | null = null,
  source: 'hook' | 'advisory' = 'advisory',
): Promise<ReturnType<typeof checkConflictsFn> | DOError> {
  return ctx.withMember(agentId, ownerId, (resolved) =>
    checkConflictsFn(
      ctx.sql,
      resolved,
      files,
      ctx.boundRecordMetric,
      ctx.getConnectedAgentIds(),
      source,
    ),
  );
}

export async function rpcReportFile(
  ctx: RpcCtx,
  agentId: string,
  filePath: string,
  ownerId: string | null = null,
): Promise<DOResult<{ ok: true }> | DOError> {
  return ctx.op(
    agentId,
    ownerId,
    (resolved) => reportFileFn(ctx.sql, resolved, filePath, ctx.transact),
    {
      broadcast: (_r, resolved) => ({ type: 'file', agent_id: resolved, file: filePath }),
    },
  );
}
