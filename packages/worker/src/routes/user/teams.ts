// Team CRUD -- create team, list teams, chat upgrade.

import { checkContent } from '../../moderation.js';
import { getDB, getLobby, getTeam, rpc } from '../../lib/env.js';
import { json } from '../../lib/http.js';
import { createLogger } from '../../lib/logger.js';
import { getAgentRuntime } from '../../lib/request-utils.js';
import { withRateLimit } from '../../lib/validation.js';
import { authedRoute } from '../../lib/middleware.js';
import { auditLog } from '../../lib/audit.js';
import { withDORetry } from '../../lib/cross-do.js';
import { RATE_LIMIT_TEAMS, CHAT_COOLDOWN_MS, MAX_NAME_LENGTH } from '../../lib/constants.js';

const log = createLogger('routes.user.teams');

export const handleGetUserTeams = authedRoute(async ({ user, env }) => {
  const result = rpc(await getDB(env).getUserTeams(user.id));
  return json({ ok: true, teams: result.teams });
});

export const handleChatUpgrade = authedRoute(async ({ request, user, env }) => {
  const accountAge = Date.now() - new Date(user.created_at).getTime();
  if (accountAge < CHAT_COOLDOWN_MS) {
    const secsLeft = Math.ceil((CHAT_COOLDOWN_MS - accountAge) / 1000);
    return json(
      { error: `New accounts must wait before joining chat. ${secsLeft}s remaining.` },
      429,
    );
  }

  const lobby = getLobby(env);
  const shuffle = new URL(request.url).searchParams.get('shuffle') === '1';
  const { roomId } = rpc(await lobby.assignRoom(user.handle, shuffle));

  const roomStub = env.ROOM.get(env.ROOM.idFromName(roomId));
  const roomUrl = new URL(request.url);
  roomUrl.pathname = '/ws';
  roomUrl.searchParams.set('handle', user.handle);
  roomUrl.searchParams.set('color', user.color);
  roomUrl.searchParams.set('roomId', roomId);

  return roomStub.fetch(
    new Request(roomUrl.toString(), {
      headers: {
        'X-Chinmeister-Verified': '1',
        Upgrade: request.headers.get('Upgrade') || '',
        Connection: request.headers.get('Connection') || '',
        'Sec-WebSocket-Key': request.headers.get('Sec-WebSocket-Key') || '',
        'Sec-WebSocket-Protocol': request.headers.get('Sec-WebSocket-Protocol') || '',
        'Sec-WebSocket-Version': request.headers.get('Sec-WebSocket-Version') || '',
      },
    }),
  );
});

export const handleCreateTeam = authedRoute(async ({ request, user, env }) => {
  let name: string | null = null;
  try {
    const body: Record<string, unknown> = await request.json();
    name =
      typeof body.name === 'string' ? body.name.slice(0, MAX_NAME_LENGTH).trim() || null : null;
  } catch {
    /* body may be empty or non-JSON — name stays null */
  }

  if (name) {
    const modResult = await checkContent(name, env);
    if (modResult.blocked) {
      if (modResult.reason === 'moderation_unavailable') {
        log.warn('content moderation unavailable: blocking content as fail-safe');
        return json(
          { error: 'Content moderation is temporarily unavailable. Please try again.' },
          503,
        );
      }
      return json({ error: 'Content blocked' }, 400);
    }
  }

  const db = getDB(env);

  return withRateLimit(
    db,
    `team:${user.id}`,
    RATE_LIMIT_TEAMS,
    'Team creation limit reached. Try again tomorrow.',
    async () => {
      const runtime = getAgentRuntime(request, user);
      const agentId = runtime.agentId;
      const teamId = 't_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const team = getTeam(env, teamId);
      const joinResult = rpc(await team.join(agentId, user.id, user.handle, runtime));
      if ('error' in joinResult) return json({ error: joinResult.error }, 500);

      await withDORetry(() => db.addUserTeam(user.id, teamId, name), {
        label: 'addUserTeam after team.join (create)',
      });

      auditLog('team.create', {
        actor: user.handle,
        outcome: 'success',
        meta: { team_id: teamId },
      });
      return json({ ok: true, team_id: teamId }, 201);
    },
  );
});
