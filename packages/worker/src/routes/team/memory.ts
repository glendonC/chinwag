// Team memory routes — save, search, update, delete memory.

import { checkContent, isBlocked } from '../../moderation.js';
import { json } from '../../lib/http.js';
import { teamJsonRoute, teamRoute, doResult } from '../../lib/middleware.js';
import { createLogger } from '../../lib/logger.js';
import { requireString, validateTagsArray, withTeamRateLimit } from '../../lib/validation.js';
import { generateEmbedding } from '../../lib/ai.js';
import {
  MAX_MEMORY_TEXT_LENGTH,
  MAX_TAGS_PER_MEMORY,
  RATE_LIMIT_MEMORIES,
  RATE_LIMIT_MEMORY_UPDATES,
  RATE_LIMIT_MEMORY_DELETES,
  MEMORY_SEARCH_DEFAULT_LIMIT,
  MEMORY_SEARCH_MAX_LIMIT,
  MEMORY_SEARCH_MAX_TAGS,
  MEMORY_SEARCH_MAX_QUERY_LENGTH,
} from '../../lib/constants.js';

const log = createLogger('routes.memory');

export const handleTeamSaveMemory = teamJsonRoute(async ({ body, user, env, teamId, request }) => {
  const text = requireString(body, 'text');
  if (!text) return json({ error: 'text is required' }, 400);
  if (text.length > MAX_MEMORY_TEXT_LENGTH)
    return json({ error: `text must be ${MAX_MEMORY_TEXT_LENGTH} characters or less` }, 400);

  // Validate tags before moderation — no point running AI on invalid input
  const tagsResult = validateTagsArray(body.tags, MAX_TAGS_PER_MEMORY);
  if (tagsResult.error) return json({ error: tagsResult.error }, 400);
  const tags = tagsResult.tags!;
  // Tags are short — blocklist is sufficient
  if (tags.some((t) => isBlocked(t))) return json({ error: 'Content blocked' }, 400);

  // Validate categories (string array, optional)
  let categories: string[] | null = null;
  if (body.categories !== undefined) {
    if (!Array.isArray(body.categories)) return json({ error: 'categories must be an array' }, 400);
    categories = body.categories.filter(
      (c: unknown): c is string => typeof c === 'string' && c.trim().length > 0,
    );
  }

  const modResult = await checkContent(text, env);
  if (modResult.blocked) {
    if (modResult.reason === 'moderation_unavailable') {
      log.warn('content moderation unavailable: blocking memory save as fail-safe');
      return json(
        { error: 'Content moderation is temporarily unavailable. Please try again.' },
        503,
      );
    }
    return json({ error: 'Content blocked' }, 400);
  }

  // Compute text hash for exact dedup (SHA-256 of normalized text)
  let textHash: string | null = null;
  try {
    const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
    const data = new TextEncoder().encode(normalized);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    textHash = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Non-critical — proceed without hash dedup
  }

  // Generate embedding for near-dedup (bge-small-en-v1.5, 384 dims)
  const embedding = await generateEmbedding(text, env.AI);

  return withTeamRateLimit({
    request,
    user,
    env,
    teamId,
    rateLimitKey: 'memory',
    rateLimitMax: RATE_LIMIT_MEMORIES,
    rateLimitMsg: 'Memory save limit reached (20/day). Try again tomorrow.',
    successStatus: 201,
    action: (team, agentId, runtime) =>
      team.saveMemory(
        agentId,
        text,
        tags,
        categories,
        user.handle,
        runtime,
        user.id,
        textHash,
        embedding,
      ),
  });
});

export const handleTeamSearchMemory = teamRoute(async ({ request, agentId, team, user }) => {
  const url = new URL(request.url);
  const rawQuery = url.searchParams.get('q') || null;
  if (rawQuery && rawQuery.length > MEMORY_SEARCH_MAX_QUERY_LENGTH) {
    return json(
      { error: `search query must be ${MEMORY_SEARCH_MAX_QUERY_LENGTH} characters or less` },
      400,
    );
  }
  const query = rawQuery;
  const parsedLimit = parseInt(
    url.searchParams.get('limit') || String(MEMORY_SEARCH_DEFAULT_LIMIT),
    10,
  );
  const limit = Math.max(
    1,
    Math.min(
      isNaN(parsedLimit) ? MEMORY_SEARCH_DEFAULT_LIMIT : parsedLimit,
      MEMORY_SEARCH_MAX_LIMIT,
    ),
  );

  const tagsParam = url.searchParams.get('tags');
  const tags = tagsParam
    ? tagsParam
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, MEMORY_SEARCH_MAX_TAGS)
    : null;

  const categoriesParam = url.searchParams.get('categories');
  const categories = categoriesParam
    ? categoriesParam
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
    : null;

  // Richer filters: session_id, agent_id, handle, date range
  const sessionId = url.searchParams.get('session_id') || null;
  const filterAgentId = url.searchParams.get('agent_id') || null;
  const filterHandle = url.searchParams.get('handle') || null;
  const after = url.searchParams.get('after') || null;
  const before = url.searchParams.get('before') || null;

  return doResult(
    team.searchMemories(agentId, query, tags, categories, limit, user.id, {
      sessionId,
      agentId: filterAgentId,
      handle: filterHandle,
      after,
      before,
    }),
    'searchMemories',
  );
});

export const handleTeamUpdateMemory = teamJsonRoute(
  async ({ body, user, env, teamId, request }) => {
    const id = requireString(body, 'id');
    if (!id) return json({ error: 'id is required' }, 400);

    let text: string | undefined;
    if (body.text !== undefined) {
      const parsed = requireString(body, 'text');
      if (!parsed) return json({ error: 'text must be a non-empty string' }, 400);
      if (parsed.length > MAX_MEMORY_TEXT_LENGTH)
        return json({ error: `text must be ${MAX_MEMORY_TEXT_LENGTH} characters or less` }, 400);
      text = parsed;
    }
    // Moderation: full AI check on updated text (same pattern as save)
    if (text !== undefined) {
      const modResult = await checkContent(text, env);
      if (modResult.blocked) {
        if (modResult.reason === 'moderation_unavailable') {
          log.warn('content moderation unavailable: blocking memory update as fail-safe');
          return json(
            { error: 'Content moderation is temporarily unavailable. Please try again.' },
            503,
          );
        }
        return json({ error: 'Content blocked' }, 400);
      }
    }

    let tags: string[] | undefined;
    if (body.tags !== undefined) {
      const tagsResult = validateTagsArray(body.tags, MAX_TAGS_PER_MEMORY);
      if (tagsResult.error) return json({ error: tagsResult.error }, 400);
      tags = tagsResult.tags!;
      // Moderation: check updated tag content
      if (tags.some((t) => isBlocked(t))) return json({ error: 'Content blocked' }, 400);
    }

    if (text === undefined && tags === undefined) {
      return json({ error: 'text or tags required' }, 400);
    }

    return withTeamRateLimit({
      request,
      user,
      env,
      teamId,
      rateLimitKey: 'memory_update',
      rateLimitMax: RATE_LIMIT_MEMORY_UPDATES,
      rateLimitMsg: 'Memory update limit reached (50/day). Try again tomorrow.',
      action: (team, agentId) => team.updateMemory(agentId, id, text, tags, user.id),
    });
  },
);

export const handleTeamDeleteMemory = teamJsonRoute(
  async ({ body, user, env, teamId, request }) => {
    const id = requireString(body, 'id');
    if (!id) return json({ error: 'id is required' }, 400);

    return withTeamRateLimit({
      request,
      user,
      env,
      teamId,
      rateLimitKey: 'memory_delete',
      rateLimitMax: RATE_LIMIT_MEMORY_DELETES,
      rateLimitMsg: 'Memory delete limit reached (50/day). Try again tomorrow.',
      action: (team, agentId) => team.deleteMemory(agentId, id, user.id),
    });
  },
);

export const handleTeamDeleteMemoryBatch = teamJsonRoute(
  async ({ body, user, env, teamId, request }) => {
    const filter: Record<string, unknown> = {};

    if (Array.isArray(body.ids)) {
      const ids = body.ids.filter((id: unknown): id is string => typeof id === 'string');
      if (ids.length === 0) return json({ error: 'ids array must not be empty' }, 400);
      if (ids.length > 100) return json({ error: 'Maximum 100 ids per batch delete' }, 400);
      filter.ids = ids;
    }
    if (Array.isArray(body.tags)) {
      filter.tags = body.tags.filter((t: unknown): t is string => typeof t === 'string');
    }
    if (typeof body.before === 'string') {
      filter.before = body.before;
    }

    if (!filter.ids && !filter.tags && !filter.before) {
      return json({ error: 'At least one filter required (ids, tags, or before)' }, 400);
    }

    return withTeamRateLimit({
      request,
      user,
      env,
      teamId,
      rateLimitKey: 'memory_delete',
      rateLimitMax: RATE_LIMIT_MEMORY_DELETES,
      rateLimitMsg: 'Memory delete limit reached (50/day). Try again tomorrow.',
      action: (team, agentId) => team.deleteMemoriesBatch(agentId, filter, user.id),
    });
  },
);
