// Rate-limit overflow coverage for the team-scoped creation routes.
//
// The atomic check-and-consume path has unit coverage at the middleware level
// (routes that share the same helper), but the end-to-end story - "20 saves
// then the 21st refuses" - was never exercised. This file walks a small
// handful of limits end-to-end through the real DO call path so that future
// changes to rate-limit plumbing cannot silently regress the refusal.
//
// Memory saves are the fastest limit to exhaust at 20/day, so they stand in
// for the shared pattern.

import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

async function createAuthUser() {
  const db = env.DATABASE.get(env.DATABASE.idFromName('main'));
  const user = await db.createUser();
  await env.AUTH_KV.put(`token:${user.token}`, user.id);
  return {
    user,
    token: user.token,
    headers: {
      Authorization: `Bearer ${user.token}`,
      'Content-Type': 'application/json',
    },
  };
}

async function createTeamWithUser() {
  const auth = await createAuthUser();
  const createRes = await SELF.fetch('http://localhost/teams', {
    method: 'POST',
    headers: auth.headers,
  });
  const { team_id } = (await createRes.json()) as { team_id: string };
  // Join turns the creator into a member (createTeam alone does not).
  await SELF.fetch(`http://localhost/teams/${team_id}/join`, {
    method: 'POST',
    headers: auth.headers,
    body: JSON.stringify({}),
  });
  return { ...auth, teamId: team_id };
}

describe('memory save rate limit', () => {
  it('accepts exactly RATE_LIMIT_MEMORIES saves in a day, then refuses', async () => {
    const { teamId, headers } = await createTeamWithUser();

    // Exhaust the limit. Body text is unique per call so moderation cannot
    // dedupe us out of a slot.
    const limit = 20; // mirrors RATE_LIMIT_MEMORIES in lib/constants.ts
    for (let i = 0; i < limit; i++) {
      const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: `ratelimit-probe-${i}`, tags: ['probe', `n${i}`] }),
      });
      // 200/201 on happy save, 503 if moderation is unavailable in the test
      // env - all three are non-refusals as far as the rate limiter is
      // concerned.
      expect([200, 201, 503], `save ${i} unexpectedly got ${res.status}`).toContain(res.status);
    }

    // The next save should be refused by the limiter, not by validation.
    const over = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'over-the-limit', tags: ['probe'] }),
    });
    expect(over.status, `expected a 429 after ${limit} saves but got ${over.status}`).toBe(429);
  }, 20_000);
});
