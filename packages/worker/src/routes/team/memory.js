// Team memory routes — save, search, update, delete memory.

import { isBlocked } from '../../moderation.js';
import { getDB, getTeam } from '../../lib/env.js';
import { json, parseBody } from '../../lib/http.js';
import { getAgentRuntime, teamErrorStatus } from '../../lib/request-utils.js';
import {
  requireJson,
  requireString,
  validateTagsArray,
  withRateLimit,
  withTeamRateLimit,
} from '../../lib/validation.js';
import {
  MAX_MEMORY_TEXT_LENGTH,
  MAX_TAGS_PER_MEMORY,
  RATE_LIMIT_MEMORIES,
  RATE_LIMIT_MEMORY_UPDATES,
  RATE_LIMIT_MEMORY_DELETES,
  MEMORY_SEARCH_DEFAULT_LIMIT,
  MEMORY_SEARCH_MAX_LIMIT,
  MEMORY_SEARCH_MAX_TAGS,
} from '../../lib/constants.js';

export async function handleTeamSaveMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const text = requireString(body, 'text');
  if (!text) return json({ error: 'text is required' }, 400);
  if (text.length > MAX_MEMORY_TEXT_LENGTH)
    return json({ error: `text must be ${MAX_MEMORY_TEXT_LENGTH} characters or less` }, 400);
  if (isBlocked(text)) return json({ error: 'Content blocked' }, 400);

  const tagsResult = validateTagsArray(body.tags, MAX_TAGS_PER_MEMORY);
  if (tagsResult.error) return json({ error: tagsResult.error }, 400);
  const tags = /** @type {string[]} */ (tagsResult.tags);
  // Moderation: check tag content (tags are user-visible, persistent)
  if (tags.some((t) => isBlocked(t))) return json({ error: 'Content blocked' }, 400);

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
      team.saveMemory(agentId, text, tags, user.handle, runtime, user.id),
  });
}

export async function handleTeamSearchMemory(request, user, env, teamId) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') || null;
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

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.searchMemories(agentId, query, tags, limit, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result));
  return json(result);
}

export async function handleTeamUpdateMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const id = requireString(body, 'id');
  if (!id) return json({ error: 'id is required' }, 400);

  let text;
  if (body.text !== undefined) {
    text = requireString(body, 'text');
    if (!text) return json({ error: 'text must be a non-empty string' }, 400);
    if (text.length > MAX_MEMORY_TEXT_LENGTH)
      return json({ error: `text must be ${MAX_MEMORY_TEXT_LENGTH} characters or less` }, 400);
  }
  // Moderation: sync blocklist on updated text (same pattern as save)
  if (text !== undefined && isBlocked(text)) return json({ error: 'Content blocked' }, 400);

  let tags = body.tags;
  if (tags !== undefined) {
    const tagsResult = validateTagsArray(tags, MAX_TAGS_PER_MEMORY);
    if (tagsResult.error) return json({ error: tagsResult.error }, 400);
    tags = tagsResult.tags;
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
}

export async function handleTeamDeleteMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

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
}
