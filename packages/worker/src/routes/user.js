import { checkContent } from '../moderation.js';
import { getDB, getLobby, getTeam } from '../lib/env.js';
import { getErrorMessage } from '../lib/errors.js';
import { json, parseBody } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { getAgentRuntime, sanitizeTags } from '../lib/request-utils.js';
import { requireJson, withRateLimit } from '../lib/validation.js';
import { auditLog } from '../lib/audit.js';
import {
  MAX_STATUS_LENGTH,
  MAX_FRAMEWORK_LENGTH,
  RATE_LIMIT_TEAMS,
  RATE_LIMIT_TOKEN_REFRESH,
  RATE_LIMIT_WS_TICKETS,
  CHAT_COOLDOWN_MS,
  MAX_DASHBOARD_TEAMS,
  MAX_NAME_LENGTH,
  VALID_COLORS_SET,
} from '../lib/constants.js';

const log = createLogger('routes.user');

const DO_CALL_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('DO call timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function authenticate(request, env) {
  const auth = request.headers.get('Authorization');
  let token;
  if (auth?.startsWith('Bearer ')) {
    token = auth.slice(7);
  } else if (request.headers.get('Upgrade') === 'websocket') {
    const url = new URL(request.url);
    // Prefer ticket (short-lived, single-use) over token for WS auth
    const ticket = url.searchParams.get('ticket');
    if (ticket) {
      const kvKey = `ticket:${ticket}`;
      const userId = await env.AUTH_KV.get(kvKey);
      if (!userId) return null;
      await env.AUTH_KV.delete(kvKey);
      const db = getDB(env);
      if (!userId.includes('-')) {
        const result = await db.getUserByHandle(userId);
        return result.ok ? result.user : null;
      }
      const result = await db.getUser(userId);
      return result.ok ? result.user : null;
    }
  }
  if (!token) return null;

  const userId = await env.AUTH_KV.get(`token:${token}`);
  if (!userId) return null;

  const db = getDB(env);
  if (!userId.includes('-')) {
    const result = await db.getUserByHandle(userId);
    if (!result.ok) return null;
    const user = result.user;
    // Verify the looked-up user's handle still matches the KV entry.
    // Prevents auth bypass when a handle is reassigned to a different user:
    // stale KV entry "token:X -> oldHandle" would resolve to the new owner.
    if (user.handle !== userId) return null;
    await env.AUTH_KV.put(`token:${token}`, user.id);
    return user;
  }

  const result = await db.getUser(userId);
  if (result.ok) {
    auditLog('auth.success', {
      actor: result.user.handle,
      outcome: 'success',
      meta: { method: 'token' },
    });
    return result.user;
  }
  auditLog('auth.failure', { outcome: 'failure', meta: { reason: 'user_not_found' } });
  return null;
}

export async function handleRefreshToken(request, env) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const refreshToken = body?.refresh_token;
  if (!refreshToken || typeof refreshToken !== 'string') {
    return json({ error: 'refresh_token is required' }, 400);
  }

  if (!refreshToken.startsWith('rt_')) {
    return json({ error: 'Invalid refresh token format' }, 400);
  }

  const userId = await env.AUTH_KV.get(`refresh:${refreshToken}`);
  if (!userId) {
    return json({ error: 'Invalid or expired refresh token' }, 401);
  }

  // Rate limit token refresh per user to prevent token rotation abuse
  const db = getDB(env);
  return withRateLimit(
    db,
    `token-refresh:${userId}`,
    RATE_LIMIT_TOKEN_REFRESH,
    'Token refresh limit reached. Try again later.',
    async () => {
      // Invalidate the old refresh token (rotation)
      await env.AUTH_KV.delete(`refresh:${refreshToken}`);

      // Issue new access token
      const newToken = crypto.randomUUID();
      await env.AUTH_KV.put(`token:${newToken}`, userId);

      // Issue new refresh token
      const newRefreshToken = `rt_${crypto.randomUUID().replace(/-/g, '')}`;
      await env.AUTH_KV.put(`refresh:${newRefreshToken}`, userId, {
        expirationTtl: 30 * 24 * 60 * 60,
      });

      return json({ ok: true, token: newToken, refresh_token: newRefreshToken });
    },
  );
}

export async function handleGetWsTicket(user, env) {
  const db = getDB(env);
  return withRateLimit(
    db,
    `ws-ticket:${user.id}`,
    RATE_LIMIT_WS_TICKETS,
    'Ticket request limit reached. Try again later.',
    async () => {
      const ticket = `tk_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
      await env.AUTH_KV.put(`ticket:${ticket}`, user.id, { expirationTtl: 30 });
      return json({ ticket });
    },
  );
}

export async function handleUnlinkGithub(user, env) {
  const result = await getDB(env).unlinkGithub(user.id);
  return json(result);
}

export async function handleUpdateHandle(request, user, env) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { handle } = body;
  if (!handle || typeof handle !== 'string') {
    return json({ error: 'Handle is required' }, 400);
  }

  const modResult = await checkContent(handle, env);
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

  const result = await getDB(env).updateHandle(user.id, handle);
  if (result.error) {
    log.warn(`updateHandle failed: ${result.error}`);
    return json({ error: result.error }, 400);
  }

  return json(result);
}

export async function handleUpdateColor(request, user, env) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { color } = body;
  if (!color || typeof color !== 'string') {
    return json({ error: 'Color is required' }, 400);
  }
  if (!VALID_COLORS_SET.has(color)) {
    return json(
      { error: `Invalid color. Must be one of: ${[...VALID_COLORS_SET].join(', ')}` },
      400,
    );
  }

  const result = await getDB(env).updateColor(user.id, color);
  if (result.error) {
    log.warn(`updateColor failed: ${result.error}`);
    return json({ error: result.error }, 400);
  }

  return json(result);
}

export async function handleSetStatus(request, user, env) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { status } = body;
  if (!status || typeof status !== 'string') {
    return json({ error: 'Status is required' }, 400);
  }
  if (status.length > MAX_STATUS_LENGTH) {
    return json({ error: `Status must be ${MAX_STATUS_LENGTH} characters or less` }, 400);
  }

  const modResult = await checkContent(status, env);
  if (modResult.blocked) {
    if (modResult.reason === 'moderation_unavailable') {
      log.warn('content moderation unavailable: blocking content as fail-safe');
      return json(
        { error: 'Content moderation is temporarily unavailable. Please try again.' },
        503,
      );
    }
    return json({ error: 'Status blocked by content filter. Please revise.' }, 400);
  }

  await getDB(env).setStatus(user.id, status);
  return json({ ok: true });
}

export async function handleClearStatus(user, env) {
  await getDB(env).setStatus(user.id, null);
  return json({ ok: true });
}

export async function handleHeartbeat(user, env) {
  await getLobby(env).heartbeat(user.handle);
  return json({ ok: true });
}

export async function handleUpdateAgentProfile(request, user, env) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const profile = {
    framework:
      typeof body.framework === 'string' ? body.framework.slice(0, MAX_FRAMEWORK_LENGTH) : null,
    languages: sanitizeTags(body.languages),
    frameworks: sanitizeTags(body.frameworks),
    tools: sanitizeTags(body.tools),
    platforms: sanitizeTags(body.platforms),
  };

  const result = await getDB(env).updateAgentProfile(user.id, profile);
  if (result.error) {
    log.warn(`updateAgentProfile failed: ${result.error}`);
    return json({ error: result.error }, 400);
  }
  return json(result);
}

export async function handleGetUserTeams(user, env) {
  const result = await getDB(env).getUserTeams(user.id);
  if (result.error) {
    log.warn(`getUserTeams failed: ${result.error}`);
    return json({ error: result.error }, 500);
  }
  return json({ ok: true, teams: result.teams });
}

export async function handleDashboardSummary(user, env) {
  const db = getDB(env);
  const teamsResult = await db.getUserTeams(user.id);
  if (teamsResult.error) return json({ error: teamsResult.error }, 500);
  const teams = teamsResult.teams;

  if (teams.length === 0) {
    return json({
      teams: [],
      degraded: false,
      failed_teams: [],
      truncated: false,
    });
  }

  const capped = teams.slice(0, MAX_DASHBOARD_TEAMS);
  const results = await Promise.allSettled(
    capped.map(async (teamEntry) => {
      const team = getTeam(env, teamEntry.team_id);
      try {
        const summary = await withTimeout(team.getSummary(user.id), DO_CALL_TIMEOUT_MS);
        if (summary.error) {
          try {
            await db.removeUserTeam(user.id, teamEntry.team_id);
          } catch (err) {
            log.error('failed to reconcile stale team', {
              teamId: teamEntry.team_id,
              error: getErrorMessage(err),
            });
          }
          return {
            ok: false,
            team_id: teamEntry.team_id,
            team_name: teamEntry.team_name,
          };
        }
        const { ok: _ok, ...summaryData } = summary;
        return {
          ok: true,
          team: {
            team_id: teamEntry.team_id,
            team_name: teamEntry.team_name,
            ...summaryData,
          },
        };
      } catch (err) {
        log.error('failed to build dashboard summary', {
          teamId: teamEntry.team_id,
          error: getErrorMessage(err),
        });
        return {
          ok: false,
          team_id: teamEntry.team_id,
          team_name: teamEntry.team_name,
        };
      }
    }),
  );

  const loadedTeams = [];
  const failedTeams = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    if (result.value?.ok) loadedTeams.push(result.value.team);
    else if (result.value)
      failedTeams.push({
        team_id: result.value.team_id,
        team_name: result.value.team_name,
      });
  }

  const response = {
    teams: loadedTeams,
    degraded: failedTeams.length > 0,
    failed_teams: failedTeams,
    truncated: teams.length > capped.length,
  };

  if (loadedTeams.length === 0 && failedTeams.length > 0) {
    const error =
      failedTeams.length === 1
        ? 'Project summary is temporarily unavailable.'
        : 'Project summaries are temporarily unavailable.';
    return json({ ...response, error }, 503);
  }

  return json(response);
}

export async function handleChatUpgrade(request, user, env) {
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
  const { roomId } = await lobby.assignRoom(user.handle, shuffle);

  const roomStub = env.ROOM.get(env.ROOM.idFromName(roomId));
  const roomUrl = new URL(request.url);
  roomUrl.pathname = '/ws';
  roomUrl.searchParams.set('handle', user.handle);
  roomUrl.searchParams.set('color', user.color);
  roomUrl.searchParams.set('roomId', roomId);

  return roomStub.fetch(
    new Request(roomUrl.toString(), {
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

export async function handleCreateTeam(request, user, env) {
  let name = null;
  try {
    const body = await request.json();
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
      const joinResult = await team.join(agentId, user.id, user.handle, runtime);
      if (joinResult.error) return json({ error: joinResult.error }, 500);

      const dbResult = await db.addUserTeam(user.id, teamId, name);
      if (dbResult.error) {
        log.error('failed to record created team', {
          teamId,
          userId: user.id,
          error: dbResult.error,
        });
        await team.leave(agentId, user.id).catch(() => {
          /* best-effort cleanup — team creation already failed */
        });
        return json({ error: 'Failed to record team membership' }, 500);
      }

      auditLog('team.create', {
        actor: user.handle,
        outcome: 'success',
        meta: { team_id: teamId },
      });
      return json({ ok: true, team_id: teamId }, 201);
    },
  );
}
