// Token revocation lifecycle tests.
//
// Covers the contract introduced by migration 009 + auth.ts changes:
//
//   1. New tokens carry `issued_at` metadata in KV.
//   2. POST /me/revoke-tokens stamps `tokens_revoked_at` on the user.
//   3. Tokens issued BEFORE the stamp are rejected by subsequent auth.
//   4. Tokens issued AFTER the stamp work (re-running init issues a fresh
//      one with `issued_at = now`).
//   5. Legacy tokens without metadata still authenticate (backward compat).

import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

async function createAuthUser() {
  const db = env.DATABASE.get(env.DATABASE.idFromName('main'));
  const user = await db.createUser();
  await env.AUTH_KV.put(`token:${user.token}`, user.id, {
    metadata: { issued_at: new Date().toISOString() },
  });
  return {
    user,
    token: user.token,
    headers: {
      Authorization: `Bearer ${user.token}`,
      'Content-Type': 'application/json',
    },
  };
}

describe('POST /me/revoke-tokens', () => {
  it('returns ok with revoked_at timestamp', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/revoke-tokens', {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.revoked_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('returns 401 when called without auth', async () => {
    const res = await SELF.fetch('http://localhost/me/revoke-tokens', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('rejects the same token after revocation', async () => {
    const { headers } = await createAuthUser();

    // Token works before revocation
    const before = await SELF.fetch('http://localhost/me', { headers });
    expect(before.status).toBe(200);

    // Revoke
    const revoke = await SELF.fetch('http://localhost/me/revoke-tokens', {
      method: 'POST',
      headers,
    });
    expect(revoke.status).toBe(200);

    // Same token now fails. The stamp is at second-resolution and the
    // token's issued_at was milliseconds before, so the strict-less-than
    // comparison may not yet hit. Wait one second to cross the boundary.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const after = await SELF.fetch('http://localhost/me', { headers });
    expect(after.status).toBe(401);
  });

  it('does NOT reject legacy tokens (no issued_at metadata)', async () => {
    // Simulate a token written before migration 009 / auth.ts changes.
    const db = env.DATABASE.get(env.DATABASE.idFromName('main'));
    const user = await db.createUser();
    await env.AUTH_KV.put(`token:${user.token}`, user.id); // no metadata
    const headers = { Authorization: `Bearer ${user.token}` };

    // Stamp tokens_revoked_at
    await db.revokeTokens(user.id);

    // Wait past the same boundary the previous test crossed
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Legacy token without issued_at is treated as un-revokable (we can't
    // tell when it was issued, so we don't kick the user out). Better than
    // false-logout for users on the day of the migration.
    const res = await SELF.fetch('http://localhost/me', { headers });
    expect(res.status).toBe(200);
  });

  it('lets a freshly-issued post-revocation token authenticate', async () => {
    const db = env.DATABASE.get(env.DATABASE.idFromName('main'));
    const user = await db.createUser();
    await env.AUTH_KV.put(`token:${user.token}`, user.id, {
      metadata: { issued_at: new Date().toISOString() },
    });

    // Revoke then wait past the second boundary
    await db.revokeTokens(user.id);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Issue a fresh token (mimics re-running `chinmeister init`)
    const freshToken = crypto.randomUUID();
    await env.AUTH_KV.put(`token:${freshToken}`, user.id, {
      metadata: { issued_at: new Date().toISOString() },
    });

    const headers = { Authorization: `Bearer ${freshToken}` };
    const res = await SELF.fetch('http://localhost/me', { headers });
    expect(res.status).toBe(200);
  });
});

describe('revokeTokens DO method', () => {
  it('returns NOT_FOUND for unknown user', async () => {
    const db = env.DATABASE.get(env.DATABASE.idFromName('main'));
    const result = await db.revokeTokens('nonexistent-uuid');
    expect(result.error).toBe('User not found');
    expect(result.code).toBe('NOT_FOUND');
  });

  it('writes tokens_revoked_at to the users table', async () => {
    const db = env.DATABASE.get(env.DATABASE.idFromName('main'));
    const user = await db.createUser();
    const before = await db.getUser(user.id);
    expect(before.user.tokens_revoked_at).toBeFalsy();

    const result = await db.revokeTokens(user.id);
    expect(result.ok).toBe(true);

    const after = await db.getUser(user.id);
    expect(after.user.tokens_revoked_at).toBeTruthy();
  });
});
