// Team activity routes — activity reporting, conflicts, file reporting, sessions, history.

import type { Env, User } from '../../types.js';
import { checkContent } from '../../moderation.js';
import { getDB, getTeam } from '../../lib/env.js';
import { json, parseBody } from '../../lib/http.js';
import { getAgentRuntime, teamErrorStatus } from '../../lib/request-utils.js';
import { requireJson, validateFileArray, withRateLimit } from '../../lib/validation.js';
import { createLogger } from '../../lib/logger.js';
import { auditLog } from '../../lib/audit.js';
import {
  ACTIVITY_MAX_FILES,
  MAX_SUMMARY_LENGTH,
  MAX_FILE_PATH_LENGTH,
  MAX_FRAMEWORK_LENGTH,
  MAX_MODEL_LENGTH,
  RATE_LIMIT_FILE_REPORTS,
  RATE_LIMIT_SESSIONS,
  RATE_LIMIT_EDITS,
  HISTORY_DEFAULT_DAYS,
  HISTORY_MAX_DAYS,
} from '../../lib/constants.js';

const log = createLogger('routes.activity');

export async function handleTeamActivity(
  request: Request,
  user: User,
  env: Env,
  teamId: string,
): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const b = body as Record<string, unknown>;
  const { files, summary } = b;
  const fileErr = validateFileArray(files, ACTIVITY_MAX_FILES);
  if (fileErr) return json({ error: fileErr }, 400);

  if (typeof summary !== 'string') return json({ error: 'summary must be a string' }, 400);
  if (summary.length > MAX_SUMMARY_LENGTH)
    return json({ error: `summary must be ${MAX_SUMMARY_LENGTH} characters or less` }, 400);

  if (summary) {
    const modResult = await checkContent(summary, env);
    if (modResult.blocked) {
      if (modResult.reason === 'moderation_unavailable') {
        log.warn('content moderation unavailable: blocking activity as fail-safe');
        return json(
          { error: 'Content moderation is temporarily unavailable. Please try again.' },
          503,
        );
      }
      return json({ error: 'Content blocked' }, 400);
    }
  }

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await (team as any).updateActivity(agentId, files, summary, user.id);
  if (result.error) {
    log.warn(`updateActivity failed: ${result.error}`);
    return json({ error: result.error }, teamErrorStatus(result));
  }
  return json(result);
}

export async function handleTeamConflicts(
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
  const fileErr = validateFileArray(files, ACTIVITY_MAX_FILES);
  if (fileErr) return json({ error: fileErr }, 400);

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await (team as any).checkConflicts(agentId, files, user.id);
  if (result.error) {
    log.warn(`checkConflicts failed: ${result.error}`);
    return json({ error: result.error }, 403);
  }
  return json(result);
}

export async function handleTeamFile(
  request: Request,
  user: User,
  env: Env,
  teamId: string,
): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const b = body as Record<string, unknown>;
  const { file } = b;
  if (typeof file !== 'string' || !file.trim()) {
    return json({ error: 'file must be a non-empty string' }, 400);
  }
  if (file.length > MAX_FILE_PATH_LENGTH) {
    return json({ error: 'file path too long' }, 400);
  }

  const db = getDB(env);
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);

  return withRateLimit(
    db,
    `file:${user.id}`,
    RATE_LIMIT_FILE_REPORTS,
    'File report limit reached (500/day). Try again tomorrow.',
    async () => {
      const result = await (team as any).reportFile(agentId, file, user.id);
      if (result.error) {
        log.warn(`reportFile failed: ${result.error}`);
        return json({ error: result.error }, teamErrorStatus(result));
      }
      return json(result);
    },
  );
}

export async function handleTeamStartSession(
  request: Request,
  user: User,
  env: Env,
  teamId: string,
): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const b = body as Record<string, unknown>;
  const framework =
    typeof b.framework === 'string' ? b.framework.slice(0, MAX_FRAMEWORK_LENGTH) : 'unknown';

  const db = getDB(env);
  const runtime = getAgentRuntime(request, user);
  const agentId = runtime.agentId;
  const team = getTeam(env, teamId);

  return withRateLimit(
    db,
    `session:${user.id}`,
    RATE_LIMIT_SESSIONS,
    'Session limit reached. Try again tomorrow.',
    async () => {
      const result = await (team as any).startSession(
        agentId,
        user.handle,
        framework,
        runtime,
        user.id,
      );
      if (result.error) {
        log.warn(`startSession failed: ${result.error}`);
        return json({ error: result.error }, teamErrorStatus(result));
      }
      auditLog('session.start', {
        actor: user.handle,
        outcome: 'success',
        meta: { team_id: teamId, session_id: result.session_id },
      });
      return json(result, 201);
    },
  );
}

export async function handleTeamEndSession(
  request: Request,
  user: User,
  env: Env,
  teamId: string,
): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const b = body as Record<string, unknown>;
  const { session_id } = b;
  if (typeof session_id !== 'string') {
    return json({ error: 'session_id is required' }, 400);
  }

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await (team as any).endSession(agentId, session_id, user.id);
  if (result.error) {
    log.warn(`endSession failed: ${result.error}`);
    return json({ error: result.error }, teamErrorStatus(result));
  }
  auditLog('session.end', {
    actor: user.handle,
    outcome: 'success',
    meta: { team_id: teamId, session_id },
  });
  return json(result);
}

export async function handleTeamSessionEdit(
  request: Request,
  user: User,
  env: Env,
  teamId: string,
): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const b = body as Record<string, unknown>;
  const { file } = b;
  if (typeof file !== 'string' || !file.trim()) {
    return json({ error: 'file is required' }, 400);
  }
  if (file.length > MAX_FILE_PATH_LENGTH) return json({ error: 'file path too long' }, 400);

  const db = getDB(env);
  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);

  return withRateLimit(
    db,
    `edit:${user.id}`,
    RATE_LIMIT_EDITS,
    'Edit recording limit reached. Try again tomorrow.',
    async () => {
      const result = await (team as any).recordEdit(agentId, file, user.id);
      if (result.error) {
        log.warn(`recordEdit failed: ${result.error}`);
        return json({ error: result.error }, teamErrorStatus(result));
      }
      return json(result);
    },
  );
}

export async function handleTeamHistory(
  request: Request,
  user: User,
  env: Env,
  teamId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parseInt(url.searchParams.get('days') || String(HISTORY_DEFAULT_DAYS), 10);
  const days = Math.max(
    1,
    Math.min(isNaN(parsed) ? HISTORY_DEFAULT_DAYS : parsed, HISTORY_MAX_DAYS),
  );

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await (team as any).getHistory(agentId, days, user.id);
  if (result.error) {
    log.warn(`getHistory failed: ${result.error}`);
    return json({ error: result.error }, 403);
  }
  return json(result);
}

export async function handleTeamEnrichModel(
  request: Request,
  user: User,
  env: Env,
  teamId: string,
): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const b = body as Record<string, unknown>;
  const { model } = b;
  if (typeof model !== 'string' || !model.trim()) {
    return json({ error: 'model is required' }, 400);
  }
  if (model.length > MAX_MODEL_LENGTH) {
    return json({ error: `model must be ${MAX_MODEL_LENGTH} characters or less` }, 400);
  }

  const { agentId } = getAgentRuntime(request, user);
  const team = getTeam(env, teamId);
  const result = await (team as any).enrichModel(agentId, model.trim(), user.id);
  if (result.error) {
    log.warn(`enrichModel failed: ${result.error}`);
    return json({ error: result.error }, teamErrorStatus(result));
  }
  return json(result);
}
