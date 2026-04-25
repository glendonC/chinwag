// Formation RPC bodies extracted from TeamDO.
//
// Formation is the shadow-mode auditor: it classifies recent memories
// (consolidate? promote? leave alone?) and records observations but never
// applies them. The runFormation* methods are platform-invoked, the
// listFormationObservations method is the read API for review UIs.

import type { DOError } from '../../types.js';
import {
  runFormationPass as runFormationPassFn,
  runFormationOnRecent as runFormationOnRecentFn,
  listFormationObservations as listFormationObservationsFn,
  type FormationRecommendation,
} from './formation.js';
import type { RpcCtx } from './rpc-ctx.js';

export async function rpcRunFormationOnRecent(
  ctx: RpcCtx,
  limit: number = 20,
): Promise<{ ok: true; processed: number; skipped: number }> {
  const result = await runFormationOnRecentFn(ctx.sql, ctx.env, limit);
  return { ok: true, ...result };
}

export async function rpcRunFormationPass(ctx: RpcCtx, memoryId: string): Promise<{ ok: true }> {
  await runFormationPassFn(ctx.sql, ctx.env, memoryId);
  return { ok: true };
}

export async function rpcListFormationObservations(
  ctx: RpcCtx,
  agentId: string,
  filter: { recommendation?: FormationRecommendation; limit?: number } = {},
  ownerId: string | null = null,
): Promise<ReturnType<typeof listFormationObservationsFn> | DOError> {
  return ctx.withMember(agentId, ownerId, () => listFormationObservationsFn(ctx.sql, filter));
}
