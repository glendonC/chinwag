// Team lock routes — claim, release, get locks.

import { getDB, getTeam } from '../../lib/env.js';
import { json, parseBody } from '../../lib/http.js';
import { getAgentRuntime, teamErrorStatus } from '../../lib/request-utils.js';
import {
  requireJson,
  validateFileArray,
  withRateLimit,
  withTeamRateLimit,
} from '../../lib/validation.js';
import {
  LOCK_CLAIM_MAX_FILES,
  MAX_FILE_PATH_LENGTH,
  RATE_LIMIT_LOCKS,
} from '../../lib/constants.js';

export async function handleTeamClaimFiles(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { files } = body;
  const fileErr = validateFileArray(files, LOCK_CLAIM_MAX_FILES);
  if (fileErr) return json({ error: fileErr }, 400);

  return withTeamRateLimit({
    request,
    user,
    env,
    teamId,
    rateLimitKey: 'locks',
    rateLimitMax: RATE_LIMIT_LOCKS,
    rateLimitMsg: 'Lock claim limit reached (100/day). Try again tomorrow.',
    action: (team, agentId, runtime) =>
      team.claimFiles(agentId, files, user.handle, runtime, user.id),
  });
}

export async function handleTeamReleaseFiles(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const files = body.files || null;
  const fileErr = validateFileArray(files, LOCK_CLAIM_MAX_FILES, { nullable: true });
  if (fileErr) return json({ error: fileErr }, 400);

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.releaseFiles(agentId, files, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result));
  return json(result);
}

export async function handleTeamGetLocks(request, user, env, teamId) {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getLockedFiles(agentId, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result));
  return json(result);
}
