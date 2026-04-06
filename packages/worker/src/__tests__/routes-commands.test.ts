import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// --- Test helpers (same as routes-team.test.ts) ---

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

// --- POST /teams/:tid/commands ---

describe('POST /teams/:tid/commands', () => {
  it('submits a spawn command', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/commands`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'spawn',
        payload: { tool_id: 'claude-code', task: 'fix the auth bug' },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();
  });

  it('submits a stop command', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/commands`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'stop',
        payload: { agent_id: 'claude-code:abc123' },
      }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects missing type', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/commands`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid payload type', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/commands`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'spawn', payload: 'not-an-object' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid command type', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/commands`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'reboot', payload: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    const { teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'spawn', payload: { task: 'test' } }),
    });
    expect(res.status).toBe(401);
  });
});

// --- GET /teams/:tid/commands ---

describe('GET /teams/:tid/commands', () => {
  it('lists pending commands', async () => {
    const { headers, teamId } = await createTeamWithUser();

    // Submit a command first
    await SELF.fetch(`http://localhost/teams/${teamId}/commands`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'stop', payload: { agent_id: 'test' } }),
    });

    const res = await SELF.fetch(`http://localhost/teams/${teamId}/commands`, {
      method: 'GET',
      headers,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.commands).toBeInstanceOf(Array);
    expect((body.commands as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty list when no commands', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/commands`, {
      method: 'GET',
      headers,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.commands).toBeInstanceOf(Array);
  });

  it('requires auth', async () => {
    const { teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/commands`, {
      method: 'GET',
      headers: {},
    });
    expect(res.status).toBe(401);
  });
});
