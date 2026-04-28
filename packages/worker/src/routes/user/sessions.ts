// GET /me/sessions: lightweight session list for the dashboard timeline.
//
// Unlike /me/analytics this is a straight cross-team fan-out + concat - no
// merge, no accumulators. Kept separate from the analytics module tree so
// the analytics handler only has to think about one response shape.

import { getDB, getTeam, rpc } from '../../lib/env.js';
import { getErrorMessage } from '../../lib/errors.js';
import { json } from '../../lib/http.js';
import { createLogger } from '../../lib/logger.js';
import { authedRoute } from '../../lib/middleware.js';
import { MAX_DASHBOARD_TEAMS } from '../../lib/constants.js';
import { DO_CALL_TIMEOUT_MS, withTimeout } from './helpers.js';

const log = createLogger('routes.user.sessions');

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Filter param shapes. Handles are alnum + underscore per the registration
// rules; host_tool ids are alnum + hyphen. Both cap at 64 so we never bind
// oversized strings into DO SQL. Anything outside the whitelist silently
// drops the filter rather than 400ing - this cross-team list route treats
// unknown inputs as "no filter."
const HANDLE_RE = /^[A-Za-z0-9_]{1,64}$/;
const HOST_TOOL_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const handleUserSessions = authedRoute(async ({ request, user, env }) => {
  const url = new URL(request.url);
  const from = url.searchParams.get('from') || todayStr();
  const to = url.searchParams.get('to') || todayStr();

  const hostToolParam = url.searchParams.get('host_tool');
  const handleParam = url.searchParams.get('handle');
  const filters: { hostTool?: string; handle?: string } = {};
  if (hostToolParam && HOST_TOOL_RE.test(hostToolParam)) filters.hostTool = hostToolParam;
  if (handleParam && HANDLE_RE.test(handleParam)) filters.handle = handleParam;

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
            team.getSessionsInRange(user.id, from, to, filters) as unknown as Promise<
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
