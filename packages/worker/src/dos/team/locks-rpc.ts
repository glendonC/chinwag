// File-lock RPC bodies extracted from TeamDO.
//
// claimFiles / releaseFiles broadcast lock_change deltas to watchers via
// the standard #op wrapper. checkFileConflicts is the read-only pre-edit
// check used by hooks. getLockedFiles is the dashboard read.

import type { DOError } from '../../types.js';
import {
  claimFiles as claimFilesFn,
  checkFileConflicts as checkFileConflictsFn,
  releaseFiles as releaseFilesFn,
  getLockedFiles as getLockedFilesFn,
} from './locks.js';
import type { RpcCtx } from './rpc-ctx.js';

export async function rpcClaimFiles(
  ctx: RpcCtx,
  agentId: string,
  files: string[],
  handle: string,
  runtimeOrTool: string | Record<string, unknown> | null | undefined,
  ownerId: string | null = null,
  options: { ttlSeconds?: number } = {},
): Promise<ReturnType<typeof claimFilesFn> | DOError> {
  return ctx.op(
    agentId,
    ownerId,
    (resolved) => claimFilesFn(ctx.sql, resolved, files, handle, runtimeOrTool, ownerId!, options),
    {
      broadcast: (_r, resolved) => ({
        type: 'lock_change',
        action: 'claim',
        agent_id: resolved,
        files,
      }),
    },
  );
}

/**
 * Read-only conflict check for a batch of concrete paths. Used by the
 * pre-commit hook and any would-be-editor that wants to know whether
 * proceeding would collide with a peer's lock (exact-path or glob
 * umbrella) without actually claiming. Globs in the input are skipped.
 */
export async function rpcCheckFileConflicts(
  ctx: RpcCtx,
  agentId: string,
  files: string[],
  ownerId: string | null = null,
): Promise<{ ok: true; blocked: ReturnType<typeof checkFileConflictsFn> } | DOError> {
  return ctx.withMember(agentId, ownerId, (resolved) => ({
    ok: true,
    blocked: checkFileConflictsFn(ctx.sql, resolved, files),
  }));
}

export async function rpcReleaseFiles(
  ctx: RpcCtx,
  agentId: string,
  files: string[] | null | undefined,
  ownerId: string | null = null,
): Promise<{ ok: true } | DOError> {
  return ctx.op(agentId, ownerId, (resolved) => releaseFilesFn(ctx.sql, resolved, files, ownerId), {
    broadcast: (_r, resolved) => ({
      type: 'lock_change',
      action: 'release',
      agent_id: resolved,
      files,
    }),
  });
}

export async function rpcGetLockedFiles(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string | null = null,
): Promise<ReturnType<typeof getLockedFilesFn> | DOError> {
  return ctx.withMember(agentId, ownerId, () =>
    getLockedFilesFn(ctx.sql, ctx.getConnectedAgentIds()),
  );
}
