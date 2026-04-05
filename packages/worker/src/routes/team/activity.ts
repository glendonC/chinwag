// Team activity routes — activity reporting, conflicts, file reporting, sessions, history.

import { checkContent } from '../../moderation.js';
import { rpc } from '../../lib/env.js';
import { json } from '../../lib/http.js';
import { teamErrorStatus } from '../../lib/request-utils.js';
import { teamJsonRoute, teamRoute, doResult } from '../../lib/middleware.js';
import { validateFileArray, withRateLimit } from '../../lib/validation.js';
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

export const handleTeamActivity = teamJsonRoute(async ({ body, user, env, agentId, team }) => {
  const { files, summary } = body;
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

  return doResult(
    team.updateActivity(agentId, files as string[], summary, user.id),
    'updateActivity',
  );
});

export const handleTeamConflicts = teamJsonRoute(async ({ body, agentId, team, user }) => {
  const { files } = body;
  const fileErr = validateFileArray(files, ACTIVITY_MAX_FILES);
  if (fileErr) return json({ error: fileErr }, 400);

  return doResult(team.checkConflicts(agentId, files as string[], user.id), 'checkConflicts');
});

export const handleTeamFile = teamJsonRoute(async ({ body, user, db, agentId, team }) => {
  const { file } = body;
  if (typeof file !== 'string' || !file.trim()) {
    return json({ error: 'file must be a non-empty string' }, 400);
  }
  if (file.length > MAX_FILE_PATH_LENGTH) {
    return json({ error: 'file path too long' }, 400);
  }

  return withRateLimit(
    db,
    `file:${user.id}`,
    RATE_LIMIT_FILE_REPORTS,
    'File report limit reached (500/day). Try again tomorrow.',
    async () => {
      const result = rpc(await team.reportFile(agentId, file, user.id));
      if ('error' in result) {
        log.warn(`reportFile failed: ${result.error}`);
        return json({ error: result.error }, teamErrorStatus(result));
      }
      return json(result);
    },
  );
});

export const handleTeamStartSession = teamJsonRoute(
  async ({ body, user, db, agentId, runtime, team, teamId }) => {
    const framework =
      typeof body.framework === 'string'
        ? body.framework.slice(0, MAX_FRAMEWORK_LENGTH)
        : 'unknown';

    return withRateLimit(
      db,
      `session:${user.id}`,
      RATE_LIMIT_SESSIONS,
      'Session limit reached. Try again tomorrow.',
      async () => {
        const result = rpc(
          await team.startSession(agentId, user.handle, framework, runtime, user.id),
        );
        if ('error' in result) {
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
  },
);

export const handleTeamEndSession = teamJsonRoute(async ({ body, user, agentId, team, teamId }) => {
  const { session_id } = body;
  if (typeof session_id !== 'string') {
    return json({ error: 'session_id is required' }, 400);
  }

  const result = rpc(await team.endSession(agentId, session_id as string, user.id));
  if ('error' in result) {
    log.warn(`endSession failed: ${result.error}`);
    return json({ error: result.error }, teamErrorStatus(result));
  }
  auditLog('session.end', {
    actor: user.handle,
    outcome: 'success',
    meta: { team_id: teamId, session_id: session_id as string },
  });
  return json(result);
});

export const handleTeamSessionEdit = teamJsonRoute(async ({ body, user, db, agentId, team }) => {
  const { file } = body;
  if (typeof file !== 'string' || !file.trim()) {
    return json({ error: 'file is required' }, 400);
  }
  if (file.length > MAX_FILE_PATH_LENGTH) return json({ error: 'file path too long' }, 400);

  return withRateLimit(
    db,
    `edit:${user.id}`,
    RATE_LIMIT_EDITS,
    'Edit recording limit reached. Try again tomorrow.',
    async () => {
      const result = rpc(await team.recordEdit(agentId, file, user.id));
      if ('error' in result) {
        log.warn(`recordEdit failed: ${result.error}`);
        return json({ error: result.error }, teamErrorStatus(result));
      }
      return json(result);
    },
  );
});

export const handleTeamHistory = teamRoute(async ({ request, agentId, team, user }) => {
  const url = new URL(request.url);
  const parsed = parseInt(url.searchParams.get('days') || String(HISTORY_DEFAULT_DAYS), 10);
  const days = Math.max(
    1,
    Math.min(isNaN(parsed) ? HISTORY_DEFAULT_DAYS : parsed, HISTORY_MAX_DAYS),
  );

  return doResult(team.getHistory(agentId, days, user.id), 'getHistory');
});

export const handleTeamEnrichModel = teamJsonRoute(async ({ body, agentId, team, user }) => {
  const { model } = body;
  if (typeof model !== 'string' || !model.trim()) {
    return json({ error: 'model is required' }, 400);
  }
  if (model.length > MAX_MODEL_LENGTH) {
    return json({ error: `model must be ${MAX_MODEL_LENGTH} characters or less` }, 400);
  }

  return doResult(team.enrichModel(agentId, (model as string).trim(), user.id), 'enrichModel');
});
