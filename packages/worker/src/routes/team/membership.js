// Team membership routes — join, leave, heartbeat, context.

import { isBlocked } from '../../moderation.js';
import { getDB, getTeam } from '../../lib/env.js';
import { json, parseBody } from '../../lib/http.js';
import { getAgentRuntime, teamErrorStatus } from '../../lib/request-utils.js';
import { sanitizeString, withRateLimit } from '../../lib/validation.js';
import { RATE_LIMIT_JOINS, MAX_NAME_LENGTH } from '../../lib/constants.js';

export async function handleTeamJoin(request, user, env, teamId) {
  // Body is optional for join — only extract name if valid JSON was provided
  const body = await parseBody(request);
  const name = body._parseError ? null : sanitizeString(body.name, MAX_NAME_LENGTH);
  // Moderation: team names are user-visible and persistent
  if (name && isBlocked(name)) return json({ error: 'Content blocked' }, 400);

  const db = getDB(env);
  const runtime = getAgentRuntime(request, user);
  const agentId = runtime.agentId;
  const team = getTeam(env, teamId);

  return withRateLimit(
    db,
    `join:${user.id}`,
    RATE_LIMIT_JOINS,
    'Team join limit reached (100/day). Try again tomorrow.',
    async () => {
      const result = await team.join(agentId, user.id, user.handle, runtime);
      if (result.error) return json({ error: result.error }, teamErrorStatus(result));

      let warning;
      try {
        await db.addUserTeam(user.id, teamId, name);
      } catch (err) {
        console.error(`[chinwag] Failed to sync joined team ${teamId} for user ${user.id}:`, err);
        warning = 'Team joined successfully, but team list sync failed';
      }

      return json(warning ? { ...result, warning } : result);
    },
  );
}

export async function handleTeamLeave(request, user, env, teamId) {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.leave(agentId, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result));

  const db = getDB(env);
  try {
    await db.removeUserTeam(user.id, teamId);
  } catch (err) {
    console.error(`[chinwag] Failed to remove team ${teamId} for user ${user.id}:`, err);
  }

  return json(result);
}

export async function handleTeamContext(request, user, env, teamId) {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getContext(agentId, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result));

  const db = getDB(env);
  try {
    await db.addUserTeam(user.id, teamId);
  } catch (err) {
    console.error(`[chinwag] Failed to backfill team ${teamId} for user ${user.id}:`, err);
  }

  return json(result);
}

export async function handleTeamHeartbeat(request, user, env, teamId) {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.heartbeat(agentId, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result));
  return json(result);
}

export async function handleTeamWebSocket(request, user, env, teamId) {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);

  const wsUrl = new URL(request.url);
  wsUrl.pathname = '/ws';
  wsUrl.searchParams.delete('token');
  wsUrl.searchParams.delete('ticket');
  wsUrl.searchParams.set('agentId', agentId);

  return team.fetch(
    new Request(wsUrl.toString(), {
      headers: {
        'X-Chinwag-Verified': '1',
        Upgrade: request.headers.get('Upgrade'),
        Connection: request.headers.get('Connection'),
        'Sec-WebSocket-Key': request.headers.get('Sec-WebSocket-Key'),
        'Sec-WebSocket-Protocol': request.headers.get('Sec-WebSocket-Protocol'),
        'Sec-WebSocket-Version': request.headers.get('Sec-WebSocket-Version'),
      },
    }),
  );
}
