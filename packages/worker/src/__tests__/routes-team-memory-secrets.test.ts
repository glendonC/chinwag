// End-to-end coverage for the secret-detection write boundary on memory
// routes. Memory is durable + team-shared; a single leaked credential reaches
// every member until explicit deletion. The route blocks recognised secret
// formats unless the caller passes `force: true`.

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
  await SELF.fetch(`http://localhost/teams/${team_id}/join`, {
    method: 'POST',
    headers: auth.headers,
    body: JSON.stringify({}),
  });
  return { ...auth, teamId: team_id };
}

describe('memory save - secret detection', () => {
  it('rejects a save containing an AWS access key with code SECRET_DETECTED', async () => {
    const { teamId, headers } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'remember to rotate AKIAIOSFODNN7EXAMPLE before friday',
        tags: ['ops'],
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code?: string;
      secrets?: { type: string; preview: string }[];
    };
    expect(body.code).toBe('SECRET_DETECTED');
    expect(body.secrets?.[0]?.type).toBe('aws_access_key');
    expect(body.secrets?.[0]?.preview).not.toContain('IOSFODNN7EXAMPLE');
  });

  it('rejects a save containing a GitHub PAT', async () => {
    const { teamId, headers } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'CI uses ghp_abcdefghijklmnopqrstuvwxyz0123456789 to push',
        tags: ['ci'],
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('SECRET_DETECTED');
  });

  it('does not refuse with SECRET_DETECTED when force: true is set', async () => {
    const { teamId, headers } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'docs example: AKIAIOSFODNN7EXAMPLE shows the prefix shape',
        tags: ['docs'],
        force: true,
      }),
    });
    // Downstream layers (moderation, rate limit) may still reject for their
    // own reasons; what matters here is the secret detector did not.
    expect(res.status).not.toBe(422);
    if (res.status >= 400) {
      const body = (await res.json()) as { code?: string };
      expect(body.code).not.toBe('SECRET_DETECTED');
    }
  });

  it('accepts memories with secret-shaped names (not actual values) without force', async () => {
    const { teamId, headers } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'AWS keys begin with AKIA followed by 16 alphanumerics',
        tags: ['docs'],
      }),
    });
    expect([201, 503]).toContain(res.status);
  });

  it('returns the structured hint about force: true in error body', async () => {
    const { teamId, headers } = await createTeamWithUser();
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP',
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { hint?: string };
    expect(body.hint).toContain('force: true');
  });
});

describe('memory update - secret detection', () => {
  it('rejects updating a memory with secret-bearing text', async () => {
    const { teamId, headers } = await createTeamWithUser();
    // First, save a clean memory
    const saveRes = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'clean note about deploys', tags: ['ops'] }),
    });
    if (saveRes.status === 503) return; // moderation unavailable; skip
    expect(saveRes.status).toBe(201);
    const { id } = (await saveRes.json()) as { id: string };

    // Try to update with a secret in the new text
    const updRes = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        id,
        text: 'updated to include ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      }),
    });
    expect(updRes.status).toBe(422);
    const body = (await updRes.json()) as { code?: string };
    expect(body.code).toBe('SECRET_DETECTED');
  });
});
