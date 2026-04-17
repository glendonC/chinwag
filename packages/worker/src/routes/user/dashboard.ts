// Dashboard summary orchestration -- multi-team summary for overview page.

import { getDB, getTeam, rpc } from '../../lib/env.js';
import { getErrorMessage } from '../../lib/errors.js';
import { json } from '../../lib/http.js';
import { createLogger } from '../../lib/logger.js';
import { authedRoute } from '../../lib/middleware.js';
import { MAX_DASHBOARD_TEAMS } from '../../lib/constants.js';
import { DO_CALL_TIMEOUT_MS, withTimeout } from './helpers.js';

const log = createLogger('routes.user.teams');

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

  for (const [i, r] of results.entries()) {
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
    const value = r.value;
    if (value.ok) {
      loadedTeams.push(value.team);
    } else {
      failedTeams.push({
        team_id: value.team_id,
        team_name: value.team_name,
      });
    }
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
