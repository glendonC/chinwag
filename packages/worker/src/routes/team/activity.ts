// Team activity routes — activity reporting, conflicts, file reporting, sessions, history.

import { checkContent } from '../../moderation.js';
import { rpc } from '../../lib/env.js';
import { json } from '../../lib/http.js';
import { teamErrorStatus, getAgentRuntime } from '../../lib/request-utils.js';
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
  const { files, source } = body;
  const fileErr = validateFileArray(files, ACTIVITY_MAX_FILES);
  if (fileErr) return json({ error: fileErr }, 400);

  // Only trust the enum; anything else collapses to advisory so a malformed
  // client can't inflate the blocked-count metric.
  const checkSource: 'hook' | 'advisory' = source === 'hook' ? 'hook' : 'advisory';

  return doResult(
    team.checkConflicts(agentId, files as string[], user.id, checkSource),
    'checkConflicts',
  );
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

export const handleTeamEndSession = teamJsonRoute(
  async ({ body, user, agentId, team, teamId, db }) => {
    const { session_id } = body;
    if (typeof session_id !== 'string') {
      return json({ error: 'session_id is required' }, 400);
    }

    const raw = await team.endSession(agentId, session_id as string, user.id);
    const result = rpc(raw) as unknown as Record<string, unknown>;
    if ('error' in result) {
      log.warn(`endSession failed: ${result.error}`);
      return json(
        { error: result.error },
        teamErrorStatus(result as { error: string; code?: string }),
      );
    }

    // Write-through to global user metrics (fire-and-forget).
    // Failures are non-fatal for the session-end response but must be visible:
    // a silent regression here would rot cross-project analytics without any
    // signal to operators.
    const summary = result.summary as Record<string, unknown> | null;
    if (summary) {
      summary.outcome = result.outcome as string | null;
      db.updateUserMetrics(user.handle, summary).catch((err: unknown) => {
        log.warn('updateUserMetrics failed for session end', {
          handle: user.handle,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    auditLog('session.end', {
      actor: user.handle,
      outcome: 'success',
      meta: { team_id: teamId, session_id: session_id as string },
    });
    return json({ ok: true, outcome: result.outcome });
  },
);

const MAX_DIFF_LINES = 100000;

export const handleTeamSessionEdit = teamJsonRoute(async ({ body, user, db, agentId, team }) => {
  const { file } = body;
  if (typeof file !== 'string' || !file.trim()) {
    return json({ error: 'file is required' }, 400);
  }
  if (file.length > MAX_FILE_PATH_LENGTH) return json({ error: 'file path too long' }, 400);

  // Optional diff stats (lines added/removed) — privacy-safe counts only
  const linesAdded = Math.max(0, Math.min(Number(body.lines_added) || 0, MAX_DIFF_LINES));
  const linesRemoved = Math.max(0, Math.min(Number(body.lines_removed) || 0, MAX_DIFF_LINES));

  return withRateLimit(
    db,
    `edit:${user.id}`,
    RATE_LIMIT_EDITS,
    'Edit recording limit reached. Try again tomorrow.',
    async () => {
      const result = rpc(await team.recordEdit(agentId, file, linesAdded, linesRemoved, user.id));
      if ('error' in result) {
        log.warn(`recordEdit failed: ${result.error}`);
        return json({ error: result.error }, teamErrorStatus(result));
      }
      return json(result);
    },
  );
});

export const handleTeamReportOutcome = teamJsonRoute(
  async ({ body, user, env, db, agentId, team }) => {
    const { outcome, summary, outcome_tags } = body;
    if (typeof outcome !== 'string' || !['completed', 'abandoned', 'failed'].includes(outcome)) {
      return json({ error: 'outcome must be completed, abandoned, or failed' }, 400);
    }

    const summaryStr = typeof summary === 'string' ? summary.slice(0, 500) : null;
    if (summaryStr) {
      const modResult = await checkContent(summaryStr, env);
      if (modResult.blocked) return json({ error: 'Content blocked' }, 400);
    }

    const tags = Array.isArray(outcome_tags)
      ? outcome_tags.filter((t): t is string => typeof t === 'string').slice(0, 10)
      : null;

    return withRateLimit(
      db,
      `session:${user.id}`,
      RATE_LIMIT_SESSIONS,
      'Session operation limit reached. Try again tomorrow.',
      async () => {
        return doResult(
          team.reportOutcome(agentId, outcome, summaryStr, user.id, tags),
          'reportOutcome',
        );
      },
    );
  },
);

export const handleTeamHistory = teamRoute(async ({ request, agentId, team, user }) => {
  const url = new URL(request.url);
  const parsed = parseInt(url.searchParams.get('days') || String(HISTORY_DEFAULT_DAYS), 10);
  const days = Math.max(
    1,
    Math.min(isNaN(parsed) ? HISTORY_DEFAULT_DAYS : parsed, HISTORY_MAX_DAYS),
  );

  return doResult(team.getHistory(agentId, days, user.id), 'getHistory');
});

const EDITS_DEFAULT_LIMIT = 200;
const EDITS_MAX_LIMIT = 500;

export const handleTeamEditHistory = teamRoute(async ({ request, agentId, team, user }) => {
  const url = new URL(request.url);
  const parsed = parseInt(url.searchParams.get('days') || String(HISTORY_DEFAULT_DAYS), 10);
  const days = Math.max(
    1,
    Math.min(isNaN(parsed) ? HISTORY_DEFAULT_DAYS : parsed, HISTORY_MAX_DAYS),
  );

  const file = url.searchParams.get('file') || null;
  if (file && file.length > MAX_FILE_PATH_LENGTH) return json({ error: 'file path too long' }, 400);

  const handle = url.searchParams.get('handle') || null;

  const parsedLimit = parseInt(url.searchParams.get('limit') || String(EDITS_DEFAULT_LIMIT), 10);
  const limit = Math.max(
    1,
    Math.min(isNaN(parsedLimit) ? EDITS_DEFAULT_LIMIT : parsedLimit, EDITS_MAX_LIMIT),
  );

  return doResult(
    team.getEditHistory(agentId, days, file, handle, limit, user.id),
    'getEditHistory',
  );
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

const MAX_TOKEN_VALUE = 100_000_000;

/**
 * Validate an optional token field. Missing (undefined) defaults to 0 so old
 * CLI versions that don't send cache fields continue to work. Null or
 * non-numeric is a client bug and gets rejected.
 */
function validateTokenField(
  value: unknown,
  name: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: 0 };
  if (typeof value !== 'number' || value < 0 || value > MAX_TOKEN_VALUE) {
    return { ok: false, error: `${name} must be a non-negative number` };
  }
  return { ok: true, value };
}

export const handleTeamRecordTokens = teamJsonRoute(async ({ body, user, db, agentId, team }) => {
  const { session_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens } =
    body;
  if (typeof session_id !== 'string' || !session_id.trim()) {
    return json({ error: 'session_id is required' }, 400);
  }
  // input/output are required for every record_tokens call. Cache fields are
  // optional to keep old CLI builds working during the Phase 2 rollout.
  if (typeof input_tokens !== 'number' || input_tokens < 0 || input_tokens > MAX_TOKEN_VALUE) {
    return json({ error: 'input_tokens must be a non-negative number' }, 400);
  }
  if (typeof output_tokens !== 'number' || output_tokens < 0 || output_tokens > MAX_TOKEN_VALUE) {
    return json({ error: 'output_tokens must be a non-negative number' }, 400);
  }
  const cacheRead = validateTokenField(cache_read_tokens, 'cache_read_tokens');
  if (!cacheRead.ok) return json({ error: cacheRead.error }, 400);
  const cacheCreation = validateTokenField(cache_creation_tokens, 'cache_creation_tokens');
  if (!cacheCreation.ok) return json({ error: cacheCreation.error }, 400);

  return withRateLimit(
    db,
    `session:${user.id}`,
    RATE_LIMIT_SESSIONS,
    'Session operation limit reached. Try again tomorrow.',
    async () => {
      return doResult(
        team.recordTokenUsage(
          agentId,
          session_id as string,
          input_tokens,
          output_tokens,
          cacheRead.value,
          cacheCreation.value,
          user.id,
        ),
        'recordTokenUsage',
      );
    },
  );
});

const MAX_COMMITS_BATCH = 50;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

export const handleTeamRecordCommits = teamJsonRoute(
  async ({ body, request, user, db, agentId, team }) => {
    const { session_id, commits } = body;
    // session_id is optional — if omitted, the backend resolves the active session
    const resolvedSessionId =
      typeof session_id === 'string' && session_id.trim() ? session_id : null;
    if (!Array.isArray(commits) || commits.length === 0) {
      return json({ error: 'commits must be a non-empty array' }, 400);
    }
    if (commits.length > MAX_COMMITS_BATCH) {
      return json({ error: `commits limited to ${MAX_COMMITS_BATCH} per batch` }, 400);
    }

    // Validate each commit SHA
    for (const c of commits) {
      if (typeof c.sha !== 'string' || !SHA_PATTERN.test(c.sha.toLowerCase())) {
        return json({ error: `Invalid commit SHA: ${String(c.sha).slice(0, 50)}` }, 400);
      }
    }

    const runtime = getAgentRuntime(request, user);
    const handle = user.handle;
    const hostTool = (typeof runtime === 'object' ? runtime?.hostTool : runtime) || 'unknown';

    return withRateLimit(
      db,
      `session:${user.id}`,
      RATE_LIMIT_SESSIONS,
      'Session operation limit reached. Try again tomorrow.',
      async () => {
        return doResult(
          team.recordCommits(
            agentId,
            resolvedSessionId,
            handle,
            hostTool as string,
            commits,
            user.id,
          ),
          'recordCommits',
        );
      },
    );
  },
);

const MAX_TOOL_CALLS_BATCH = 500;

export const handleTeamToolCalls = teamJsonRoute(
  async ({ body, request, user, db, agentId, team }) => {
    const { session_id, calls } = body;
    if (typeof session_id !== 'string' || !session_id.trim()) {
      return json({ error: 'session_id is required' }, 400);
    }
    if (!Array.isArray(calls) || calls.length === 0) {
      return json({ error: 'calls must be a non-empty array' }, 400);
    }
    if (calls.length > MAX_TOOL_CALLS_BATCH) {
      return json({ error: `calls limited to ${MAX_TOOL_CALLS_BATCH} per batch` }, 400);
    }

    const runtime = getAgentRuntime(request, user);
    const handle = user.handle;
    const hostTool = (typeof runtime === 'object' ? runtime?.hostTool : runtime) || 'unknown';

    return withRateLimit(
      db,
      `session:${user.id}`,
      RATE_LIMIT_SESSIONS,
      'Session operation limit reached. Try again tomorrow.',
      async () => {
        return doResult(
          team.recordToolCalls(
            agentId,
            session_id as string,
            handle,
            hostTool as string,
            calls,
            user.id,
          ),
          'recordToolCalls',
        );
      },
    );
  },
);
