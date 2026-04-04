// Team CRUD -- create team, list teams, dashboard summary, chat upgrade.

import { checkContent } from '../../moderation.js';
import { getDB, getLobby, getTeam, rpc } from '../../lib/env.js';
import { getErrorMessage } from '../../lib/errors.js';
import { json } from '../../lib/http.js';
import { createLogger } from '../../lib/logger.js';
import { getAgentRuntime } from '../../lib/request-utils.js';
import { withRateLimit } from '../../lib/validation.js';
import { authedRoute } from '../../lib/middleware.js';
import { auditLog } from '../../lib/audit.js';
import {
  RATE_LIMIT_TEAMS,
  CHAT_COOLDOWN_MS,
  MAX_DASHBOARD_TEAMS,
  MAX_NAME_LENGTH,
} from '../../lib/constants.js';

const log = createLogger('routes.user.teams');

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

export const handleGetUserTeams = authedRoute(async ({ user, env }) => {
  const result = rpc(await getDB(env).getUserTeams(user.id));
  return json({ ok: true, teams: result.teams });
});

export const handleDashboardSummary = authedRoute(async ({ user, env }) => {
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

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      // Promise.allSettled should not produce rejected results here because
      // the inner mapper already catches all errors, but handle defensively.
      log.error('unexpected rejected promise in dashboard summary', {
        teamId: capped[i]?.team_id,
        error: getErrorMessage(r.reason),
      });
      failedTeams.push({
        team_id: capped[i]?.team_id ?? 'unknown',
        team_name: capped[i]?.team_name ?? null,
      });
      continue;
    }
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
        'X-Chinwag-Verified': '1',
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

      await db.addUserTeam(user.id, teamId, name);

      auditLog('team.create', {
        actor: user.handle,
        outcome: 'success',
        meta: { team_id: teamId },
      });
      return json({ ok: true, team_id: teamId }, 201);
    },
  );
});
