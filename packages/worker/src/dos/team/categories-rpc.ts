// Memory category RPC bodies extracted from TeamDO.
//
// Category CRUD plus two specialized reads: getCategoryNames (lightweight
// for autocomplete) and getPromotableTags (frequency-threshold picker that
// surfaces hashtags worth promoting to first-class categories).

import type { DOResult, DOError } from '../../types.js';
import {
  createCategory as createCategoryFn,
  listCategories as listCategoriesFn,
  updateCategory as updateCategoryFn,
  deleteCategory as deleteCategoryFn,
  getCategoryNames as getCategoryNamesFn,
  getPromotableTags as getPromotableTagsFn,
} from './categories.js';
import type { RpcCtx } from './rpc-ctx.js';

export async function rpcCreateCategory(
  ctx: RpcCtx,
  agentId: string,
  name: string,
  description: string,
  color: string | null = null,
  embedding: ArrayBuffer | null = null,
  ownerId: string | null = null,
): Promise<DOResult<{ ok: true; id: string }> | DOError> {
  return ctx.withMember(agentId, ownerId, () =>
    createCategoryFn(ctx.sql, name, description, color, embedding),
  );
}

export async function rpcListCategories(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string | null = null,
): Promise<ReturnType<typeof listCategoriesFn> | DOError> {
  return ctx.withMember(agentId, ownerId, () => listCategoriesFn(ctx.sql));
}

export async function rpcGetCategoryNames(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string | null = null,
): Promise<{ ok: true; names: string[] } | DOError> {
  return ctx.withMember(agentId, ownerId, () => ({
    ok: true as const,
    names: getCategoryNamesFn(ctx.sql),
  }));
}

export async function rpcUpdateCategory(
  ctx: RpcCtx,
  agentId: string,
  categoryId: string,
  name: string | undefined,
  description: string | undefined,
  color: string | undefined,
  embedding: ArrayBuffer | null | undefined,
  ownerId: string | null = null,
): Promise<DOResult<{ ok: true }> | DOError> {
  return ctx.withMember(agentId, ownerId, () =>
    updateCategoryFn(ctx.sql, categoryId, name, description, color, embedding),
  );
}

export async function rpcDeleteCategory(
  ctx: RpcCtx,
  agentId: string,
  categoryId: string,
  ownerId: string | null = null,
): Promise<DOResult<{ ok: true }> | DOError> {
  return ctx.withMember(agentId, ownerId, () => deleteCategoryFn(ctx.sql, categoryId));
}

export async function rpcGetPromotableTags(
  ctx: RpcCtx,
  agentId: string,
  threshold: number,
  ownerId: string | null = null,
): Promise<ReturnType<typeof getPromotableTagsFn> | DOError> {
  return ctx.withMember(agentId, ownerId, () => getPromotableTagsFn(ctx.sql, threshold));
}
