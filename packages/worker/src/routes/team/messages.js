// Team message routes — send and get messages.

import { isBlocked } from '../../moderation.js';
import { getDB, getTeam } from '../../lib/env.js';
import { json, parseBody } from '../../lib/http.js';
import { getAgentRuntime, teamErrorStatus } from '../../lib/request-utils.js';
import { requireJson, withRateLimit } from '../../lib/validation.js';
import { MAX_MESSAGE_LENGTH, RATE_LIMIT_MESSAGES } from '../../lib/constants.js';

export async function handleTeamSendMessage(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { text, target } = body;
  if (typeof text !== 'string' || !text.trim()) return json({ error: 'text is required' }, 400);
  if (text.length > MAX_MESSAGE_LENGTH) return json({ error: `text must be ${MAX_MESSAGE_LENGTH} characters or less` }, 400);
  if (isBlocked(text)) return json({ error: 'Content blocked' }, 400);
  if (target !== undefined && typeof target !== 'string') return json({ error: 'target must be a string' }, 400);

  const db = getDB(env);
  const runtime = getAgentRuntime(request, user);
  const agentId = runtime.agentId;
  const team = getTeam(env, teamId);

  return withRateLimit(db, `messages:${user.id}`, RATE_LIMIT_MESSAGES, 'Message limit reached (200/day). Try again tomorrow.', async () => {
    const result = await team.sendMessage(agentId, user.handle, runtime, text.trim(), target || null, user.id);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
    return json(result, 201);
  });
}

export async function handleTeamGetMessages(request, user, env, teamId) {
  const url = new URL(request.url);
  const since = url.searchParams.get('since') || null;

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getMessages(agentId, since, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}
