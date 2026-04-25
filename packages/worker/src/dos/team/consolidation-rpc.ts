// Consolidation RPC bodies extracted from TeamDO.
//
// Memory consolidation is propose-only and reversible: a sweep generates
// proposals, reviewers apply or reject, and individual merges can be
// unmerged. runConsolidation is unguarded by intent — it's invoked by the
// platform, not the agent — so it bypasses #withMember.

import type { DOError } from '../../types.js';
import {
  consolidateMemories as consolidateMemoriesFn,
  listConsolidationProposals as listConsolidationProposalsFn,
  applyConsolidationProposal as applyConsolidationProposalFn,
  rejectConsolidationProposal as rejectConsolidationProposalFn,
  unmergeMemory as unmergeMemoryFn,
} from './consolidation.js';
import type { RpcCtx } from './rpc-ctx.js';

export async function rpcConsolidateMemories(
  ctx: RpcCtx,
): Promise<ReturnType<typeof consolidateMemoriesFn>> {
  return consolidateMemoriesFn(ctx.sql);
}

export async function rpcListConsolidationProposals(
  ctx: RpcCtx,
  agentId: string,
  limit: number = 50,
  ownerId: string | null = null,
): Promise<ReturnType<typeof listConsolidationProposalsFn> | DOError> {
  return ctx.withMember(agentId, ownerId, () => listConsolidationProposalsFn(ctx.sql, limit));
}

export async function rpcApplyConsolidationProposal(
  ctx: RpcCtx,
  agentId: string,
  proposalId: string,
  reviewerHandle: string,
  ownerId: string | null = null,
): Promise<ReturnType<typeof applyConsolidationProposalFn> | DOError> {
  return ctx.withMember(agentId, ownerId, () =>
    applyConsolidationProposalFn(ctx.sql, proposalId, reviewerHandle),
  );
}

export async function rpcRejectConsolidationProposal(
  ctx: RpcCtx,
  agentId: string,
  proposalId: string,
  reviewerHandle: string,
  ownerId: string | null = null,
): Promise<ReturnType<typeof rejectConsolidationProposalFn> | DOError> {
  return ctx.withMember(agentId, ownerId, () =>
    rejectConsolidationProposalFn(ctx.sql, proposalId, reviewerHandle),
  );
}

export async function rpcUnmergeMemory(
  ctx: RpcCtx,
  agentId: string,
  memoryId: string,
  ownerId: string | null = null,
): Promise<ReturnType<typeof unmergeMemoryFn> | DOError> {
  return ctx.withMember(agentId, ownerId, () => unmergeMemoryFn(ctx.sql, memoryId));
}
