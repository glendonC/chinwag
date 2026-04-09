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

const ANALYTICS_MAX_DAYS = 90;

export const handleUserAnalytics = authedRoute(async ({ request, user, env }) => {
  const url = new URL(request.url);
  const parsed = parseInt(url.searchParams.get('days') || '30', 10);
  const days = Math.max(1, Math.min(isNaN(parsed) ? 30 : parsed, ANALYTICS_MAX_DAYS));

  const db = getDB(env);
  const teamsResult = rpc(await db.getUserTeams(user.id));
  const teams: Array<{ team_id: string; team_name: string | null }> = teamsResult.teams;

  if (teams.length === 0) {
    return json({
      ok: true,
      period_days: days,
      file_heatmap: [],
      daily_trends: [],
      tool_distribution: [],
      outcome_distribution: [],
      daily_metrics: [],
      hourly_distribution: [],
      tool_hourly: [],
      tool_daily: [],
      model_outcomes: [],
      teams_included: 0,
      degraded: false,
    });
  }

  const capped = teams.slice(0, MAX_DASHBOARD_TEAMS);
  const results = await Promise.allSettled(
    capped.map(async (teamEntry) => {
      const team = getTeam(env, teamEntry.team_id);
      try {
        return rpc(
          await withTimeout(
            team.getAnalyticsForOwner(user.id, days) as unknown as Promise<Record<string, unknown>>,
            DO_CALL_TIMEOUT_MS,
          ),
        );
      } catch (err) {
        log.error('failed to fetch team analytics', {
          teamId: teamEntry.team_id,
          error: getErrorMessage(err),
        });
        return { error: 'timeout' };
      }
    }),
  );

  // Merge analytics across teams
  const dailyTrends = new Map<
    string,
    {
      sessions: number;
      edits: number;
      lines_added: number;
      lines_removed: number;
      duration_sum: number;
      duration_count: number;
    }
  >();
  const outcomes = new Map<string, number>();
  const tools = new Map<string, { sessions: number; edits: number }>();
  const heatmap = new Map<string, number>();
  const hourly = new Map<string, { sessions: number; edits: number }>();
  const toolHourly = new Map<string, { sessions: number; edits: number }>();
  const toolDaily = new Map<
    string,
    {
      sessions: number;
      edits: number;
      lines_added: number;
      lines_removed: number;
      duration_sum: number;
      duration_count: number;
    }
  >();
  const models = new Map<string, { count: number; total_edits: number; duration_sum: number }>();
  const dailyMetrics = new Map<string, number>();

  let included = 0;
  let failed = 0;

  for (const r of results) {
    if (r.status === 'rejected') {
      failed++;
      continue;
    }
    const data = r.value as Record<string, unknown>;
    if (data.error) {
      failed++;
      continue;
    }
    included++;

    for (const t of (data.daily_trends as Array<Record<string, unknown>>) || []) {
      const key = t.day as string;
      const existing = dailyTrends.get(key) || {
        sessions: 0,
        edits: 0,
        lines_added: 0,
        lines_removed: 0,
        duration_sum: 0,
        duration_count: 0,
      };
      existing.sessions += (t.sessions as number) || 0;
      existing.edits += (t.edits as number) || 0;
      existing.lines_added += (t.lines_added as number) || 0;
      existing.lines_removed += (t.lines_removed as number) || 0;
      const avg = (t.avg_duration_min as number) || 0;
      const sess = (t.sessions as number) || 0;
      existing.duration_sum += avg * sess;
      existing.duration_count += sess;
      dailyTrends.set(key, existing);
    }

    for (const o of (data.outcome_distribution as Array<Record<string, unknown>>) || []) {
      const key = o.outcome as string;
      outcomes.set(key, (outcomes.get(key) || 0) + ((o.count as number) || 0));
    }

    for (const t of (data.tool_distribution as Array<Record<string, unknown>>) || []) {
      const key = t.host_tool as string;
      const existing = tools.get(key) || { sessions: 0, edits: 0 };
      existing.sessions += (t.sessions as number) || 0;
      existing.edits += (t.edits as number) || 0;
      tools.set(key, existing);
    }

    for (const f of (data.file_heatmap as Array<Record<string, unknown>>) || []) {
      const key = f.file as string;
      heatmap.set(key, (heatmap.get(key) || 0) + ((f.touch_count as number) || 0));
    }

    for (const h of (data.hourly_distribution as Array<Record<string, unknown>>) || []) {
      const key = `${h.hour}-${h.dow}`;
      const existing = hourly.get(key) || { sessions: 0, edits: 0 };
      existing.sessions += (h.sessions as number) || 0;
      existing.edits += (h.edits as number) || 0;
      hourly.set(key, existing);
    }

    for (const th of (data.tool_hourly as Array<Record<string, unknown>>) || []) {
      const key = `${th.host_tool}:${th.hour}-${th.dow}`;
      const existing = toolHourly.get(key) || { sessions: 0, edits: 0 };
      existing.sessions += (th.sessions as number) || 0;
      existing.edits += (th.edits as number) || 0;
      toolHourly.set(key, existing);
    }

    for (const td of (data.tool_daily as Array<Record<string, unknown>>) || []) {
      const key = `${td.host_tool}:${td.day}`;
      const existing = toolDaily.get(key) || {
        sessions: 0,
        edits: 0,
        lines_added: 0,
        lines_removed: 0,
        duration_sum: 0,
        duration_count: 0,
      };
      existing.sessions += (td.sessions as number) || 0;
      existing.edits += (td.edits as number) || 0;
      existing.lines_added += (td.lines_added as number) || 0;
      existing.lines_removed += (td.lines_removed as number) || 0;
      const avg = (td.avg_duration_min as number) || 0;
      const sess = (td.sessions as number) || 0;
      existing.duration_sum += avg * sess;
      existing.duration_count += sess;
      toolDaily.set(key, existing);
    }

    for (const m of (data.model_outcomes as Array<Record<string, unknown>>) || []) {
      const key = `${m.agent_model}:${m.outcome}`;
      const existing = models.get(key) || { count: 0, total_edits: 0, duration_sum: 0 };
      existing.count += (m.count as number) || 0;
      existing.total_edits += (m.total_edits as number) || 0;
      existing.duration_sum += ((m.avg_duration_min as number) || 0) * ((m.count as number) || 0);
      models.set(key, existing);
    }

    for (const dm of (data.daily_metrics as Array<Record<string, unknown>>) || []) {
      const key = `${dm.date}:${dm.metric}`;
      dailyMetrics.set(key, (dailyMetrics.get(key) || 0) + ((dm.count as number) || 0));
    }
  }

  return json({
    ok: true,
    period_days: days,
    daily_trends: [...dailyTrends.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({
        day,
        sessions: v.sessions,
        edits: v.edits,
        lines_added: v.lines_added,
        lines_removed: v.lines_removed,
        avg_duration_min:
          v.duration_count > 0 ? Math.round((v.duration_sum / v.duration_count) * 10) / 10 : 0,
      })),
    outcome_distribution: [...outcomes.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([outcome, count]) => ({ outcome, count })),
    tool_distribution: [...tools.entries()]
      .sort(([, a], [, b]) => b.sessions - a.sessions)
      .map(([host_tool, v]) => ({ host_tool, sessions: v.sessions, edits: v.edits })),
    file_heatmap: [...heatmap.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 50)
      .map(([file, touch_count]) => ({ file, touch_count })),
    hourly_distribution: [...hourly.entries()].map(([key, v]) => {
      const [hour, dow] = key.split('-').map(Number);
      return { hour, dow, sessions: v.sessions, edits: v.edits };
    }),
    tool_hourly: [...toolHourly.entries()].map(([key, v]) => {
      const [toolPart, timePart] = [
        key.slice(0, key.lastIndexOf(':')),
        key.slice(key.lastIndexOf(':') + 1),
      ];
      const [hour, dow] = timePart.split('-').map(Number);
      return { host_tool: toolPart, hour, dow, sessions: v.sessions, edits: v.edits };
    }),
    tool_daily: [...toolDaily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => {
        const sep = key.indexOf(':');
        return {
          host_tool: key.slice(0, sep),
          day: key.slice(sep + 1),
          sessions: v.sessions,
          edits: v.edits,
          lines_added: v.lines_added,
          lines_removed: v.lines_removed,
          avg_duration_min:
            v.duration_count > 0 ? Math.round((v.duration_sum / v.duration_count) * 10) / 10 : 0,
        };
      }),
    model_outcomes: [...models.entries()]
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([key, v]) => {
        const [agent_model, outcome] = key.split(':');
        return {
          agent_model,
          outcome,
          count: v.count,
          avg_duration_min: v.count > 0 ? Math.round((v.duration_sum / v.count) * 10) / 10 : 0,
          total_edits: v.total_edits,
        };
      }),
    daily_metrics: [...dailyMetrics.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => {
        const idx = key.indexOf(':');
        return { date: key.slice(0, idx), metric: key.slice(idx + 1), count };
      }),
    teams_included: included,
    degraded: failed > 0,
  });
});

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const handleUserSessions = authedRoute(async ({ request, user, env }) => {
  const url = new URL(request.url);
  const from = url.searchParams.get('from') || todayStr();
  const to = url.searchParams.get('to') || todayStr();

  const db = getDB(env);
  const teamsResult = rpc(await db.getUserTeams(user.id));
  const teams: Array<{ team_id: string; team_name: string | null }> = teamsResult.teams;

  if (teams.length === 0) {
    return json({
      ok: true,
      sessions: [],
      totals: { sessions: 0, edits: 0, lines_added: 0, lines_removed: 0, tools: [] },
    });
  }

  const capped = teams.slice(0, MAX_DASHBOARD_TEAMS);
  const results = await Promise.allSettled(
    capped.map(async (t) => {
      const team = getTeam(env, t.team_id);
      try {
        const result = rpc(
          await withTimeout(
            team.getSessionsInRange(user.id, from, to) as unknown as Promise<
              Record<string, unknown>
            >,
            DO_CALL_TIMEOUT_MS,
          ),
        );
        if (result.error) return [];
        return ((result.sessions as Array<Record<string, unknown>>) || []).map((s) => ({
          ...s,
          team_id: t.team_id,
          team_name: t.team_name,
        }));
      } catch (err) {
        log.error('failed to fetch team sessions', {
          teamId: t.team_id,
          error: getErrorMessage(err),
        });
        return [];
      }
    }),
  );

  const allSessions: Array<Record<string, unknown>> = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      for (const s of r.value) allSessions.push(s);
    }
  }
  allSessions.sort((a, b) => String(a.started_at || '').localeCompare(String(b.started_at || '')));

  const totals = {
    sessions: allSessions.length,
    edits: allSessions.reduce((s, r) => s + ((r.edit_count as number) || 0), 0),
    lines_added: allSessions.reduce((s, r) => s + ((r.lines_added as number) || 0), 0),
    lines_removed: allSessions.reduce((s, r) => s + ((r.lines_removed as number) || 0), 0),
    tools: [...new Set(allSessions.map((s) => s.host_tool as string).filter(Boolean))],
  };

  return json({ ok: true, sessions: allSessions, totals });
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
