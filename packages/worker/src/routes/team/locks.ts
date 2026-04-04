// Team lock routes — claim, release, get locks.

import type { Env, User } from '../../types.js';
import { getTeam, rpc } from '../../lib/env.js';
import { json, parseBody } from '../../lib/http.js';
import { createLogger } from '../../lib/logger.js';
import { getAgentRuntime, teamErrorStatus } from '../../lib/request-utils.js';
import { requireJson, validateFileArray, withTeamRateLimit } from '../../lib/validation.js';
import { LOCK_CLAIM_MAX_FILES, RATE_LIMIT_LOCKS } from '../../lib/constants.js';

const log = createLogger('routes.locks');

export async function handleTeamClaimFiles(
  request: Request,
  user: User,
  env: Env,
  teamId: string,
): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const b = body as Record<string, unknown>;
  const { files } = b;
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
      team.claimFiles(agentId, files as string[], user.handle, runtime, user.id),
  });
}

export async function handleTeamReleaseFiles(
  request: Request,
  user: User,
  env: Env,
  teamId: string,
): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const b = body as Record<string, unknown>;
  const files = (b.files || null) as string[] | null;
  const fileErr = validateFileArray(files, LOCK_CLAIM_MAX_FILES, { nullable: true });
  if (fileErr) return json({ error: fileErr }, 400);

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = rpc(await team.releaseFiles(agentId, files, user.id));
  if ('error' in result) {
    log.warn(`releaseFiles failed: ${result.error}`);
    return json({ error: result.error }, teamErrorStatus(result));
  }
  return json(result);
}

export async function handleTeamGetLocks(
  request: Request,
  user: User,
  env: Env,
  teamId: string,
): Promise<Response> {
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = rpc(await team.getLockedFiles(agentId, user.id));
  if ('error' in result) {
    log.warn(`getLockedFiles failed: ${result.error}`);
    return json({ error: result.error }, teamErrorStatus(result));
  }
  return json(result);
}
