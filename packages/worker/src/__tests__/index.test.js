import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// Helper to create an authenticated user and return { user, token, headers }
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

// Helper for team creation
function makeTeamId() {
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `t_${hex}`;
}

// --- CORS ---

describe('CORS', () => {
  it('OPTIONS returns CORS headers', async () => {
    const res = await SELF.fetch('http://localhost/me', {
      method: 'OPTIONS',
      headers: { Origin: 'https://chinwag.dev' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://chinwag.dev');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('reflects allowed origin for chinwag.dev', async () => {
    const res = await SELF.fetch('http://localhost/stats', {
      headers: { Origin: 'https://chinwag.dev' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://chinwag.dev');
  });

  it('reflects allowed origin for local web dev server (dashboard static)', async () => {
    const res = await SELF.fetch('http://localhost/stats', {
      headers: { Origin: 'http://localhost:56790' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:56790');
  });

  it('defaults to chinwag.dev for unknown origin', async () => {
    const res = await SELF.fetch('http://localhost/stats', {
      headers: { Origin: 'https://evil.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://chinwag.dev');
  });
});

// --- Authentication ---

describe('Authentication', () => {
  it('returns 401 for missing Authorization header', async () => {
    const res = await SELF.fetch('http://localhost/me');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 for invalid token', async () => {
    const res = await SELF.fetch('http://localhost/me', {
      headers: { Authorization: 'Bearer invalid-token-value' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for malformed Authorization header', async () => {
    const res = await SELF.fetch('http://localhost/me', {
      headers: { Authorization: 'Token abc123' },
    });
    expect(res.status).toBe(401);
  });

  it('authenticates with valid token', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me', { headers });
    expect(res.status).toBe(200);
  });
});

// --- /me ---

describe('GET /me', () => {
  it('returns profile without internal id', async () => {
    const { headers, user } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me', { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.handle).toBe(user.handle);
    expect(body.color).toBe(user.color);
    expect(body.id).toBeUndefined();
  });

  it('includes created_at field', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me', { headers });
    const body = await res.json();
    expect(body.created_at).toBeDefined();
  });
});

// --- /auth/init ---

describe('POST /auth/init', () => {
  it('creates a new account', async () => {
    const res = await SELF.fetch('http://localhost/auth/init', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': `test-init-${Date.now()}` },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.handle).toBeDefined();
    expect(body.color).toBeDefined();
    expect(body.token).toBeDefined();
  });

  it('rate limits account creation by IP', async () => {
    const ip = `rate-limit-test-${Date.now()}-${Math.random()}`;
    // Create 3 accounts (the limit)
    for (let i = 0; i < 3; i++) {
      const res = await SELF.fetch('http://localhost/auth/init', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip },
      });
      expect(res.status).toBe(201);
    }

    // 4th should be rate limited
    const res = await SELF.fetch('http://localhost/auth/init', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': ip },
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain('Too many accounts');
  });
});

// --- /stats ---

describe('GET /stats', () => {
  it('returns stats without auth', async () => {
    const res = await SELF.fetch('http://localhost/stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.totalUsers).toBe('number');
  });
});

// --- /me/handle ---

describe('PUT /me/handle', () => {
  it('updates handle', async () => {
    const { headers } = await createAuthUser();
    const newHandle = `test_h_${Date.now().toString(36)}`.slice(0, 20);
    const res = await SELF.fetch('http://localhost/me/handle', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ handle: newHandle }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.handle).toBe(newHandle);
  });

  it('rejects missing handle', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/handle', {
      method: 'PUT',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Handle is required');
  });

  it('rejects invalid handle format', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/handle', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ handle: 'ab' }),
    });
    expect(res.status).toBe(400);
  });
});

// --- /me/color ---

describe('PUT /me/color', () => {
  it('updates color', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/color', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ color: 'cyan' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.color).toBe('cyan');
  });

  it('rejects invalid color', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/color', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ color: 'neon' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing color', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/color', {
      method: 'PUT',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Color is required');
  });
});

// --- /status ---

describe('PUT /status', () => {
  it('sets status', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/status', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'Working on tests' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('rejects status over 280 characters', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/status', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'x'.repeat(281) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('280');
  });

  it('rejects missing status', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/status', {
      method: 'PUT',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /status', () => {
  it('clears status', async () => {
    const { headers } = await createAuthUser();
    await SELF.fetch('http://localhost/status', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'Something' }),
    });
    const res = await SELF.fetch('http://localhost/status', {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// --- parseBody (tested via endpoints that use it) ---

describe('parseBody via endpoints', () => {
  it('rejects non-JSON content type', async () => {
    const { token } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/handle', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body: '{"handle": "test"}',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content-Type must be application/json');
  });

  it('rejects invalid JSON', async () => {
    const { token } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/handle', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: 'not valid json{{{',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });

  it('rejects oversized body', async () => {
    const { token } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/handle', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ handle: 'x'.repeat(60000) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Request body too large');
  });
});

// --- Team routes ---

describe('POST /teams (create team)', () => {
  it('creates a team', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Test Project' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.team_id).toBeDefined();
    expect(body.team_id).toMatch(/^t_[a-f0-9]{16}$/);
  });

  it('rate limits team creation', async () => {
    const { headers } = await createAuthUser();
    // Create 5 teams (the limit)
    for (let i = 0; i < 5; i++) {
      const res = await SELF.fetch('http://localhost/teams', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: `Project ${i}` }),
      });
      expect(res.status).toBe(201);
    }

    // 6th should fail
    const res = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'One too many' }),
    });
    expect(res.status).toBe(429);
  });
});

describe('Team join/leave/context', () => {
  it('join and context workflow', async () => {
    const { headers, user } = await createAuthUser();

    // Create team
    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Join Test' }),
    });
    const { team_id } = await createRes.json();

    // Get context
    const ctxRes = await SELF.fetch(`http://localhost/teams/${team_id}/context`, {
      headers,
    });
    expect(ctxRes.status).toBe(200);
    const ctx = await ctxRes.json();
    expect(ctx.members).toBeDefined();
    expect(ctx.members.length).toBeGreaterThan(0);
  });

  it('leave removes membership', async () => {
    const { headers } = await createAuthUser();

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const { team_id } = await createRes.json();

    const leaveRes = await SELF.fetch(`http://localhost/teams/${team_id}/leave`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(leaveRes.status).toBe(200);

    // Context should now fail (not a member)
    const ctxRes = await SELF.fetch(`http://localhost/teams/${team_id}/context`, {
      headers,
    });
    expect(ctxRes.status).toBe(403);
  });
});

// --- Team activity with content moderation ---

describe('Team activity content moderation', () => {
  it('rejects blocked summary text', async () => {
    const { headers } = await createAuthUser();

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const { team_id } = await createRes.json();

    const actRes = await SELF.fetch(`http://localhost/teams/${team_id}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        files: ['src/app.js'],
        summary: 'kill yourself',
      }),
    });
    expect(actRes.status).toBe(400);
    const body = await actRes.json();
    expect(body.error).toBe('Content blocked');
  });

  it('accepts clean summary text', async () => {
    const { headers } = await createAuthUser();

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const { team_id } = await createRes.json();

    const actRes = await SELF.fetch(`http://localhost/teams/${team_id}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        files: ['src/app.js'],
        summary: 'Working on the main module',
      }),
    });
    expect(actRes.status).toBe(200);
  });
});

// --- Team activity input validation ---

describe('Team activity input validation', () => {
  let headers;
  let teamId;

  it('setup: create user and team', async () => {
    const auth = await createAuthUser();
    headers = auth.headers;

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const body = await createRes.json();
    teamId = body.team_id;
  });

  it('rejects missing files', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ summary: 'Working' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects empty files array', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ files: [], summary: 'Working' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects too many files', async () => {
    const files = Array.from({ length: 51 }, (_, i) => `file${i}.js`);
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ files, summary: 'Working' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('too many files');
  });

  it('rejects non-string file paths', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ files: [123], summary: 'Working' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-string summary', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ files: ['src/a.js'], summary: 123 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects summary over 280 characters', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ files: ['src/a.js'], summary: 'x'.repeat(281) }),
    });
    expect(res.status).toBe(400);
  });
});

// --- Team memory endpoints ---

describe('Team memory endpoints', () => {
  let headers;
  let teamId;

  it('setup: create user and team', async () => {
    const auth = await createAuthUser();
    headers = auth.headers;

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    teamId = (await createRes.json()).team_id;
  });

  it('saves memory', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'Always run tests before deploying',
        category: 'pattern',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBeDefined();
  });

  it('searches memory', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory?q=tests`, {
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories).toBeDefined();
    expect(body.memories.length).toBeGreaterThan(0);
  });

  it('rejects memory with blocked text', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'kill yourself note',
        category: 'pattern',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content blocked');
  });

  it('rejects memory with invalid category', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'Some valid text',
        category: 'invalid',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects memory text over 2000 characters', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'x'.repeat(2001),
        category: 'config',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('2000');
  });

  it('rejects empty text', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: '   ',
        category: 'config',
      }),
    });
    expect(res.status).toBe(400);
  });
});

// --- Team messages ---

describe('Team message endpoints', () => {
  let headers;
  let teamId;

  it('setup: create user and team', async () => {
    const auth = await createAuthUser();
    headers = auth.headers;

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    teamId = (await createRes.json()).team_id;
  });

  it('sends a message', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Hello from test' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBeDefined();
  });

  it('gets messages', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/messages`, {
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toBeDefined();
    expect(body.messages.length).toBeGreaterThan(0);
  });

  it('rejects blocked message text', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'kill yourself' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects message over 500 characters', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'x'.repeat(501) }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects empty message', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});

// --- Team sessions ---

describe('Team session endpoints', () => {
  let headers;
  let teamId;

  it('setup: create user and team', async () => {
    const auth = await createAuthUser();
    headers = auth.headers;

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    teamId = (await createRes.json()).team_id;
  });

  it('starts a session', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ framework: 'react' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.session_id).toBeDefined();
  });

  it('records an edit', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/sessionedit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ file: 'src/app.js' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('gets history', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/history?days=7`, {
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toBeDefined();
    expect(body.sessions.length).toBeGreaterThan(0);
  });

  it('rejects missing file on sessionedit', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/sessionedit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

// --- Team locks ---

describe('Team lock endpoints', () => {
  let headers;
  let teamId;

  it('setup: create user and team', async () => {
    const auth = await createAuthUser();
    headers = auth.headers;

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    teamId = (await createRes.json()).team_id;
  });

  it('claims files', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/locks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ files: ['src/main.js'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claimed).toContain('src/main.js');
    expect(body.blocked).toHaveLength(0);
  });

  it('gets locked files', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/locks`, {
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locks).toBeDefined();
  });

  it('releases files', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/locks`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ files: ['src/main.js'] }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects too many files (max 20)', async () => {
    const files = Array.from({ length: 21 }, (_, i) => `file${i}.js`);
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/locks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ files }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('too many files');
  });
});

// --- /tools/catalog ---

describe('GET /tools/catalog', () => {
  it('returns tool catalog without auth', async () => {
    const res = await SELF.fetch('http://localhost/tools/catalog');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools).toBeDefined();
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.categories).toBeDefined();
  });

  it('returns cache control header', async () => {
    const res = await SELF.fetch('http://localhost/tools/catalog');
    const cc = res.headers.get('Cache-Control');
    expect(cc).toContain('max-age=3600');
  });
});

// --- 404 routes ---

describe('404 handling', () => {
  it('returns 404 for unknown authenticated route', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/nonexistent', { headers });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });

  it('returns 404 for invalid team path', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/teams/invalid/context', { headers });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown team action', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/teams/t_0000000000000000/unknown', { headers });
    expect(res.status).toBe(404);
  });
});

// --- /me/teams ---

describe('GET /me/teams', () => {
  it('returns empty teams for new user', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/teams', { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams).toEqual([]);
  });

  it('returns teams after creating one', async () => {
    const { headers } = await createAuthUser();
    await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'My Project' }),
    });

    const res = await SELF.fetch('http://localhost/me/teams', { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams.length).toBeGreaterThanOrEqual(1);
  });
});

// --- /me/dashboard ---

describe('GET /me/dashboard', () => {
  it('returns empty dashboard for user with no teams', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/dashboard', { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams).toEqual([]);
  });
});

// --- /presence/heartbeat ---

describe('POST /presence/heartbeat', () => {
  it('records presence heartbeat', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/presence/heartbeat', {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// --- Team file reporting endpoint ---

describe('Team file reporting', () => {
  let headers;
  let teamId;

  it('setup: create user and team', async () => {
    const auth = await createAuthUser();
    headers = auth.headers;

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    teamId = (await createRes.json()).team_id;
  });

  it('reports a file', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/file`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ file: 'src/index.js' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('rejects empty file', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/file`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ file: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects file path too long', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/file`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ file: 'x'.repeat(501) }),
    });
    expect(res.status).toBe(400);
  });
});

// --- Agent profile ---

describe('PUT /agent/profile', () => {
  it('updates agent profile', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/agent/profile', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        framework: 'cursor',
        languages: ['javascript', 'python'],
        frameworks: ['react'],
        tools: ['eslint'],
        platforms: ['mac'],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// --- Team conflicts endpoint ---

describe('Team conflicts endpoint', () => {
  let headers;
  let teamId;

  it('setup: create user and team', async () => {
    const auth = await createAuthUser();
    headers = auth.headers;

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    teamId = (await createRes.json()).team_id;
  });

  it('checks for conflicts', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/conflicts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ files: ['src/app.js'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conflicts).toBeDefined();
    expect(body.locked).toBeDefined();
  });

  it('rejects invalid files input', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/conflicts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ files: 'not-an-array' }),
    });
    expect(res.status).toBe(400);
  });
});

// --- Team heartbeat endpoint ---

describe('Team heartbeat endpoint', () => {
  it('heartbeat for joined team', async () => {
    const { headers } = await createAuthUser();

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const { team_id } = await createRes.json();

    const res = await SELF.fetch(`http://localhost/teams/${team_id}/heartbeat`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
