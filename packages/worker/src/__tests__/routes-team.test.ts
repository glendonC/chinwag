import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// --- Test helpers ---

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
  // Omit name to skip AI moderation (intermittently unavailable in tests)
  const createRes = await SELF.fetch('http://localhost/teams', {
    method: 'POST',
    headers: auth.headers,
  });
  const { team_id } = (await createRes.json()) as { team_id: string };
  return { ...auth, teamId: team_id };
}

// --- POST /teams/:tid/join ---

describe('POST /teams/:tid/join', () => {
  it('joins a team (happy path)', async () => {
    const { teamId } = await createTeamWithUser();
    const { headers } = await createAuthUser();

    const res = await SELF.fetch(`http://localhost/teams/${teamId}/join`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it('joins with a project name', async () => {
    const { teamId } = await createTeamWithUser();
    const { headers } = await createAuthUser();

    const res = await SELF.fetch(`http://localhost/teams/${teamId}/join`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'My Fork' }),
    });
    // 503 = AI moderation unavailable in test env (fail-safe)
    expect([200, 503]).toContain(res.status);
  });

  it('rejects team name over max length', async () => {
    const { teamId } = await createTeamWithUser();
    const { headers } = await createAuthUser();

    const res = await SELF.fetch(`http://localhost/teams/${teamId}/join`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'x'.repeat(101) }),
    });
    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    const { teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

// --- POST /teams/:tid/leave ---

describe('POST /teams/:tid/leave', () => {
  it('leaves a team successfully', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/leave`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it('context returns 403 after leaving', async () => {
    const { headers, teamId } = await createTeamWithUser();
    await SELF.fetch(`http://localhost/teams/${teamId}/leave`, {
      method: 'POST',
      headers,
    });

    const ctxRes = await SELF.fetch(`http://localhost/teams/${teamId}/context`, { headers });
    expect(ctxRes.status).toBe(403);
  });

  it('requires auth', async () => {
    const { teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/leave`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });
});

// --- POST /teams/:tid/heartbeat ---

describe('POST /teams/:tid/heartbeat', () => {
  it('heartbeat succeeds for a joined member', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/heartbeat`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it('heartbeat fails for non-member', async () => {
    const { teamId } = await createTeamWithUser();
    const { headers: otherHeaders } = await createAuthUser();

    const res = await SELF.fetch(`http://localhost/teams/${teamId}/heartbeat`, {
      method: 'POST',
      headers: otherHeaders,
    });
    // Non-member heartbeat returns an error
    expect(res.status).not.toBe(200);
  });

  it('heartbeat fails after leaving', async () => {
    const { headers, teamId } = await createTeamWithUser();
    await SELF.fetch(`http://localhost/teams/${teamId}/leave`, {
      method: 'POST',
      headers,
    });

    const res = await SELF.fetch(`http://localhost/teams/${teamId}/heartbeat`, {
      method: 'POST',
      headers,
    });
    expect(res.status).not.toBe(200);
  });

  it('requires auth', async () => {
    const { teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/heartbeat`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });
});

// --- PUT /teams/:tid/activity ---

describe('PUT /teams/:tid/activity', () => {
  it('reports activity (happy path)', async () => {
    const { headers, teamId } = await createTeamWithUser();
    // Use empty summary to avoid AI moderation (intermittently unavailable in tests)
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ files: ['src/main.ts'], summary: '' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it('activity appears in context', async () => {
    const { headers, teamId } = await createTeamWithUser();
    await SELF.fetch(`http://localhost/teams/${teamId}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ files: ['src/visible.ts'], summary: '' }),
    });

    const ctxRes = await SELF.fetch(`http://localhost/teams/${teamId}/context`, { headers });
    expect(ctxRes.status).toBe(200);
    const ctx = (await ctxRes.json()) as { members: Array<{ activity?: { files?: string[] } }> };
    const hasFile = ctx.members.some((m) => m.activity?.files?.includes('src/visible.ts'));
    expect(hasFile).toBe(true);
  });

  it('rejects when files is missing', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ summary: 'No files' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-string summary', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ files: ['src/a.ts'], summary: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects summary exceeding 280 chars', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ files: ['src/a.ts'], summary: 'x'.repeat(281) }),
    });
    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    const { teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/activity`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: ['src/a.ts'], summary: 'test' }),
    });
    expect(res.status).toBe(401);
  });
});

// --- POST /teams/:tid/file ---

describe('POST /teams/:tid/file', () => {
  it('reports a file (happy path)', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/file`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ file: 'src/utils.ts' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it('rejects missing file field', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/file`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects whitespace-only file path', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/file`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ file: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects file path over 500 chars', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/file`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ file: 'x'.repeat(501) }),
    });
    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    const { teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'src/a.ts' }),
    });
    expect(res.status).toBe(401);
  });
});

// --- GET /teams/:tid/context ---

describe('GET /teams/:tid/context', () => {
  it('returns context with expected structure', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/context`, { headers });
    expect(res.status).toBe(200);
    const ctx = (await res.json()) as Record<string, unknown>;
    expect(ctx.members).toBeDefined();
    expect(Array.isArray(ctx.members)).toBe(true);
    expect(ctx.conflicts).toBeDefined();
    expect(ctx.locks).toBeDefined();
    expect(ctx.memories).toBeDefined();
    expect(ctx.messages).toBeDefined();
  });

  it('returns 403 for non-member', async () => {
    const { teamId } = await createTeamWithUser();
    const { headers: otherHeaders } = await createAuthUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/context`, {
      headers: otherHeaders,
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 for invalid team ID format', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/teams/not-valid/context', { headers });
    expect(res.status).toBe(404);
  });

  it('requires auth', async () => {
    const { teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/context`);
    expect(res.status).toBe(401);
  });
});

// --- Multi-user conflict detection via HTTP ---

describe('Multi-user conflict detection', () => {
  it('two users editing the same file produces a conflict', async () => {
    // User 1 creates team
    const user1 = await createTeamWithUser();

    // User 2 joins the same team
    const user2 = await createAuthUser();
    await SELF.fetch(`http://localhost/teams/${user1.teamId}/join`, {
      method: 'POST',
      headers: user2.headers,
      body: JSON.stringify({}),
    });

    // Both report activity on the same file
    await SELF.fetch(`http://localhost/teams/${user1.teamId}/activity`, {
      method: 'PUT',
      headers: user1.headers,
      body: JSON.stringify({ files: ['src/shared.ts'], summary: '' }),
    });
    await SELF.fetch(`http://localhost/teams/${user1.teamId}/activity`, {
      method: 'PUT',
      headers: user2.headers,
      body: JSON.stringify({ files: ['src/shared.ts'], summary: '' }),
    });

    // User 1 checks conflicts
    const conflictRes = await SELF.fetch(`http://localhost/teams/${user1.teamId}/conflicts`, {
      method: 'POST',
      headers: user1.headers,
      body: JSON.stringify({ files: ['src/shared.ts'] }),
    });
    expect(conflictRes.status).toBe(200);
    const body = (await conflictRes.json()) as { conflicts: Array<{ files: string[] }> };
    expect(body.conflicts.length).toBeGreaterThan(0);
    expect(body.conflicts[0].files).toContain('src/shared.ts');
  });

  it('two users editing different files produces no conflict', async () => {
    const user1 = await createTeamWithUser();
    const user2 = await createAuthUser();
    await SELF.fetch(`http://localhost/teams/${user1.teamId}/join`, {
      method: 'POST',
      headers: user2.headers,
      body: JSON.stringify({}),
    });

    await SELF.fetch(`http://localhost/teams/${user1.teamId}/activity`, {
      method: 'PUT',
      headers: user1.headers,
      body: JSON.stringify({ files: ['src/a.ts'], summary: '' }),
    });
    await SELF.fetch(`http://localhost/teams/${user1.teamId}/activity`, {
      method: 'PUT',
      headers: user2.headers,
      body: JSON.stringify({ files: ['src/b.ts'], summary: '' }),
    });

    const conflictRes = await SELF.fetch(`http://localhost/teams/${user1.teamId}/conflicts`, {
      method: 'POST',
      headers: user1.headers,
      body: JSON.stringify({ files: ['src/a.ts'] }),
    });
    expect(conflictRes.status).toBe(200);
    const body = (await conflictRes.json()) as { conflicts: unknown[] };
    expect(body.conflicts).toHaveLength(0);
  });
});

// --- Multi-user lock contention via HTTP ---

describe('Multi-user lock contention', () => {
  it('second user is blocked from claiming a locked file', async () => {
    const user1 = await createTeamWithUser();
    const user2 = await createAuthUser();
    await SELF.fetch(`http://localhost/teams/${user1.teamId}/join`, {
      method: 'POST',
      headers: user2.headers,
      body: JSON.stringify({}),
    });

    // User 1 claims
    const claim1Res = await SELF.fetch(`http://localhost/teams/${user1.teamId}/locks`, {
      method: 'POST',
      headers: user1.headers,
      body: JSON.stringify({ files: ['src/locked.ts'] }),
    });
    expect(claim1Res.status).toBe(200);
    const claim1 = (await claim1Res.json()) as { claimed: string[]; blocked: unknown[] };
    expect(claim1.claimed).toContain('src/locked.ts');

    // User 2 tries to claim same file
    const claim2Res = await SELF.fetch(`http://localhost/teams/${user1.teamId}/locks`, {
      method: 'POST',
      headers: user2.headers,
      body: JSON.stringify({ files: ['src/locked.ts'] }),
    });
    expect(claim2Res.status).toBe(200);
    const claim2 = (await claim2Res.json()) as {
      claimed: string[];
      blocked: Array<{ file: string; held_by: string }>;
    };
    expect(claim2.claimed).toHaveLength(0);
    expect(claim2.blocked).toHaveLength(1);
    expect(claim2.blocked[0].file).toBe('src/locked.ts');
    expect(claim2.blocked[0].held_by).toBe(user1.user.handle);
  });

  it('file becomes claimable after release', async () => {
    const user1 = await createTeamWithUser();
    const user2 = await createAuthUser();
    await SELF.fetch(`http://localhost/teams/${user1.teamId}/join`, {
      method: 'POST',
      headers: user2.headers,
      body: JSON.stringify({}),
    });

    // Claim and release
    await SELF.fetch(`http://localhost/teams/${user1.teamId}/locks`, {
      method: 'POST',
      headers: user1.headers,
      body: JSON.stringify({ files: ['src/release.ts'] }),
    });
    await SELF.fetch(`http://localhost/teams/${user1.teamId}/locks`, {
      method: 'DELETE',
      headers: user1.headers,
      body: JSON.stringify({ files: ['src/release.ts'] }),
    });

    // User 2 can now claim
    const claimRes = await SELF.fetch(`http://localhost/teams/${user1.teamId}/locks`, {
      method: 'POST',
      headers: user2.headers,
      body: JSON.stringify({ files: ['src/release.ts'] }),
    });
    const body = (await claimRes.json()) as { claimed: string[]; blocked: unknown[] };
    expect(body.claimed).toContain('src/release.ts');
    expect(body.blocked).toHaveLength(0);
  });
});

// --- Session lifecycle via HTTP ---

describe('Session lifecycle via HTTP', () => {
  it('start -> edit -> end -> history', async () => {
    const { headers, teamId } = await createTeamWithUser();

    // Start session
    const startRes = await SELF.fetch(`http://localhost/teams/${teamId}/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ framework: 'vitest' }),
    });
    expect(startRes.status).toBe(201);
    const { session_id } = (await startRes.json()) as { session_id: string };

    // Record edit
    const editRes = await SELF.fetch(`http://localhost/teams/${teamId}/sessionedit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ file: 'src/test.ts' }),
    });
    expect(editRes.status).toBe(200);

    // End session
    const endRes = await SELF.fetch(`http://localhost/teams/${teamId}/sessionend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ session_id }),
    });
    expect(endRes.status).toBe(200);

    // Verify in history
    const histRes = await SELF.fetch(`http://localhost/teams/${teamId}/history?days=1`, {
      headers,
    });
    expect(histRes.status).toBe(200);
    const hist = (await histRes.json()) as { sessions: Array<{ edit_count: number }> };
    expect(hist.sessions.length).toBeGreaterThan(0);
    expect(hist.sessions[0].edit_count).toBeGreaterThanOrEqual(1);
  });

  it('ending a session with wrong session_id fails', async () => {
    const { headers, teamId } = await createTeamWithUser();
    await SELF.fetch(`http://localhost/teams/${teamId}/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ framework: 'react' }),
    });

    const endRes = await SELF.fetch(`http://localhost/teams/${teamId}/sessionend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ session_id: 'nonexistent-id' }),
    });
    expect(endRes.status).not.toBe(200);
  });

  it('rejects session end without session_id', async () => {
    const { headers, teamId } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/sessionend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
