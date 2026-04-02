// Team memory routes — save, search, update, delete memory.

import { isBlocked } from '../../moderation.js';
import { getDB, getTeam } from '../../lib/env.js';
import { json, parseBody } from '../../lib/http.js';
import { getAgentRuntime, teamErrorStatus } from '../../lib/request-utils.js';
import { requireJson, validateTagsArray, withRateLimit } from '../../lib/validation.js';
import {
  MAX_MEMORY_TEXT_LENGTH,
  MAX_TAGS_PER_MEMORY,
  RATE_LIMIT_MEMORIES,
  RATE_LIMIT_MEMORY_UPDATES,
  RATE_LIMIT_MEMORY_DELETES,
  MEMORY_SEARCH_DEFAULT_LIMIT,
  MEMORY_SEARCH_MAX_LIMIT,
} from '../../lib/constants.js';

export async function handleTeamSaveMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { text } = body;
  if (typeof text !== 'string' || !text.trim()) {
    return json({ error: 'text is required' }, 400);
  }
  if (text.length > MAX_MEMORY_TEXT_LENGTH) {
    return json({ error: `text must be ${MAX_MEMORY_TEXT_LENGTH} characters or less` }, 400);
  }
  if (isBlocked(text)) return json({ error: 'Content blocked' }, 400);

  const tagsResult = validateTagsArray(body.tags, MAX_TAGS_PER_MEMORY);
  if (tagsResult.error) return json({ error: tagsResult.error }, 400);
  const tags = tagsResult.tags;

  const db = getDB(env);
  const runtime = getAgentRuntime(request, user);
  const agentId = runtime.agentId;
  const team = getTeam(env, teamId);

  return withRateLimit(db, `memory:${user.id}`, RATE_LIMIT_MEMORIES, 'Memory save limit reached (20/day). Try again tomorrow.', async () => {
    const result = await team.saveMemory(agentId, text.trim(), tags, user.handle, runtime, user.id);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
    return json(result, 201);
  });
}

export async function handleTeamSearchMemory(request, user, env, teamId) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') || null;
  const parsedLimit = parseInt(url.searchParams.get('limit') || String(MEMORY_SEARCH_DEFAULT_LIMIT), 10);
  const limit = Math.max(1, Math.min(isNaN(parsedLimit) ? MEMORY_SEARCH_DEFAULT_LIMIT : parsedLimit, MEMORY_SEARCH_MAX_LIMIT));

  const tagsParam = url.searchParams.get('tags');
  const tags = tagsParam
    ? tagsParam.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    : null;

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.searchMemories(agentId, query, tags, limit, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

export async function handleTeamUpdateMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { id, text } = body;
  if (typeof id !== 'string' || !id.trim()) {
    return json({ error: 'id is required' }, 400);
  }
  if (text !== undefined && (typeof text !== 'string' || !text.trim())) {
    return json({ error: 'text must be a non-empty string' }, 400);
  }
  if (text !== undefined && text.length > MAX_MEMORY_TEXT_LENGTH) {
    return json({ error: `text must be ${MAX_MEMORY_TEXT_LENGTH} characters or less` }, 400);
  }

  let tags = body.tags;
  if (tags !== undefined) {
    const tagsResult = validateTagsArray(tags, MAX_TAGS_PER_MEMORY);
    if (tagsResult.error) return json({ error: tagsResult.error }, 400);
    tags = tagsResult.tags;
  }

  if (text === undefined && tags === undefined) {
    return json({ error: 'text or tags required' }, 400);
  }

  const db = getDB(env);
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);

  return withRateLimit(db, `memory_update:${user.id}`, RATE_LIMIT_MEMORY_UPDATES, 'Memory update limit reached (50/day). Try again tomorrow.', async () => {
    const result = await team.updateMemory(agentId, id, text, tags, user.id);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
    return json(result);
  });
}

export async function handleTeamDeleteMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { id } = body;
  if (typeof id !== 'string' || !id.trim()) {
    return json({ error: 'id is required' }, 400);
  }

  const db = getDB(env);
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);

  return withRateLimit(db, `memory_delete:${user.id}`, RATE_LIMIT_MEMORY_DELETES, 'Memory delete limit reached (50/day). Try again tomorrow.', async () => {
    const result = await team.deleteMemory(agentId, id, user.id);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
    return json(result);
  });
}
