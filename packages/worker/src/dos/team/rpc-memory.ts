import type { DOError, DOResult } from '../../types.js';
import { METRIC_KEYS } from '../../lib/constants.js';
import {
  saveMemory as saveMemoryFn,
  searchMemories as searchMemoriesFn,
  updateMemory as updateMemoryFn,
  deleteMemory as deleteMemoryFn,
  deleteMemoriesBatch as deleteMemoriesBatchFn,
  type SearchFilters,
  type BatchDeleteFilter,
} from './memory.js';
import {
  consolidateMemories as consolidateMemoriesFn,
  listConsolidationProposals as listConsolidationProposalsFn,
  applyConsolidationProposal as applyConsolidationProposalFn,
  rejectConsolidationProposal as rejectConsolidationProposalFn,
  unmergeMemory as unmergeMemoryFn,
} from './consolidation.js';
import {
  runFormationPass as runFormationPassFn,
  runFormationOnRecent as runFormationOnRecentFn,
  listFormationObservations as listFormationObservationsFn,
  type FormationRecommendation,
} from './formation.js';
import { bumpActiveTime } from './sessions.js';
import { type RpcCtx, op, withMember } from './rpc-context.js';

export function saveMemoryRpc(
  ctx: RpcCtx,
  agentId: string,
  text: string,
  tags: string[],
  categories: string[] | null = null,
  handle: string,
  runtime: Record<string, unknown> | null = null,
  ownerId: string | null = null,
  textHash: string | null = null,
  embedding: ArrayBuffer | null = null,
): ReturnType<typeof saveMemoryFn> | DOError {
  // DUPLICATE results carry `error: string`, so op's isDOError guard skips
  // the broadcast for them automatically — no explicit filter needed.
  return op(
    ctx,
    agentId,
    ownerId,
    (resolved) =>
      saveMemoryFn(
        ctx.sql,
        resolved,
        text,
        tags,
        categories,
        handle,
        runtime,
        ctx.recordMetric,
        ctx.transact,
        textHash,
        embedding,
      ),
    {
      broadcast: () => ({ type: 'memory', text, tags }),
    },
  );
}

export function searchMemoriesRpc(
  ctx: RpcCtx,
  agentId: string,
  query: string | null,
  tags: string[] | null,
  categories: string[] | null = null,
  limit = 20,
  ownerId: string | null = null,
  filters: Omit<SearchFilters, 'query' | 'tags' | 'categories' | 'limit'> = {},
): ReturnType<typeof searchMemoriesFn> | DOError {
  return withMember(ctx, agentId, ownerId, (resolved) => {
    const result = searchMemoriesFn(ctx.sql, { query, tags, categories, limit, ...filters });
    ctx.recordMetric(METRIC_KEYS.MEMORIES_SEARCHED);
    // Bump active_min on memory searches too. An agent doing pure research
    // (grep memory, read, grep memory, read) would otherwise register zero
    // active time even though it's working.
    bumpActiveTime(ctx.sql, resolved);
    // Increment per-session memory search counter
    ctx.sql.exec(
      `UPDATE sessions SET memories_searched = memories_searched + 1 WHERE agent_id = ? AND ended_at IS NULL`,
      resolved,
    );
    if ('ok' in result && result.memories && result.memories.length > 0) {
      ctx.recordMetric(METRIC_KEYS.MEMORIES_SEARCH_HITS);
      ctx.sql.exec(
        `UPDATE sessions SET memories_search_hits = memories_search_hits + 1 WHERE agent_id = ? AND ended_at IS NULL`,
        resolved,
      );
    }
    return result;
  });
}

export function updateMemoryRpc(
  ctx: RpcCtx,
  agentId: string,
  memoryId: string,
  text: string | undefined,
  tags: string[] | undefined,
  ownerId: string | null = null,
): DOResult<{ ok: true }> | DOError {
  return withMember(ctx, agentId, ownerId, (resolved) =>
    updateMemoryFn(ctx.sql, resolved, memoryId, text, tags),
  );
}

export function deleteMemoryRpc(
  ctx: RpcCtx,
  agentId: string,
  memoryId: string,
  ownerId: string | null = null,
): DOResult<{ ok: true }> | DOError {
  return withMember(ctx, agentId, ownerId, () => deleteMemoryFn(ctx.sql, memoryId));
}

export function deleteMemoriesBatchRpc(
  ctx: RpcCtx,
  agentId: string,
  filter: BatchDeleteFilter,
  ownerId: string | null = null,
): DOResult<{ ok: true; deleted: number }> | DOError {
  return withMember(ctx, agentId, ownerId, () =>
    deleteMemoriesBatchFn(ctx.sql, filter, ctx.transact),
  );
}

// -- Consolidation (review queue, propose-only, reversible) --

export function runConsolidationRpc(ctx: RpcCtx): ReturnType<typeof consolidateMemoriesFn> {
  return consolidateMemoriesFn(ctx.sql);
}

export function listConsolidationProposalsRpc(
  ctx: RpcCtx,
  agentId: string,
  limit: number = 50,
  ownerId: string | null = null,
): ReturnType<typeof listConsolidationProposalsFn> | DOError {
  return withMember(ctx, agentId, ownerId, () => listConsolidationProposalsFn(ctx.sql, limit));
}

export function applyConsolidationProposalRpc(
  ctx: RpcCtx,
  agentId: string,
  proposalId: string,
  reviewerHandle: string,
  ownerId: string | null = null,
): ReturnType<typeof applyConsolidationProposalFn> | DOError {
  return withMember(ctx, agentId, ownerId, () =>
    applyConsolidationProposalFn(ctx.sql, proposalId, reviewerHandle),
  );
}

export function rejectConsolidationProposalRpc(
  ctx: RpcCtx,
  agentId: string,
  proposalId: string,
  reviewerHandle: string,
  ownerId: string | null = null,
): ReturnType<typeof rejectConsolidationProposalFn> | DOError {
  return withMember(ctx, agentId, ownerId, () =>
    rejectConsolidationProposalFn(ctx.sql, proposalId, reviewerHandle),
  );
}

export function unmergeMemoryRpc(
  ctx: RpcCtx,
  agentId: string,
  memoryId: string,
  ownerId: string | null = null,
): ReturnType<typeof unmergeMemoryFn> | DOError {
  return withMember(ctx, agentId, ownerId, () => unmergeMemoryFn(ctx.sql, memoryId));
}

// -- Formation (shadow-mode auditor: classifies but never applies) --

export async function runFormationOnRecentRpc(
  ctx: RpcCtx,
  limit: number = 20,
): Promise<{ ok: true; processed: number; skipped: number }> {
  const result = await runFormationOnRecentFn(ctx.sql, ctx.env, limit);
  return { ok: true, ...result };
}

export async function runFormationOnMemoryRpc(
  ctx: RpcCtx,
  memoryId: string,
): Promise<{ ok: true }> {
  await runFormationPassFn(ctx.sql, ctx.env, memoryId);
  return { ok: true };
}

export function listFormationObservationsRpc(
  ctx: RpcCtx,
  agentId: string,
  filter: { recommendation?: FormationRecommendation; limit?: number } = {},
  ownerId: string | null = null,
): ReturnType<typeof listFormationObservationsFn> | DOError {
  return withMember(ctx, agentId, ownerId, () => listFormationObservationsFn(ctx.sql, filter));
}
