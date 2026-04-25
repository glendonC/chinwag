// GDPR data export and erasure tests.
//
// These cover the right-of-access (Art. 15) and right-to-erasure (Art. 17)
// flows added in routes/user/data.ts:
//
//   GET  /me/data/export — fan-out across all the user's TeamDOs, bundle
//                          their per-user records into a single JSON.
//   POST /me/data/delete — same fan-out, transactional cascade delete.
//                          Auto-revokes the user's bearer tokens.
//
// Chaos coverage is intentional: we fan out to a "broken team" (a row in
// user_teams that doesn't have backing TeamDO data the way a real team
// would) to verify the partial-success pathway works and never 500s the
// caller's request.

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

function makeTeamId() {
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `t_${hex}`;
}

describe('GET /me/data/export', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://localhost/me/data/export');
    expect(res.status).toBe(401);
  });

  it('returns an empty bundle for a user with no teams', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/data/export', { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user.id).toBeTruthy();
    expect(body.user.handle).toBeTruthy();
    expect(body.teams).toEqual([]);
    expect(body.failed_teams).toEqual([]);
  });

  it("bundles the user's data from each team they belong to", async () => {
    const { headers, user } = await createAuthUser();

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Project X' }),
    });
    expect(createRes.status).toBe(201);
    const { team_id } = await createRes.json();

    // Save a memory through the actual HTTP route so the agent_id, member
    // row, and authoring metadata all wire up the way they would in
    // production. POST /teams/:tid/memory requires the caller to already be
    // a team member (the team-create flow auto-joins).
    const saveRes = await SELF.fetch(`http://localhost/teams/${team_id}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'auth uses JWT in checkAuth()', tags: ['auth'] }),
    });
    expect(saveRes.status).toBe(201);

    const res = await SELF.fetch('http://localhost/me/data/export', { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams).toHaveLength(1);
    const teamBundle = body.teams[0];
    expect(teamBundle.team_id).toBe(team_id);
    expect(teamBundle.handle).toBe(user.handle);
    expect(teamBundle.memories_authored.length).toBeGreaterThanOrEqual(1);
    expect(teamBundle.memories_authored[0].text).toBe('auth uses JWT in checkAuth()');
  });

  it('partial-success: degraded teams land in failed_teams without 500ing', async () => {
    const { headers, user } = await createAuthUser();
    const db = env.DATABASE.get(env.DATABASE.idFromName('main'));

    // One real team
    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Real Project' }),
    });
    const { team_id: realTeamId } = await createRes.json();

    // One "broken" team: roster row exists but the user has no team_owners
    // entry on the TeamDO side (because the team was never actually joined
    // via the /teams/:tid/join flow). exportUserData's #withOwner gate
    // returns NOT_MEMBER, so this team lands in failed_teams.
    await db.addUserTeam(user.id, makeTeamId(), 'Broken Project');

    const res = await SELF.fetch('http://localhost/me/data/export', { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams.map((t) => t.team_id)).toContain(realTeamId);
    expect(body.failed_teams).toHaveLength(1);
    expect(body.failed_teams[0].team_name).toBe('Broken Project');
  });
});

describe('POST /me/data/delete', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://localhost/me/data/delete', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns an empty receipt for a user with no teams', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/data/delete', {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.teams).toEqual([]);
    expect(body.failed_teams).toEqual([]);
  });

  it("deletes the user's per-team data and returns row counts", async () => {
    const { headers } = await createAuthUser();

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Project Y' }),
    });
    const { team_id } = await createRes.json();

    await SELF.fetch(`http://localhost/teams/${team_id}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'memory to be deleted', tags: ['gdpr'] }),
    });

    // Confirm the memory is there
    const exportBefore = await SELF.fetch('http://localhost/me/data/export', { headers });
    const beforeBody = await exportBefore.json();
    expect(beforeBody.teams[0].memories_authored.length).toBeGreaterThanOrEqual(1);

    // Delete
    const res = await SELF.fetch('http://localhost/me/data/delete', {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].counts.memories).toBeGreaterThanOrEqual(1);

    // Wait past the token-revocation second boundary so the caller's token
    // is rejected, then verify re-auth is required.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const after = await SELF.fetch('http://localhost/me/data/export', { headers });
    expect(after.status).toBe(401);
  });

  it('partial-success: failed teams land in failed_teams', async () => {
    const { headers, user } = await createAuthUser();
    const db = env.DATABASE.get(env.DATABASE.idFromName('main'));

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Real' }),
    });
    const { team_id: realTeamId } = await createRes.json();

    // Broken team — same trick as the export test
    await db.addUserTeam(user.id, makeTeamId(), 'Broken');

    const res = await SELF.fetch('http://localhost/me/data/delete', {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams.map((t) => t.team_id)).toContain(realTeamId);
    expect(body.failed_teams).toHaveLength(1);
    expect(body.failed_teams[0].team_name).toBe('Broken');
  });
});
