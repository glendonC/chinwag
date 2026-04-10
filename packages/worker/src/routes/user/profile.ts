// Profile management -- handle, color, status, agent profile, presence heartbeat.

import { checkContent } from '../../moderation.js';
import { getDB, getLobby, rpc } from '../../lib/env.js';
import { json } from '../../lib/http.js';
import { createLogger } from '../../lib/logger.js';
import { sanitizeTags } from '../../lib/request-utils.js';
import { authedRoute, authedJsonRoute, doResult } from '../../lib/middleware.js';
import { MAX_STATUS_LENGTH, MAX_FRAMEWORK_LENGTH, VALID_COLORS_SET } from '../../lib/constants.js';

const log = createLogger('routes.user.profile');

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
