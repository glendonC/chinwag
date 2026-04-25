// Authentication -- authenticate(), token refresh, WS ticket creation.

import type { Env, User } from '../../types.js';
import { getDB, rpc } from '../../lib/env.js';
import { json, parseBody } from '../../lib/http.js';
import { requireJson, withRateLimit } from '../../lib/validation.js';
import { authedRoute, publicRoute } from '../../lib/middleware.js';
import { auditLog } from '../../lib/audit.js';
import { RATE_LIMIT_TOKEN_REFRESH, RATE_LIMIT_WS_TICKETS } from '../../lib/constants.js';

/**
 * Token KV value shape. We keep the field flat (not nested in metadata) so
 * existing entries written before token-revocation rolled out still resolve
 * to a string user_id and the auth path stays backward-compatible.
 */
interface TokenKvMeta {
  /** Wall-clock ISO timestamp when this token was issued. */
  issued_at?: string;
}

/**
 * Returns true when a token issued at `issuedAt` has been revoked by a later
 * `tokens_revoked_at` stamp on the user. Treats malformed or missing
 * timestamps conservatively: if we can't tell, we don't revoke (avoids
 * false-logout on legacy KV entries written before the revocation column
 * existed).
 *
 * Format note: `tokens_revoked_at` is stored via SQLite's `datetime('now')`
 * (`"YYYY-MM-DD HH:MM:SS"`, UTC, no zone marker). KV `issued_at` metadata
 * is stored via `new Date().toISOString()` (`"YYYY-MM-DDTHH:MM:SSZ"`). Both
 * formats need to compare against the same wall-clock domain — `Date.parse`
 * applied directly to the SQLite format treats it as local time on some
 * engines, which produces a several-hour skew. Normalise the SQLite format
 * to ISO before parsing.
 */
function parseSqlDateTimeAsUtc(value: string): number {
  // "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SSZ"
  const isoish = value.includes('T') ? value : value.replace(' ', 'T');
  const withZone = /Z$|[+-]\d{2}:?\d{2}$/.test(isoish) ? isoish : `${isoish}Z`;
  return Date.parse(withZone);
}

function isTokenRevoked(
  user: { tokens_revoked_at?: string | null },
  issuedAt: string | undefined,
): boolean {
  if (!user.tokens_revoked_at) return false;
  if (!issuedAt) return false;
  const revoked = parseSqlDateTimeAsUtc(user.tokens_revoked_at);
  const issued = parseSqlDateTimeAsUtc(issuedAt);
  if (Number.isNaN(revoked) || Number.isNaN(issued)) return false;
  return issued < revoked;
}

export async function authenticate(request: Request, env: Env): Promise<User | null> {
  const auth = request.headers.get('Authorization');
  let token: string | undefined;
  if (auth?.startsWith('Bearer ')) {
    token = auth.slice(7);
  } else if (request.headers.get('Upgrade') === 'websocket') {
    const url = new URL(request.url);
    // Prefer ticket (short-lived, single-use) over token for WS auth
    const ticket = url.searchParams.get('ticket');
    if (ticket) {
      // TOCTOU: KV get-then-delete is not atomic. Two concurrent requests with the
      // same ticket could both pass the null check before either deletes the key.
      // Risk is minimal: tickets are random UUIDs with 30s TTL, rate-limited, and the
      // race window is sub-millisecond within a single CF colo. Atomic delete would
      // require a Durable Object, adding latency for negligible security gain.
      const kvKey = `ticket:${ticket}`;
      const userId = await env.AUTH_KV.get(kvKey);
      if (!userId) return null;
      await env.AUTH_KV.delete(kvKey);
      const db = getDB(env);
      if (!userId.includes('-')) {
        const result = rpc(await db.getUserByHandle(userId));
        return 'error' in result ? null : result.user;
      }
      const result = rpc(await db.getUser(userId));
      return 'error' in result ? null : result.user;
    }
  }
  if (!token) return null;

  const tokenLookup = await env.AUTH_KV.getWithMetadata<TokenKvMeta>(`token:${token}`);
  const userId = tokenLookup.value;
  if (!userId) return null;
  const issuedAt = tokenLookup.metadata?.issued_at;

  const db = getDB(env);
  if (!userId.includes('-')) {
    const result = rpc(await db.getUserByHandle(userId));
    if ('error' in result) return null;
    const user: User = result.user;
    // Verify the looked-up user's handle still matches the KV entry.
    // Prevents auth bypass when a handle is reassigned to a different user:
    // stale KV entry "token:X -> oldHandle" would resolve to the new owner.
    if (user.handle !== userId) return null;
    if (isTokenRevoked(user, issuedAt)) {
      auditLog('auth.failure', {
        actor: user.handle,
        outcome: 'failure',
        meta: { reason: 'token_revoked' },
      });
      return null;
    }
    // Migrate the legacy handle-keyed entry to id-keyed, preserving issued_at
    // metadata so revocation continues to apply across the rewrite.
    await env.AUTH_KV.put(`token:${token}`, user.id, {
      metadata: issuedAt ? { issued_at: issuedAt } : {},
    });
    return user;
  }

  const result = rpc(await db.getUser(userId));
  if (!('error' in result)) {
    if (isTokenRevoked(result.user, issuedAt)) {
      auditLog('auth.failure', {
        actor: result.user.handle,
        outcome: 'failure',
        meta: { reason: 'token_revoked' },
      });
      return null;
    }
    auditLog('auth.success', {
      actor: result.user.handle,
      outcome: 'success',
      meta: { method: 'token' },
    });
    return result.user;
  }
  auditLog('auth.failure', { outcome: 'failure', meta: { reason: 'user_not_found' } });
  return null;
}

export const handleRefreshToken = publicRoute(async ({ request, env }) => {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const refreshToken = (body as Record<string, unknown>)?.refresh_token;
  if (!refreshToken || typeof refreshToken !== 'string') {
    return json({ error: 'refresh_token is required' }, 400);
  }

  if (!refreshToken.startsWith('rt_')) {
    return json({ error: 'Invalid refresh token format' }, 400);
  }

  const userId = await env.AUTH_KV.get(`refresh:${refreshToken}`);
  if (!userId) {
    return json({ error: 'Invalid or expired refresh token' }, 401);
  }

  // Rate limit token refresh per user to prevent token rotation abuse
  const db = getDB(env);
  return withRateLimit(
    db,
    `token-refresh:${userId}`,
    RATE_LIMIT_TOKEN_REFRESH,
    'Token refresh limit reached. Try again later.',
    async () => {
      // Invalidate the old refresh token (rotation)
      await env.AUTH_KV.delete(`refresh:${refreshToken}`);

      // Issue new access token. Stamp issued_at so revokeTokens can
      // invalidate this entry by stamping the user's tokens_revoked_at.
      const newToken = crypto.randomUUID();
      await env.AUTH_KV.put(`token:${newToken}`, userId, {
        metadata: { issued_at: new Date().toISOString() },
      });

      // Issue new refresh token
      const newRefreshToken = `rt_${crypto.randomUUID().replace(/-/g, '')}`;
      await env.AUTH_KV.put(`refresh:${newRefreshToken}`, userId, {
        expirationTtl: 30 * 24 * 60 * 60,
        metadata: { issued_at: new Date().toISOString() },
      });

      return json({ ok: true, token: newToken, refresh_token: newRefreshToken });
    },
  );
});

export const handleGetWsTicket = authedRoute(async ({ user, env }) => {
  const db = getDB(env);
  return withRateLimit(
    db,
    `ws-ticket:${user.id}`,
    RATE_LIMIT_WS_TICKETS,
    'Ticket request limit reached. Try again later.',
    async () => {
      const ticket = `tk_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
      await env.AUTH_KV.put(`ticket:${ticket}`, user.id, { expirationTtl: 30 });
      return json({ ticket });
    },
  );
});
