// Team lock routes - claim, release, get locks.

import type { RouteDefinition } from '../../lib/router.js';
import { json } from '../../lib/http.js';
import { teamJsonRoute, teamRoute, doResult } from '../../lib/middleware.js';
import { validateFileArray, withTeamRateLimit } from '../../lib/validation.js';
import { LOCK_CLAIM_MAX_FILES, RATE_LIMIT_LOCKS } from '../../lib/constants.js';

export const handleTeamClaimFiles = teamJsonRoute(async ({ body, user, env, teamId, request }) => {
  const { files, ttl_seconds } = body;
  const fileErr = validateFileArray(files, LOCK_CLAIM_MAX_FILES);
  if (fileErr) return json({ error: fileErr }, 400);

  // ttl_seconds is optional; when provided it must be a positive integer.
  // We cap at 24h so a runaway agent can't park a long-lived phantom
  // reservation that survives its own session.
  const MAX_TTL_SECONDS = 86_400;
  let ttlSeconds: number | undefined;
  if (ttl_seconds !== undefined && ttl_seconds !== null) {
    if (typeof ttl_seconds !== 'number' || !Number.isFinite(ttl_seconds) || ttl_seconds <= 0) {
      return json({ error: 'ttl_seconds must be a positive number' }, 400);
    }
    ttlSeconds = Math.min(Math.trunc(ttl_seconds), MAX_TTL_SECONDS);
  }

  return withTeamRateLimit({
    request,
    user,
    env,
    teamId,
    rateLimitKey: 'locks',
    rateLimitMax: RATE_LIMIT_LOCKS,
    rateLimitMsg: 'Lock claim limit reached (100/day). Try again tomorrow.',
    action: (team, agentId, runtime) =>
      team.claimFiles(
        agentId,
        files as string[],
        user.handle,
        runtime,
        user.id,
        ttlSeconds !== undefined ? { ttlSeconds } : undefined,
      ),
  });
});

export const handleTeamReleaseFiles = teamJsonRoute(async ({ body, agentId, team, user }) => {
  const files = (body.files || null) as string[] | null;
  const fileErr = validateFileArray(files, LOCK_CLAIM_MAX_FILES, { nullable: true });
  if (fileErr) return json({ error: fileErr }, 400);

  return doResult(team.releaseFiles(agentId, files, user.id), 'releaseFiles');
});

export const handleTeamGetLocks = teamRoute(async ({ agentId, team, user }) => {
  return doResult(team.getLockedFiles(agentId, user.id), 'getLockedFiles');
});

/**
 * Read-only conflict probe. Takes a list of concrete file paths and returns
 * the subset that would be blocked by someone else's active lock (exact
 * path or glob umbrella). Used by the pre-commit hook so staged files are
 * checked before the commit goes through - and by any other "would I
 * conflict if I edited these?" call site.
 */
export const handleTeamCheckLocks = teamJsonRoute(async ({ body, agentId, team, user }) => {
  const { files } = body;
  const fileErr = validateFileArray(files, LOCK_CLAIM_MAX_FILES);
  if (fileErr) return json({ error: fileErr }, 400);
  return doResult(
    team.checkFileConflicts(agentId, files as string[], user.id),
    'checkFileConflicts',
  );
});

/**
 * File lock routes for a team.
 */
export function registerLocksRoutes(TID: string): RouteDefinition[] {
  return [
    { method: 'POST', path: `/teams/${TID}/locks`, handler: handleTeamClaimFiles },
    { method: 'DELETE', path: `/teams/${TID}/locks`, handler: handleTeamReleaseFiles },
    { method: 'GET', path: `/teams/${TID}/locks`, handler: handleTeamGetLocks },
    { method: 'POST', path: `/teams/${TID}/locks/check`, handler: handleTeamCheckLocks },
  ];
}
