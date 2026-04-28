// Team memory category routes - CRUD for per-project categories.

import type { RouteDefinition } from '../../lib/router.js';
import { json } from '../../lib/http.js';
import { teamJsonRoute, teamRoute, doResult } from '../../lib/middleware.js';
import { requireString, withTeamRateLimit } from '../../lib/validation.js';
import { auditLog } from '../../lib/audit.js';
import { generateEmbedding } from '../../lib/ai.js';
import {
  MAX_CATEGORY_NAME_LENGTH,
  MAX_CATEGORY_DESCRIPTION_LENGTH,
  RATE_LIMIT_CATEGORIES,
  TAG_PROMOTION_THRESHOLD,
} from '../../lib/constants.js';

// -- Create category --

export const handleTeamCreateCategory = teamJsonRoute(
  async ({ body, user, env, teamId, request }) => {
    const name = requireString(body, 'name');
    if (!name) return json({ error: 'name is required' }, 400);
    if (name.length > MAX_CATEGORY_NAME_LENGTH)
      return json({ error: `name must be ${MAX_CATEGORY_NAME_LENGTH} characters or less` }, 400);

    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length > MAX_CATEGORY_DESCRIPTION_LENGTH)
      return json(
        { error: `description must be ${MAX_CATEGORY_DESCRIPTION_LENGTH} characters or less` },
        400,
      );

    const color = typeof body.color === 'string' ? body.color.trim() : null;

    // Generate embedding for the category description via Workers AI
    const textToEmbed = `${name}: ${description}`;
    const embedding = await generateEmbedding(textToEmbed, env.AI);

    return withTeamRateLimit({
      request,
      user,
      env,
      teamId,
      rateLimitKey: 'category',
      rateLimitMax: RATE_LIMIT_CATEGORIES,
      rateLimitMsg: 'Category limit reached (50/day). Try again tomorrow.',
      successStatus: 201,
      action: (team, agentId) =>
        team.createCategory(agentId, name, description, color, embedding, user.id),
    });
  },
);

// -- List categories --

export const handleTeamListCategories = teamRoute(async ({ agentId, team, user }) => {
  return doResult(team.listCategories(agentId, user.id), 'listCategories');
});

// -- Get category names (lightweight, for MCP tool enum) --

export const handleTeamCategoryNames = teamRoute(async ({ agentId, team, user }) => {
  return doResult(team.getCategoryNames(agentId, user.id), 'getCategoryNames');
});

// -- Update category --

export const handleTeamUpdateCategory = teamJsonRoute(
  async ({ body, user, env, teamId, request }) => {
    const id = requireString(body, 'id');
    if (!id) return json({ error: 'id is required' }, 400);

    let name: string | undefined;
    if (body.name !== undefined) {
      const parsed = requireString(body, 'name');
      if (!parsed) return json({ error: 'name must be a non-empty string' }, 400);
      name = parsed;
      if (name.length > MAX_CATEGORY_NAME_LENGTH)
        return json({ error: `name must be ${MAX_CATEGORY_NAME_LENGTH} characters or less` }, 400);
    }

    let description: string | undefined;
    if (body.description !== undefined) {
      description = typeof body.description === 'string' ? body.description.trim() : '';
      if (description.length > MAX_CATEGORY_DESCRIPTION_LENGTH)
        return json(
          { error: `description must be ${MAX_CATEGORY_DESCRIPTION_LENGTH} characters or less` },
          400,
        );
    }

    const color =
      body.color !== undefined
        ? typeof body.color === 'string'
          ? body.color.trim()
          : undefined
        : undefined;

    if (name === undefined && description === undefined && color === undefined) {
      return json({ error: 'name, description, or color required' }, 400);
    }

    // Re-embed if name or description changed
    let embedding: ArrayBuffer | null | undefined;
    if (name !== undefined || description !== undefined) {
      const textToEmbed = `${name || ''}: ${description || ''}`;
      embedding = await generateEmbedding(textToEmbed, env.AI);
    }

    return withTeamRateLimit({
      request,
      user,
      env,
      teamId,
      rateLimitKey: 'category',
      rateLimitMax: RATE_LIMIT_CATEGORIES,
      rateLimitMsg: 'Category limit reached (50/day). Try again tomorrow.',
      action: (team, agentId) =>
        team.updateCategory(agentId, id, name, description, color, embedding, user.id),
    });
  },
);

// -- Delete category --

export const handleTeamDeleteCategory = teamJsonRoute(
  async ({ body, user, env, teamId, request }) => {
    const id = requireString(body, 'id');
    if (!id) return json({ error: 'id is required' }, 400);

    return withTeamRateLimit({
      request,
      user,
      env,
      teamId,
      rateLimitKey: 'category',
      rateLimitMax: RATE_LIMIT_CATEGORIES,
      rateLimitMsg: 'Category limit reached (50/day). Try again tomorrow.',
      action: async (team, agentId) => {
        const result = await team.deleteCategory(agentId, id, user.id);
        auditLog('team.category.delete', {
          actor: user.handle,
          actor_id: user.id,
          team_id: teamId,
          resource_id: id,
          outcome: 'error' in result ? 'failure' : 'success',
        });
        return result;
      },
    });
  },
);

// -- Get promotable tags --

export const handleTeamPromotableTags = teamRoute(async ({ agentId, team, user }) => {
  return doResult(
    team.getPromotableTags(agentId, TAG_PROMOTION_THRESHOLD, user.id),
    'getPromotableTags',
  );
});

/**
 * Per-team memory category CRUD plus tag promotion helpers.
 */
export function registerCategoriesRoutes(TID: string): RouteDefinition[] {
  return [
    { method: 'POST', path: `/teams/${TID}/categories`, handler: handleTeamCreateCategory },
    { method: 'GET', path: `/teams/${TID}/categories`, handler: handleTeamListCategories },
    { method: 'GET', path: `/teams/${TID}/categories/names`, handler: handleTeamCategoryNames },
    { method: 'PUT', path: `/teams/${TID}/categories`, handler: handleTeamUpdateCategory },
    { method: 'DELETE', path: `/teams/${TID}/categories`, handler: handleTeamDeleteCategory },
    { method: 'GET', path: `/teams/${TID}/tags/promotable`, handler: handleTeamPromotableTags },
  ];
}
