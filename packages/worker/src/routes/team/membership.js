// Team membership routes — join, leave, heartbeat, context.

import { checkContent } from '../../moderation.js';
import { getDB, getTeam } from '../../lib/env.js';
import { getErrorMessage } from '../../lib/errors.js';
import { json } from '../../lib/http.js';
import { createLogger } from '../../lib/logger.js';
import { getAgentRuntime, teamErrorStatus } from '../../lib/request-utils.js';
import { withRateLimit } from '../../lib/validation.js';
import { auditLog } from '../../lib/audit.js';
import { RATE_LIMIT_JOINS, MAX_NAME_LENGTH } from '../../lib/constants.js';

const log = createLogger('routes.membership');

export async function handleTeamJoin(request, user, env, teamId) {
  let name = null;
  try {
    const body = await request.json();
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
    if (modResult.degraded) {
      log.warn('content moderation degraded: AI layer unavailable, blocklist-only mode');
    }
    if (modResult.blocked) {
      return json({ error: 'Content blocked' }, 400);
    }
  }

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
      if (result.error) {
        auditLog('team.join', {
          actor: user.handle,
          outcome: 'failure',
          meta: { team_id: teamId, reason: result.error },
        });
        return json({ error: result.error }, 400);
      }

      const dbResult = await db.addUserTeam(user.id, teamId, name);
      if (dbResult.error) {
        log.error('failed to sync joined team', { teamId, userId: user.id, error: dbResult.error });
        // Roll back: leave the team since the DB record failed
        await team.leave(agentId, user.id).catch((err) => {
          log.error('rollback leave failed', { teamId, agentId, error: getErrorMessage(err) });
        });
        auditLog('team.join', {
          actor: user.handle,
          outcome: 'failure',
          meta: { team_id: teamId, reason: 'db_sync_failed' },
        });
        return json({ error: 'Failed to record team membership' }, 500);
      }

      auditLog('team.join', {
        actor: user.handle,
        outcome: 'success',
        meta: { team_id: teamId, agent_id: agentId },
      });
      return json(result);
    },
  );
}

export async function handleTeamLeave(request, user, env, teamId) {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.leave(agentId, user.id);
  if (result.error) {
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

  const db = getDB(env);
  const dbResult = await db.removeUserTeam(user.id, teamId);
  if (dbResult.error) {
    log.error('failed to remove team', { teamId, userId: user.id, error: dbResult.error });
    // The agent already left the team DO -- the DB record is stale but not critical.
    // Return success but log the inconsistency.
  }

  return json(result);
}

export async function handleTeamContext(request, user, env, teamId) {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getContext(agentId, user.id);
  if (result.error) return json({ error: result.error }, 403);

  const db = getDB(env);
  const dbResult = await db.addUserTeam(user.id, teamId);
  if (dbResult.error) {
    log.warn('failed to backfill team', { teamId, userId: user.id, error: dbResult.error });
    // Backfill failure is non-blocking — context was already retrieved successfully
  }

  return json(result);
}

export async function handleTeamHeartbeat(request, user, env, teamId) {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.heartbeat(agentId, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
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
  wsUrl.searchParams.set('ownerId', user.id);

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
