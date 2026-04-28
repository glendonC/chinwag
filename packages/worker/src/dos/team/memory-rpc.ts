// Memory RPC bodies extracted from TeamDO.
//
// Save / search / update / delete plus batch delete for shared project memory.
// searchMemories carries non-trivial side effects: telemetry counters, active
// time bumping, and per-session search-hit accounting - kept verbatim here.

import type { DOResult, DOError } from '../../types.js';
import {
  saveMemory as saveMemoryFn,
  searchMemories as searchMemoriesFn,
  updateMemory as updateMemoryFn,
  deleteMemory as deleteMemoryFn,
  deleteMemoriesBatch as deleteMemoriesBatchFn,
  type SearchFilters,
  type BatchDeleteFilter,
} from './memory.js';
import { bumpActiveTime } from './sessions.js';
import { METRIC_KEYS } from '../../lib/constants.js';
import type { RpcCtx } from './rpc-ctx.js';

export async function rpcSaveMemory(
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
): Promise<ReturnType<typeof saveMemoryFn> | DOError> {
  // DUPLICATE results carry `error: string`, so #op's isDOError guard skips
  // the broadcast for them automatically - no explicit filter needed here.
  return ctx.op(
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
        ctx.boundRecordMetric,
        ctx.transact,
        textHash,
        embedding,
      ),
    {
      broadcast: () => ({ type: 'memory', text, tags }),
    },
  );
}

export async function rpcSearchMemories(
  ctx: RpcCtx,
  agentId: string,
  query: string | null,
  tags: string[] | null,
  categories: string[] | null = null,
  limit = 20,
  ownerId: string | null = null,
  filters: Omit<SearchFilters, 'query' | 'tags' | 'categories' | 'limit'> = {},
): Promise<ReturnType<typeof searchMemoriesFn> | DOError> {
  return ctx.withMember(agentId, ownerId, (resolved) => {
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

export async function rpcUpdateMemory(
  ctx: RpcCtx,
  agentId: string,
  memoryId: string,
  text: string | undefined,
  tags: string[] | undefined,
  ownerId: string | null = null,
): Promise<DOResult<{ ok: true }> | DOError> {
  return ctx.withMember(agentId, ownerId, (resolved) =>
    updateMemoryFn(ctx.sql, resolved, memoryId, text, tags),
  );
}

export async function rpcDeleteMemory(
  ctx: RpcCtx,
  agentId: string,
  memoryId: string,
  ownerId: string | null = null,
): Promise<DOResult<{ ok: true }> | DOError> {
  return ctx.withMember(agentId, ownerId, () => deleteMemoryFn(ctx.sql, memoryId));
}

export async function rpcDeleteMemoriesBatch(
  ctx: RpcCtx,
  agentId: string,
  filter: BatchDeleteFilter,
  ownerId: string | null = null,
): Promise<DOResult<{ ok: true; deleted: number }> | DOError> {
  return ctx.withMember(agentId, ownerId, () =>
    deleteMemoriesBatchFn(ctx.sql, filter, ctx.transact),
  );
}
