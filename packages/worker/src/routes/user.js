import { isBlocked, checkContent } from '../moderation.js';
import { getDB, getLobby, getTeam } from '../lib/env.js';
import { json, parseBody } from '../lib/http.js';
import { getAgentRuntime, sanitizeTags, teamErrorStatus } from '../lib/request-utils.js';
import { requireJson, requireString, sanitizeString, withRateLimit } from '../lib/validation.js';
import {
  MAX_STATUS_LENGTH,
  MAX_FRAMEWORK_LENGTH,
  RATE_LIMIT_TEAMS,
  RATE_LIMIT_WS_TICKETS,
  RATE_LIMIT_TOKEN_REFRESH,
  CHAT_COOLDOWN_MS,
  MAX_DASHBOARD_TEAMS,
  MAX_NAME_LENGTH,
  ACCESS_TOKEN_TTL_S,
  REFRESH_TOKEN_TTL_S,
} from '../lib/constants.js';

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
        const user = await db.getUserByHandle(userId);
        return user || null;
      }
      return db.getUser(userId);
    }
    // Fallback: raw token in URL (backwards compat for old clients)
    token = url.searchParams.get('token');
  }
  if (!token) return null;

  const userId = await env.AUTH_KV.get(`token:${token}`);
  if (!userId) return null;

  const db = getDB(env);
  if (!userId.includes('-')) {
    const user = await db.getUserByHandle(userId);
    if (!user) return null;
    // Verify the looked-up user's handle still matches the KV entry.
    // Prevents auth bypass when a handle is reassigned to a different user:
    // stale KV entry "token:X -> oldHandle" would resolve to the new owner.
    if (user.handle !== userId) return null;
    // Migrate handle→UUID and slide TTL forward
    await env.AUTH_KV.put(`token:${token}`, user.id, { expirationTtl: ACCESS_TOKEN_TTL_S });
    return user;
  }

  // Sliding window: re-PUT with fresh TTL on every successful auth.
  // KV writes are cheap and eventually-consistent — the slight delay is
  // fine because the worst case is the token lives slightly shorter than
  // 90 days, never longer. This keeps active tokens alive indefinitely.
  env.AUTH_KV.put(`token:${token}`, userId, { expirationTtl: ACCESS_TOKEN_TTL_S });
  return db.getUser(userId);
}

// --- Token refresh ---
// Accepts a refresh token, issues a new access token + new refresh token,
// and revokes the old refresh token (rotation). If the old refresh token
// was already revoked, the entire token family is invalidated (theft detection).
export async function handleRefreshToken(request, env) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { refresh_token } = body;
  if (!refresh_token || typeof refresh_token !== 'string') {
    return json({ error: 'refresh_token is required' }, 400);
  }
  if (!refresh_token.startsWith('rt_')) {
    return json({ error: 'Invalid refresh token format' }, 400);
  }

  // Look up the refresh token in KV
  const userId = await env.AUTH_KV.get(`refresh:${refresh_token}`);
  if (!userId) {
    // Could be expired or already rotated. Check DB for theft detection:
    // if this token exists in DB but is revoked, someone reused a rotated token.
    const db = getDB(env);
    const tokenRecord = await db.getRefreshToken(refresh_token);
    if (tokenRecord && tokenRecord.revoked) {
      // Potential token theft — revoke all refresh tokens for this user
      await db.revokeAllRefreshTokens(tokenRecord.user_id);
      // Also delete any KV entries for active refresh tokens
      const activeTokens = await db.getActiveRefreshTokens(tokenRecord.user_id);
      await Promise.all(activeTokens.map((t) => env.AUTH_KV.delete(`refresh:${t.token}`)));
    }
    return json({ error: 'Invalid or expired refresh token' }, 401);
  }

  const db = getDB(env);

  // Rate limit refresh attempts
  const limit = await db.checkRateLimit(`refresh:${userId}`, RATE_LIMIT_TOKEN_REFRESH);
  if (!limit.allowed) {
    return json({ error: 'Too many refresh attempts. Try again tomorrow.' }, 429);
  }

  // Revoke the old refresh token (rotation)
  await Promise.all([
    env.AUTH_KV.delete(`refresh:${refresh_token}`),
    db.revokeRefreshToken(refresh_token),
  ]);

  // Issue new access token
  const newAccessToken = crypto.randomUUID();
  await env.AUTH_KV.put(`token:${newAccessToken}`, userId, { expirationTtl: ACCESS_TOKEN_TTL_S });

  // Issue new refresh token
  const newRefreshToken = `rt_${crypto.randomUUID().replace(/-/g, '')}`;
  await Promise.all([
    env.AUTH_KV.put(`refresh:${newRefreshToken}`, userId, { expirationTtl: REFRESH_TOKEN_TTL_S }),
    db.storeRefreshToken(userId, newRefreshToken),
  ]);

  // Update the user's primary token in the DB
  await db.updateUserToken(userId, newAccessToken);

  await db.consumeRateLimit(`refresh:${userId}`);

  return json({ token: newAccessToken, refresh_token: newRefreshToken });
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

  const handle = requireString(body, 'handle');
  if (!handle) return json({ error: 'Handle is required' }, 400);
  // Moderation: handles are globally visible and persistent — sync blocklist check.
  // Handles are alphanumeric+underscores only (validated in DB), but slurs can fit
  // that format (e.g. "n1gger", "f4ggot" won't match, but "retard" will).
  if (isBlocked(handle)) return json({ error: 'Content blocked' }, 400);

  const result = await getDB(env).updateHandle(user.id, handle);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result));

  return json(result);
}

export async function handleUpdateColor(request, user, env) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const color = requireString(body, 'color');
  if (!color) return json({ error: 'Color is required' }, 400);

  const result = await getDB(env).updateColor(user.id, color);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result));

  return json(result);
}

export async function handleSetStatus(request, user, env) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const status = requireString(body, 'status', MAX_STATUS_LENGTH);
  if (!status) return json({ error: `Status is required (max ${MAX_STATUS_LENGTH} chars)` }, 400);

  const modResult = await checkContent(status, env);
  if (modResult.blocked) {
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
    framework: sanitizeString(body.framework, MAX_FRAMEWORK_LENGTH),
    languages: sanitizeTags(body.languages),
    frameworks: sanitizeTags(body.frameworks),
    tools: sanitizeTags(body.tools),
    platforms: sanitizeTags(body.platforms),
  };

  const result = await getDB(env).updateAgentProfile(user.id, profile);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result));
  return json(result);
}

export async function handleGetUserTeams(user, env) {
  const teams = await getDB(env).getUserTeams(user.id);
  return json({ teams });
}

export async function handleDashboardSummary(user, env) {
  const db = getDB(env);
  const teams = await db.getUserTeams(user.id);

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
        const summary = await team.getSummary(user.id, user.id);
        if (summary.error) {
          try {
            await db.removeUserTeam(user.id, teamEntry.team_id);
          } catch (err) {
            console.error(`[chinwag] Failed to reconcile stale team ${teamEntry.team_id}:`, err);
          }
          return {
            ok: false,
            team_id: teamEntry.team_id,
            team_name: teamEntry.team_name,
          };
        }
        return {
          ok: true,
          team: {
            team_id: teamEntry.team_id,
            team_name: teamEntry.team_name,
            ...summary,
          },
        };
      } catch (err) {
        console.error(
          `[chinwag] Failed to build dashboard summary for team ${teamEntry.team_id}:`,
          err,
        );
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
    name = sanitizeString(body.name, MAX_NAME_LENGTH);
  } catch {
    /* body is optional */
  }
  // Moderation: team names are user-visible and persistent
  if (name && isBlocked(name)) return json({ error: 'Content blocked' }, 400);

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
      await team.join(agentId, user.id, user.handle, runtime);

      try {
        await db.addUserTeam(user.id, teamId, name);
      } catch (err) {
        console.error(
          `[chinwag] Failed to record created team ${teamId} for user ${user.id}:`,
          err,
        );
      }

      return json({ team_id: teamId }, 201);
    },
  );
}
