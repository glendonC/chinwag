// Team membership routes — join, leave, heartbeat, context.

import { checkContent } from '../../moderation.js';
import { getLobby, rpc } from '../../lib/env.js';
import { json } from '../../lib/http.js';
import { teamRoute, doResult } from '../../lib/middleware.js';
import { teamErrorStatus } from '../../lib/request-utils.js';
import { createLogger } from '../../lib/logger.js';
import { withRateLimit } from '../../lib/validation.js';
import { auditLog } from '../../lib/audit.js';
import { RATE_LIMIT_JOINS, MAX_NAME_LENGTH } from '../../lib/constants.js';

const log = createLogger('routes.membership');

// handleTeamJoin uses custom body parsing (name is optional, body may be empty)
// so it uses teamRoute instead of teamJsonRoute.
export const handleTeamJoin = teamRoute(
  async ({ request, user, env, teamId, db, agentId, runtime, team }) => {
    let name: string | null = null;
    try {
      const body: Record<string, unknown> = await request.json();
      if (typeof body.name === 'string') {
        const trimmed = body.name.trim();
        if (trimmed.length > MAX_NAME_LENGTH) {
          return json({ error: `Team name must be ${MAX_NAME_LENGTH} characters or less` }, 400);
        }
        name = trimmed || null;
      }
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

    return withRateLimit(
      db,
      `join:${user.id}`,
      RATE_LIMIT_JOINS,
      'Team join limit reached (100/day). Try again tomorrow.',
      async () => {
        const result = rpc(await team.join(agentId, user.id, user.handle, runtime));
        if ('error' in result) {
          auditLog('team.join', {
            actor: user.handle,
            outcome: 'failure',
            meta: { team_id: teamId, reason: result.error },
          });
          return json({ error: result.error }, 400);
        }

        await db.addUserTeam(user.id, teamId, name);

        auditLog('team.join', {
          actor: user.handle,
          outcome: 'success',
          meta: { team_id: teamId, agent_id: agentId },
        });
        return json(result);
      },
    );
  },
);

export const handleTeamLeave = teamRoute(async ({ user, teamId, db, agentId, team }) => {
  const result = rpc(await team.leave(agentId, user.id));
  if ('error' in result) {
    auditLog('team.leave', {
      actor: user.handle,
      outcome: 'failure',
      meta: { team_id: teamId, reason: result.error },
    });
    return json({ error: result.error }, 400);
  }
  auditLog('team.leave', {
    actor: user.handle,
    outcome: 'success',
    meta: { team_id: teamId, agent_id: agentId },
  });

  await db.removeUserTeam(user.id, teamId);

  return json(result);
});

export const handleTeamContext = teamRoute(async ({ user, teamId, db, agentId, team }) => {
  const result = rpc(await team.getContext(agentId, user.id));
  if ('error' in result) {
    log.warn(`getContext failed: ${result.error}`);
    return json({ error: result.error }, teamErrorStatus(result));
  }

  await db.addUserTeam(user.id, teamId);

  return json(result);
});

export const handleTeamHeartbeat = teamRoute(async ({ request, env, agentId, team, user }) => {
  // Also populate global presence so CLI/MCP sessions — not just web dashboard
  // viewers — show up in /stats (online count + countries map). Country comes
  // from Cloudflare's edge geolocation, same source as /presence/heartbeat.
  // Fire-and-forget: a lobby write failure must not break the team heartbeat.
  const country = request.headers.get('CF-IPCountry') || null;
  getLobby(env)
    .heartbeat(user.handle, country)
    .catch(() => {});
  return doResult(team.heartbeat(agentId, user.id), 'heartbeat');
});

export const handleTeamWebSocket = teamRoute(async ({ request, user, agentId, team }) => {
  const wsUrl = new URL(request.url);
  wsUrl.pathname = '/ws';
  wsUrl.searchParams.delete('token');
  wsUrl.searchParams.delete('ticket');
  wsUrl.searchParams.set('agentId', agentId);
  wsUrl.searchParams.set('ownerId', user.id);

  return team.fetch(
    new Request(wsUrl.toString(), {
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
