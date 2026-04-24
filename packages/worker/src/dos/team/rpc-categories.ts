import type { DOError, DOResult } from '../../types.js';
import {
  createCategory as createCategoryFn,
  listCategories as listCategoriesFn,
  updateCategory as updateCategoryFn,
  deleteCategory as deleteCategoryFn,
  getCategoryNames as getCategoryNamesFn,
  getPromotableTags as getPromotableTagsFn,
} from './categories.js';
import { type RpcCtx, withMember } from './rpc-context.js';

export function createCategoryRpc(
  ctx: RpcCtx,
  agentId: string,
  name: string,
  description: string,
  color: string | null = null,
  embedding: ArrayBuffer | null = null,
  ownerId: string | null = null,
): DOResult<{ ok: true; id: string }> | DOError {
  return withMember(ctx, agentId, ownerId, () =>
    createCategoryFn(ctx.sql, name, description, color, embedding),
  );
}

export function listCategoriesRpc(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string | null = null,
): ReturnType<typeof listCategoriesFn> | DOError {
  return withMember(ctx, agentId, ownerId, () => listCategoriesFn(ctx.sql));
}

export function getCategoryNamesRpc(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string | null = null,
): { ok: true; names: string[] } | DOError {
  return withMember(ctx, agentId, ownerId, () => ({
    ok: true as const,
    names: getCategoryNamesFn(ctx.sql),
  }));
}

export function updateCategoryRpc(
  ctx: RpcCtx,
  agentId: string,
  categoryId: string,
  name: string | undefined,
  description: string | undefined,
  color: string | undefined,
  embedding: ArrayBuffer | null | undefined,
  ownerId: string | null = null,
): DOResult<{ ok: true }> | DOError {
  return withMember(ctx, agentId, ownerId, () =>
    updateCategoryFn(ctx.sql, categoryId, name, description, color, embedding),
  );
}

export function deleteCategoryRpc(
  ctx: RpcCtx,
  agentId: string,
  categoryId: string,
  ownerId: string | null = null,
): DOResult<{ ok: true }> | DOError {
  return withMember(ctx, agentId, ownerId, () => deleteCategoryFn(ctx.sql, categoryId));
}

export function getPromotableTagsRpc(
  ctx: RpcCtx,
  agentId: string,
  threshold: number,
  ownerId: string | null = null,
): ReturnType<typeof getPromotableTagsFn> | DOError {
  return withMember(ctx, agentId, ownerId, () => getPromotableTagsFn(ctx.sql, threshold));
}
