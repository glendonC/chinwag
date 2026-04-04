import type { Env, User } from '../types.js';
import { checkContent } from '../moderation.js';
import { getDB, getLobby, getTeam, rpc } from '../lib/env.js';
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('DO call timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function authenticate(request: Request, env: Env): Promise<User | null> {
  const auth = request.headers.get('Authorization');
  let token: string | undefined;
  if (auth?.startsWith('Bearer ')) {
    token = auth.slice(7);
  } else if (request.headers.get('Upgrade') === 'websocket') {
    const url = new URL(request.url);
    // Prefer ticket (short-lived, single-use) over token for WS auth
    const ticket = url.searchParams.get('ticket');
    if (ticket) {
      // TOCTOU: KV get-then-delete is not atomic. Two concurrent requests with the
      // same ticket could both pass the null check before either deletes the key.
      // Risk is minimal: tickets are random UUIDs with 30s TTL, rate-limited, and the
      // race window is sub-millisecond within a single CF colo. Atomic delete would
      // require a Durable Object, adding latency for negligible security gain.
      const kvKey = `ticket:${ticket}`;
      const userId = await env.AUTH_KV.get(kvKey);
      if (!userId) return null;
      await env.AUTH_KV.delete(kvKey);
      const db = getDB(env);
      if (!userId.includes('-')) {
        const result = rpc(await db.getUserByHandle(userId));
        return 'error' in result ? null : result.user;
      }
      const result = rpc(await db.getUser(userId));
      return 'error' in result ? null : result.user;
    }
  }
  if (!token) return null;

  const userId = await env.AUTH_KV.get(`token:${token}`);
  if (!userId) return null;

  const db = getDB(env);
  if (!userId.includes('-')) {
    const result = rpc(await db.getUserByHandle(userId));
    if ('error' in result) return null;
    const user: User = result.user;
    // Verify the looked-up user's handle still matches the KV entry.
    // Prevents auth bypass when a handle is reassigned to a different user:
    // stale KV entry "token:X -> oldHandle" would resolve to the new owner.
    if (user.handle !== userId) return null;
    await env.AUTH_KV.put(`token:${token}`, user.id);
    return user;
  }

  const result = rpc(await db.getUser(userId));
  if (!('error' in result)) {
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

export async function handleRefreshToken(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const refreshToken = (body as Record<string, unknown>)?.refresh_token;
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

export async function handleGetWsTicket(user: User, env: Env): Promise<Response> {
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

export async function handleUnlinkGithub(user: User, env: Env): Promise<Response> {
  const result = rpc(await getDB(env).unlinkGithub(user.id));
  return json(result);
}

export async function handleUpdateHandle(
  request: Request,
  user: User,
  env: Env,
): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { handle } = body as Record<string, unknown>;
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

  const result = rpc(await getDB(env).updateHandle(user.id, handle));
  if ('error' in result) {
    log.warn(`updateHandle failed: ${result.error}`);
    return json({ error: result.error }, 400);
  }

  return json(result);
}

export async function handleUpdateColor(request: Request, user: User, env: Env): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { color } = body as Record<string, unknown>;
  if (!color || typeof color !== 'string') {
    return json({ error: 'Color is required' }, 400);
  }
  if (!VALID_COLORS_SET.has(color)) {
    return json(
      { error: `Invalid color. Must be one of: ${[...VALID_COLORS_SET].join(', ')}` },
      400,
    );
  }

  const result = rpc(await getDB(env).updateColor(user.id, color));
  if ('error' in result) {
    log.warn(`updateColor failed: ${result.error}`);
    return json({ error: result.error }, 400);
  }

  return json(result);
}

export async function handleSetStatus(request: Request, user: User, env: Env): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { status } = body as Record<string, unknown>;
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

export async function handleClearStatus(user: User, env: Env): Promise<Response> {
  await getDB(env).setStatus(user.id, null);
  return json({ ok: true });
}

export async function handleHeartbeat(user: User, env: Env): Promise<Response> {
  await getLobby(env).heartbeat(user.handle);
  return json({ ok: true });
}

export async function handleUpdateAgentProfile(
  request: Request,
  user: User,
  env: Env,
): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const b = body as Record<string, unknown>;
  const profile = {
    framework: typeof b.framework === 'string' ? b.framework.slice(0, MAX_FRAMEWORK_LENGTH) : null,
    languages: sanitizeTags(b.languages),
    frameworks: sanitizeTags(b.frameworks),
    tools: sanitizeTags(b.tools),
    platforms: sanitizeTags(b.platforms),
  };

  const result = rpc(await getDB(env).updateAgentProfile(user.id, profile));
  if ('error' in result) {
    log.warn(`updateAgentProfile failed: ${result.error}`);
    return json({ error: result.error }, 400);
  }
  return json(result);
}

export async function handleGetUserTeams(user: User, env: Env): Promise<Response> {
  const result = rpc(await getDB(env).getUserTeams(user.id));
  return json({ ok: true, teams: result.teams });
}

export async function handleDashboardSummary(user: User, env: Env): Promise<Response> {
  const db = getDB(env);
  const teamsResult = rpc(await db.getUserTeams(user.id));
  const teams: Array<{ team_id: string; team_name: string | null }> = teamsResult.teams;

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
        const summary = rpc(
          await withTimeout(
            team.getSummary(user.id) as unknown as Promise<Record<string, unknown>>,
            DO_CALL_TIMEOUT_MS,
          ),
        );
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
            ok: false as const,
            team_id: teamEntry.team_id,
            team_name: teamEntry.team_name,
          };
        }
        const { ok: _ok, ...summaryData } = summary;
        return {
          ok: true as const,
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
          ok: false as const,
          team_id: teamEntry.team_id,
          team_name: teamEntry.team_name,
        };
      }
    }),
  );

  const loadedTeams: Record<string, unknown>[] = [];
  const failedTeams: Array<{ team_id: string; team_name: string | null }> = [];

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    if (r.value?.ok && 'team' in r.value) loadedTeams.push(r.value.team);
    else if (r.value && 'team_id' in r.value)
      failedTeams.push({
        team_id: r.value.team_id,
        team_name: r.value.team_name,
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

export async function handleChatUpgrade(request: Request, user: User, env: Env): Promise<Response> {
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
        'X-Chinwag-Verified': '1',
        Upgrade: request.headers.get('Upgrade') || '',
        Connection: request.headers.get('Connection') || '',
        'Sec-WebSocket-Key': request.headers.get('Sec-WebSocket-Key') || '',
        'Sec-WebSocket-Protocol': request.headers.get('Sec-WebSocket-Protocol') || '',
        'Sec-WebSocket-Version': request.headers.get('Sec-WebSocket-Version') || '',
      },
    }),
  );
}

export async function handleCreateTeam(request: Request, user: User, env: Env): Promise<Response> {
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

      await db.addUserTeam(user.id, teamId, name);

      auditLog('team.create', {
        actor: user.handle,
        outcome: 'success',
        meta: { team_id: teamId },
      });
      return json({ ok: true, team_id: teamId }, 201);
    },
  );
}
