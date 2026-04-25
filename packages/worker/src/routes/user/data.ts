// GDPR-shaped data export and erasure routes.
//
// Why these exist. Two obligations any "privacy-respecting" product owes
// its users, regardless of which compliance regime applies:
//
//   - Right of access (GDPR Art. 15) — "show me everything you have on me."
//   - Right to erasure (GDPR Art. 17) — "delete everything you have on me."
//
// chinmeister fans user data across N TeamDOs and one DatabaseDO. Without
// these endpoints, honoring either request would be a manual ad-hoc job.
// With them, the user calls one HTTP method and we fan out under the hood.
//
// Both endpoints are gated by the caller's bearer token — only the user
// can request their own data or its deletion. Admin-initiated deletion
// (subject access requests submitted via support) goes through a separate
// future tool, not this surface.
//
// Erasure semantics: this is a content-erasure operation, not an account
// closure. The user's account row in DatabaseDO and their team membership
// rows are kept. The user can re-init `chinmeister init` and have a clean
// history. To fully close an account, an admin tool would also delete the
// user row, refresh tokens, and any `user_metrics` rollups.

import { getDB, getTeam, rpc } from '../../lib/env.js';
import { getErrorMessage } from '../../lib/errors.js';
import { json } from '../../lib/http.js';
import { createLogger } from '../../lib/logger.js';
import { authedRoute } from '../../lib/middleware.js';
import { auditLog } from '../../lib/audit.js';
import { tryDORetry, withDORetry } from '../../lib/cross-do.js';
import { MAX_DASHBOARD_TEAMS } from '../../lib/constants.js';
import { DO_CALL_TIMEOUT_MS, withTimeout } from './helpers.js';

const log = createLogger('routes.user.data');

/**
 * GET /me/data/export — bundle and return every per-user record across
 * every team the caller belongs to. JSON payload; the user is expected to
 * save it.
 *
 * Failure mode: if any TeamDO fan-out call times out, the response includes
 * the team IDs that failed in `failed_teams` so the user can retry. The
 * partial export still includes the teams that succeeded.
 */
export const handleExportUserData = authedRoute(async ({ user, env }) => {
  const db = getDB(env);
  const teamsResult = rpc(await db.getUserTeams(user.id));
  const teams: Array<{ team_id: string; team_name: string | null }> = teamsResult.teams;

  const capped = teams.slice(0, MAX_DASHBOARD_TEAMS);
  const results = await Promise.allSettled(
    capped.map(async (teamEntry) => {
      const team = getTeam(env, teamEntry.team_id);
      try {
        const result = rpc(
          await withTimeout(
            team.exportUserData(user.id, user.handle) as unknown as Promise<
              { ok: true; data: Record<string, unknown> } | { error: string; code?: string }
            >,
            DO_CALL_TIMEOUT_MS,
          ),
        );
        // Surface DO-level errors (e.g. NOT_MEMBER for a stale roster row
        // whose TeamDO never saw a join) into failed_teams. Without this,
        // the response would silently include a half-empty team bundle.
        if ('error' in result) {
          log.warn('export DO returned error', {
            teamId: teamEntry.team_id,
            error: result.error,
          });
          return {
            ok: false as const,
            team_id: teamEntry.team_id,
            team_name: teamEntry.team_name,
          };
        }
        return {
          ok: true as const,
          team_id: teamEntry.team_id,
          team_name: teamEntry.team_name,
          data: result.data,
        };
      } catch (err) {
        log.warn('export fan-out failed for team', {
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

  const teamsExported: Record<string, unknown>[] = [];
  const failedTeams: Array<{ team_id: string; team_name: string | null }> = [];

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    if (r.value.ok) {
      teamsExported.push({
        team_id: r.value.team_id,
        team_name: r.value.team_name,
        ...r.value.data,
      });
    } else {
      failedTeams.push({ team_id: r.value.team_id, team_name: r.value.team_name });
    }
  }

  auditLog('me.data_export', {
    actor: user.handle,
    actor_id: user.id,
    outcome: failedTeams.length === 0 ? 'success' : 'partial',
    meta: { teams_exported: teamsExported.length, failed_teams: failedTeams.length },
  });

  return json({
    ok: true,
    user: {
      id: user.id,
      handle: user.handle,
      color: user.color,
      created_at: user.created_at,
    },
    exported_at: new Date().toISOString(),
    teams: teamsExported,
    failed_teams: failedTeams,
  });
});

/**
 * POST /me/data/delete — erase every per-user record across every team
 * the caller belongs to. Returns a deletion receipt with row counts so the
 * user has proof of what was removed.
 *
 * Per-team failures: each team is deleted independently with retry. If a
 * team's deletion fails terminally after retries, it goes into
 * `failed_teams`; the user can call again to retry that team. This is
 * deliberate — partial deletion is better than no deletion.
 */
export const handleDeleteUserData = authedRoute(async ({ user, env }) => {
  const db = getDB(env);
  const teamsResult = rpc(await db.getUserTeams(user.id));
  const teams: Array<{ team_id: string; team_name: string | null }> = teamsResult.teams;

  const capped = teams.slice(0, MAX_DASHBOARD_TEAMS);
  const results = await Promise.allSettled(
    capped.map(async (teamEntry) => {
      const team = getTeam(env, teamEntry.team_id);
      try {
        const result = await withDORetry(
          () =>
            team.deleteUserData(user.id, user.handle) as unknown as Promise<
              | { ok: true; result: { counts: Record<string, number> } }
              | { error: string; code?: string }
            >,
          { label: `deleteUserData(${teamEntry.team_id})` },
        );
        const unwrapped = rpc(result);
        if ('error' in unwrapped) {
          log.warn('delete DO returned error', {
            teamId: teamEntry.team_id,
            error: unwrapped.error,
          });
          return {
            ok: false as const,
            team_id: teamEntry.team_id,
            team_name: teamEntry.team_name,
          };
        }
        return {
          ok: true as const,
          team_id: teamEntry.team_id,
          team_name: teamEntry.team_name,
          counts: unwrapped.result.counts,
        };
      } catch (err) {
        log.error('delete fan-out failed for team', {
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

  const teamsDeleted: Array<{
    team_id: string;
    team_name: string | null;
    counts: Record<string, number>;
  }> = [];
  const failedTeams: Array<{ team_id: string; team_name: string | null }> = [];

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    if (r.value.ok) {
      teamsDeleted.push({
        team_id: r.value.team_id,
        team_name: r.value.team_name,
        counts: r.value.counts,
      });
    } else {
      failedTeams.push({ team_id: r.value.team_id, team_name: r.value.team_name });
    }
  }

  // Best-effort cleanup of cross-team account-level data. Token revocation
  // is the only path that needs to be loud — if it fails, the user's old
  // tokens stay valid until manually revoked. Use tryDORetry so a transient
  // DB blip doesn't 500 the whole request. Wrap in an async closure so TS
  // doesn't try to unify the DOResult discriminated union with tryDORetry's
  // generic; we don't care about the return value here.
  await tryDORetry(
    async () => {
      await db.revokeTokens(user.id);
    },
    { label: 'revokeTokens during data delete' },
  );

  auditLog('me.data_delete', {
    actor: user.handle,
    actor_id: user.id,
    outcome: failedTeams.length === 0 ? 'success' : 'partial',
    meta: {
      teams_deleted: teamsDeleted.length,
      failed_teams: failedTeams.length,
    },
  });

  return json({
    ok: true,
    deleted_at: new Date().toISOString(),
    teams: teamsDeleted,
    failed_teams: failedTeams,
    note:
      failedTeams.length > 0
        ? 'Some teams failed to delete. Retry to attempt those again.'
        : 'All bearer tokens have also been revoked. Re-run `chinmeister init` to issue fresh credentials.',
  });
});
