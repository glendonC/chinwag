// Security boundary coverage for team-scoped routes.
//
// The premise of every /teams/:tid/* route is that the caller has to be a
// member of that team. The happy-path tests in routes-team.test.ts prove the
// routes work when you are a member; this file proves they refuse you when
// you are not.
//
// One harness per endpoint family: create two users, put one in the team,
// and drive every shaped request from the outside user. A non-member must
// not be able to read, write, claim, or message into a team they do not
// belong to.

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
  return { ...auth, teamId: team_id };
}

// Any non-member response is acceptable as long as it is not a 200. Different
// routes surface NOT_MEMBER differently (403 or 4xx with an error body); both
// are correct refusals.
function assertRefused(status: number): void {
  expect(status, `expected a refusal but got ${status}`).not.toBe(200);
  expect(status).toBeGreaterThanOrEqual(400);
}

describe('cross-team access refusal', () => {
  describe('memory routes', () => {
    it('refuses save from a non-member', async () => {
      const { teamId } = await createTeamWithUser();
      const { headers } = await createAuthUser();

      const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: 'secret note', tags: [] }),
      });
      assertRefused(res.status);
    });

    it('refuses search from a non-member', async () => {
      const { teamId } = await createTeamWithUser();
      const { headers } = await createAuthUser();

      const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory/search?q=anything`, {
        headers,
      });
      assertRefused(res.status);
    });

    it('refuses delete-batch from a non-member', async () => {
      const { teamId } = await createTeamWithUser();
      const { headers } = await createAuthUser();

      const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory/batch-delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ filter: { tags: ['demo'] } }),
      });
      assertRefused(res.status);
    });
  });

  describe('message routes', () => {
    it('refuses send from a non-member', async () => {
      const { teamId } = await createTeamWithUser();
      const { headers } = await createAuthUser();

      const res = await SELF.fetch(`http://localhost/teams/${teamId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: 'hello' }),
      });
      assertRefused(res.status);
    });

    it('refuses list from a non-member', async () => {
      const { teamId } = await createTeamWithUser();
      const { headers } = await createAuthUser();

      const res = await SELF.fetch(`http://localhost/teams/${teamId}/messages`, { headers });
      assertRefused(res.status);
    });
  });

  describe('category routes', () => {
    it('refuses create from a non-member', async () => {
      const { teamId } = await createTeamWithUser();
      const { headers } = await createAuthUser();

      const res = await SELF.fetch(`http://localhost/teams/${teamId}/categories`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'outside-cat', description: 'x' }),
      });
      assertRefused(res.status);
    });

    it('refuses list from a non-member', async () => {
      const { teamId } = await createTeamWithUser();
      const { headers } = await createAuthUser();

      const res = await SELF.fetch(`http://localhost/teams/${teamId}/categories`, { headers });
      assertRefused(res.status);
    });
  });

  describe('lock routes', () => {
    it('refuses claim from a non-member', async () => {
      const { teamId } = await createTeamWithUser();
      const { headers } = await createAuthUser();

      const res = await SELF.fetch(`http://localhost/teams/${teamId}/locks/claim`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ files: ['src/evil.ts'] }),
      });
      assertRefused(res.status);
    });

    it('refuses release from a non-member', async () => {
      const { teamId } = await createTeamWithUser();
      const { headers } = await createAuthUser();

      const res = await SELF.fetch(`http://localhost/teams/${teamId}/locks/release`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ files: ['src/evil.ts'] }),
      });
      assertRefused(res.status);
    });

    it('refuses read from a non-member', async () => {
      const { teamId } = await createTeamWithUser();
      const { headers } = await createAuthUser();

      const res = await SELF.fetch(`http://localhost/teams/${teamId}/locks`, { headers });
      assertRefused(res.status);
    });
  });

  describe('session routes', () => {
    it('refuses session start from a non-member', async () => {
      const { teamId } = await createTeamWithUser();
      const { headers } = await createAuthUser();

      const res = await SELF.fetch(`http://localhost/teams/${teamId}/sessions/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      assertRefused(res.status);
    });

    it('refuses outcome report from a non-member', async () => {
      const { teamId } = await createTeamWithUser();
      const { headers } = await createAuthUser();

      const res = await SELF.fetch(`http://localhost/teams/${teamId}/outcomes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ session_id: 'any', outcome: 'complete' }),
      });
      assertRefused(res.status);
    });
  });

  describe('analytics routes', () => {
    it('refuses analytics read from a non-member', async () => {
      const { teamId } = await createTeamWithUser();
      const { headers } = await createAuthUser();

      const res = await SELF.fetch(`http://localhost/teams/${teamId}/analytics`, { headers });
      assertRefused(res.status);
    });
  });
});
