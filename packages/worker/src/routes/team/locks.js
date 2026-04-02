// Team lock routes — claim, release, get locks.

import { getDB, getTeam } from '../../lib/env.js';
import { json, parseBody } from '../../lib/http.js';
import { getAgentRuntime, teamErrorStatus } from '../../lib/request-utils.js';
import { requireJson, validateFileArray, withRateLimit } from '../../lib/validation.js';
import { LOCK_CLAIM_MAX_FILES, MAX_FILE_PATH_LENGTH, RATE_LIMIT_LOCKS } from '../../lib/constants.js';

export async function handleTeamClaimFiles(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const { files } = body;
  const fileErr = validateFileArray(files, LOCK_CLAIM_MAX_FILES);
  if (fileErr) return json({ error: fileErr }, 400);

  const db = getDB(env);
  const runtime = getAgentRuntime(request, user);
  const agentId = runtime.agentId;
  const team = getTeam(env, teamId);

  return withRateLimit(db, `locks:${user.id}`, RATE_LIMIT_LOCKS, 'Lock claim limit reached (100/day). Try again tomorrow.', async () => {
    const result = await team.claimFiles(agentId, files, user.handle, runtime, user.id);
    if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
    return json(result);
  });
}

export async function handleTeamReleaseFiles(request, user, env, teamId) {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const files = body.files || null;
  if (files !== null && !Array.isArray(files)) return json({ error: 'files must be an array' }, 400);
  if (files && files.some(f => typeof f !== 'string' || f.length > MAX_FILE_PATH_LENGTH)) return json({ error: 'invalid file path' }, 400);

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.releaseFiles(agentId, files, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

export async function handleTeamGetLocks(request, user, env, teamId) {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getLockedFiles(agentId, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}
