// Profile management -- handle, color, status, agent profile, presence heartbeat.

import type { Env, User } from '../../types.js';
import type { RouteHandler } from '../../lib/router.js';
import { checkContent } from '../../moderation.js';
import { getDB, getLobby, rpc } from '../../lib/env.js';
import { json } from '../../lib/http.js';
import { createLogger } from '../../lib/logger.js';
import { sanitizeTags } from '../../lib/request-utils.js';
import { authedRoute, authedJsonRoute, doResult } from '../../lib/middleware.js';
import { auditLog } from '../../lib/audit.js';
import { MAX_STATUS_LENGTH, MAX_FRAMEWORK_LENGTH, VALID_COLORS_SET } from '../../lib/constants.js';

const log = createLogger('routes.user.profile');

// GET /me — return the caller's profile minus the internal id.
// The id is the DO storage key and not something the client needs.
export const handleMe: RouteHandler = (_req: Request, _env: Env, user: User | null) => {
  const { id: _id, ...profile } = user as User;
  return json(profile);
};

export const handleUnlinkGithub = authedRoute(async ({ user, env }) => {
  return doResult(getDB(env).unlinkGithub(user.id), 'unlinkGithub');
});

export const handleUpdateHandle = authedJsonRoute(async ({ user, env, body }) => {
  const { handle } = body;
  if (!handle || typeof handle !== 'string') {
    return json({ error: 'Handle is required' }, 400);
  }
  // Validate format before moderation — no point running AI on something we'll reject
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(handle)) {
    return json({ error: 'Handle must be 3-20 characters, alphanumeric + underscores only' }, 400);
  }

  const modResult = await checkContent(handle, env);
  if (modResult.blocked) {
    if (modResult.reason === 'moderation_unavailable') {
      log.warn('content moderation unavailable: blocking content as fail-safe');
      return json(
        { error: 'Content moderation is temporarily unavailable. Please try again.' },
        503,
      );
    }
    return json({ error: 'Content blocked' }, 400);
  }

  return doResult(getDB(env).updateHandle(user.id, handle), 'updateHandle');
});

export const handleUpdateColor = authedJsonRoute(async ({ user, env, body }) => {
  const { color } = body;
  if (!color || typeof color !== 'string') {
    return json({ error: 'Color is required' }, 400);
  }
  if (!VALID_COLORS_SET.has(color)) {
    return json(
      { error: `Invalid color. Must be one of: ${[...VALID_COLORS_SET].join(', ')}` },
      400,
    );
  }

  return doResult(getDB(env).updateColor(user.id, color), 'updateColor');
});

export const handleSetStatus = authedJsonRoute(async ({ user, env, body }) => {
  const { status } = body;
  if (!status || typeof status !== 'string') {
    return json({ error: 'Status is required' }, 400);
  }
  if (status.length > MAX_STATUS_LENGTH) {
    return json({ error: `Status must be ${MAX_STATUS_LENGTH} characters or less` }, 400);
  }

  const modResult = await checkContent(status, env);
  if (modResult.blocked) {
    if (modResult.reason === 'moderation_unavailable') {
      log.warn('content moderation unavailable: blocking content as fail-safe');
      return json(
        { error: 'Content moderation is temporarily unavailable. Please try again.' },
        503,
      );
    }
    return json({ error: 'Status blocked by content filter. Please revise.' }, 400);
  }

  const result = rpc(await getDB(env).setStatus(user.id, status));
  if ('error' in result) {
    log.warn(`setStatus failed: ${result.error}`);
    return json({ error: result.error }, 400);
  }
  return json({ ok: true });
});

export const handleClearStatus = authedRoute(async ({ user, env }) => {
  const result = rpc(await getDB(env).setStatus(user.id, null));
  if ('error' in result) {
    log.warn(`clearStatus failed: ${result.error}`);
    return json({ error: result.error }, 400);
  }
  return json({ ok: true });
});

export const handleHeartbeat = authedRoute(async ({ request, user, env }) => {
  const country = request.headers.get('CF-IPCountry') || null;
  const result = rpc(await getLobby(env).heartbeat(user.handle, country));
  if ('error' in result) {
    log.warn(`heartbeat failed: ${result.error}`);
    return json({ error: result.error }, 500);
  }
  return json({ ok: true });
});

export const handleUpdateAgentProfile = authedJsonRoute(async ({ user, env, body }) => {
  const profile = {
    framework:
      typeof body.framework === 'string' ? body.framework.slice(0, MAX_FRAMEWORK_LENGTH) : null,
    languages: sanitizeTags(body.languages),
    frameworks: sanitizeTags(body.frameworks),
    tools: sanitizeTags(body.tools),
    platforms: sanitizeTags(body.platforms),
  };

  return doResult(getDB(env).updateAgentProfile(user.id, profile), 'updateAgentProfile');
});

export const handleGlobalRank = authedRoute(async ({ user, env }) => {
  return doResult(getDB(env).getUserGlobalRank(user.handle), 'getUserGlobalRank');
});

export const handleUpdateBudgets = authedJsonRoute(async ({ user, env, body }) => {
  // `null` / missing budgets clears the override; an object is re-validated
  // in the DO via parseBudgetConfig so unknown or malformed fields drop out.
  const input = body?.budgets === undefined ? null : body.budgets;
  return doResult(getDB(env).updateBudgets(user.id, input), 'updateBudgets');
});

/**
 * POST /me/revoke-tokens — invalidate every bearer token issued to the
 * caller. The current request's token stops working immediately on the next
 * authed call. Use cases: credential rotation, suspected compromise, account
 * security incidents.
 *
 * Implementation: stamps `tokens_revoked_at = now` on the user. The auth
 * path compares this against each token's KV `issued_at` metadata and
 * rejects any token issued before the stamp. No KV scan needed.
 */
export const handleRevokeTokens = authedRoute(async ({ user, env }) => {
  const result = rpc(await getDB(env).revokeTokens(user.id));
  if ('error' in result) {
    return json({ error: result.error }, 400);
  }
  auditLog('auth.tokens_revoked', {
    actor: user.handle,
    outcome: 'success',
    meta: { revoked_at: result.revoked_at },
  });
  return json({ ok: true, revoked_at: result.revoked_at });
});
