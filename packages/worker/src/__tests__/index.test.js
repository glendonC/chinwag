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

  it('reflects allowed origin for auto-incremented localhost dev ports', async () => {
    const res = await SELF.fetch('http://localhost/stats', {
      headers: { Origin: 'http://localhost:56791' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:56791');
  });

  it('does not reflect unknown origins', async () => {
    const res = await SELF.fetch('http://localhost/stats', {
      headers: { Origin: 'https://evil.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
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
    const res = await SELF.fetch('http://localhost/stats', {
      headers: { 'CF-Connecting-IP': `stats-ok-${Date.now()}-${Math.random()}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.totalUsers).toBe('number');
  });

  it('rate limits by IP', async () => {
    const ip = `stats-rl-${Date.now()}-${Math.random()}`;
    // Exhaust the 200/day limit by sending real requests through the handler
    // (which hashes the IP internally). Use checkAndConsume to pre-fill.
    const db = env.DATABASE.get(env.DATABASE.idFromName('main'));
    const data = new TextEncoder().encode(ip);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const hashedIp = hex.slice(0, 16);
    for (let i = 0; i < 200; i++) {
      await db.consumeRateLimit(`pub:stats:${hashedIp}`);
    }

    const res = await SELF.fetch('http://localhost/stats', {
      headers: { 'CF-Connecting-IP': ip },
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain('Rate limit exceeded');
  });
});

// --- /tools/catalog ---

describe('GET /tools/catalog', () => {
  it('returns catalog without auth', async () => {
    const res = await SELF.fetch('http://localhost/tools/catalog', {
      headers: { 'CF-Connecting-IP': `catalog-ok-${Date.now()}-${Math.random()}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools).toBeDefined();
    expect(body.categories).toBeDefined();
  });

  it('rate limits by IP', async () => {
    const ip = `catalog-rl-${Date.now()}-${Math.random()}`;
    const db = env.DATABASE.get(env.DATABASE.idFromName('main'));
    const data = new TextEncoder().encode(ip);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const hashedIp = hex.slice(0, 16);
    for (let i = 0; i < 200; i++) {
      await db.consumeRateLimit(`pub:catalog:${hashedIp}`);
    }

    const res = await SELF.fetch('http://localhost/tools/catalog', {
      headers: { 'CF-Connecting-IP': ip },
    });
    expect(res.status).toBe(429);
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
        tags: ['pattern'],
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
        tags: ['pattern'],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content blocked');
  });

  it('rejects memory text over 2000 characters', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'x'.repeat(2001),
        tags: ['config'],
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
        tags: ['config'],
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
    const res = await SELF.fetch('http://localhost/tools/catalog', {
      headers: { 'CF-Connecting-IP': `catalog-basic-${Date.now()}-${Math.random()}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools).toBeDefined();
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.categories).toBeDefined();
  });

  it('returns cache control header', async () => {
    const res = await SELF.fetch('http://localhost/tools/catalog', {
      headers: { 'CF-Connecting-IP': `catalog-cc-${Date.now()}-${Math.random()}` },
    });
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
    expect(body.degraded).toBe(false);
    expect(body.failed_teams).toEqual([]);
  });

  it('returns degraded dashboard data when some project summaries fail', async () => {
    const { headers, user } = await createAuthUser();
    const db = env.DATABASE.get(env.DATABASE.idFromName('main'));

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Healthy Project' }),
    });
    const { team_id } = await createRes.json();

    await db.addUserTeam(user.id, makeTeamId(), 'Broken Project');

    const res = await SELF.fetch('http://localhost/me/dashboard', { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.failed_teams).toHaveLength(1);
    expect(body.failed_teams[0].team_name).toBe('Broken Project');
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].team_id).toBe(team_id);
  });

  it('returns 503 when all project summaries fail', async () => {
    const { headers, user } = await createAuthUser();
    const db = env.DATABASE.get(env.DATABASE.idFromName('main'));
    await db.addUserTeam(user.id, makeTeamId(), 'Broken Project');

    const res = await SELF.fetch('http://localhost/me/dashboard', { headers });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('temporarily unavailable');
    expect(body.degraded).toBe(true);
    expect(body.failed_teams).toHaveLength(1);
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

// --- Token lifecycle ---

describe('Token lifecycle', () => {
  it('auth/init returns a refresh_token alongside the access token', async () => {
    const res = await SELF.fetch('http://localhost/auth/init', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': `token-lifecycle-${Date.now()}` },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(body.refresh_token).toBeDefined();
    expect(body.refresh_token).toMatch(/^rt_/);
  });

  it('refresh token issues new access token and new refresh token', async () => {
    const initRes = await SELF.fetch('http://localhost/auth/init', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': `token-refresh-${Date.now()}` },
    });
    const { token: oldToken, refresh_token: oldRefresh } = await initRes.json();

    // Use refresh token to get new tokens
    const refreshRes = await SELF.fetch('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: oldRefresh }),
    });
    expect(refreshRes.status).toBe(200);
    const refreshBody = await refreshRes.json();
    expect(refreshBody.token).toBeDefined();
    expect(refreshBody.token).not.toBe(oldToken);
    expect(refreshBody.refresh_token).toBeDefined();
    expect(refreshBody.refresh_token).not.toBe(oldRefresh);
    expect(refreshBody.refresh_token).toMatch(/^rt_/);

    // New token works for auth
    const meRes = await SELF.fetch('http://localhost/me', {
      headers: { Authorization: `Bearer ${refreshBody.token}` },
    });
    expect(meRes.status).toBe(200);
  });

  it('old refresh token is invalidated after rotation', async () => {
    const initRes = await SELF.fetch('http://localhost/auth/init', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': `token-rotation-${Date.now()}` },
    });
    const { refresh_token: oldRefresh } = await initRes.json();

    // First refresh succeeds
    const refreshRes = await SELF.fetch('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: oldRefresh }),
    });
    expect(refreshRes.status).toBe(200);

    // Reusing the old refresh token fails
    const reuseRes = await SELF.fetch('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: oldRefresh }),
    });
    expect(reuseRes.status).toBe(401);
  });

  it('rejects missing refresh_token', async () => {
    const res = await SELF.fetch('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('refresh_token is required');
  });

  it('rejects invalid refresh token format', async () => {
    const res = await SELF.fetch('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'not-a-refresh-token' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid refresh token format');
  });

  it('rejects nonexistent refresh token', async () => {
    const res = await SELF.fetch('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'rt_0000000000000000000000000000000' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid or expired refresh token');
  });

  it('chained refresh: new refresh token works for subsequent refresh', async () => {
    const initRes = await SELF.fetch('http://localhost/auth/init', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': `token-chain-${Date.now()}` },
    });
    const { refresh_token: rt1 } = await initRes.json();

    // First refresh
    const r1 = await SELF.fetch('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt1 }),
    });
    const { refresh_token: rt2, token: t2 } = await r1.json();

    // Second refresh with new token
    const r2 = await SELF.fetch('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt2 }),
    });
    expect(r2.status).toBe(200);
    const { token: t3 } = await r2.json();
    expect(t3).not.toBe(t2);

    // Latest access token works
    const meRes = await SELF.fetch('http://localhost/me', {
      headers: { Authorization: `Bearer ${t3}` },
    });
    expect(meRes.status).toBe(200);
  });
});

// --- WebSocket Origin Validation ---

describe('WebSocket origin validation', () => {
  it('rejects chat WS upgrade from unknown origin', async () => {
    const { token } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/ws/chat?ticket=fake', {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://evil.com',
        Upgrade: 'websocket',
        Connection: 'Upgrade',
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Origin not allowed');
  });

  it('rejects team WS upgrade from unknown origin', async () => {
    const { headers: authHeaders } = await createAuthUser();

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    const { team_id } = await createRes.json();

    const res = await SELF.fetch(`http://localhost/teams/${team_id}/ws`, {
      headers: {
        ...authHeaders,
        Origin: 'https://attacker.example',
        Upgrade: 'websocket',
        Connection: 'Upgrade',
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Origin not allowed');
  });
});

// --- Content moderation coverage ---
// Verifies that all user-content surfaces enforce the sync blocklist.

describe('Content moderation: handle updates', () => {
  it('rejects handle containing blocked term', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/me/handle', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ handle: 'retard' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content blocked');
  });

  it('accepts clean handle', async () => {
    const { headers } = await createAuthUser();
    const newHandle = `clean_${Date.now().toString(36)}`.slice(0, 20);
    const res = await SELF.fetch('http://localhost/me/handle', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ handle: newHandle }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('Content moderation: team name on create', () => {
  it('rejects team name with blocked content', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'kill yourself project' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content blocked');
  });

  it('accepts team with clean name', async () => {
    const { headers } = await createAuthUser();
    const res = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'My Clean Project' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.team_id).toBeDefined();
  });
});

describe('Content moderation: team name on join', () => {
  it('rejects team join with blocked name', async () => {
    const { headers } = await createAuthUser();
    // Create a clean team first
    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Good Project' }),
    });
    const { team_id } = await createRes.json();

    // Try to join with a blocked name
    const res = await SELF.fetch(`http://localhost/teams/${team_id}/join`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'kill yourself team' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content blocked');
  });
});

describe('Content moderation: memory update', () => {
  let headers;
  let teamId;
  let memoryId;

  it('setup: create user, team, and memory', async () => {
    const auth = await createAuthUser();
    headers = auth.headers;

    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    teamId = (await createRes.json()).team_id;

    const memRes = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Original clean text', tags: ['setup'] }),
    });
    memoryId = (await memRes.json()).id;
  });

  it('rejects memory update with blocked text', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ id: memoryId, text: 'kill yourself' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content blocked');
  });

  it('accepts memory update with clean text', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ id: memoryId, text: 'Updated clean text' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('Content moderation: memory tags', () => {
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

  it('rejects memory save with blocked tag', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'Clean memory text',
        tags: ['retard'],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content blocked');
  });

  it('accepts memory save with clean tags', async () => {
    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'Clean memory text',
        tags: ['architecture', 'decision'],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('rejects memory update with blocked tag', async () => {
    // First create a clean memory
    const saveRes = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: 'Clean text for tag update test',
        tags: ['safe'],
      }),
    });
    const memoryId = (await saveRes.json()).id;

    const res = await SELF.fetch(`http://localhost/teams/${teamId}/memory`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ id: memoryId, tags: ['retard'] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content blocked');
  });
});

describe('Content moderation: activity summary edge cases', () => {
  it('accepts empty summary (no false positive)', async () => {
    const { headers } = await createAuthUser();
    const createRes = await SELF.fetch('http://localhost/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const { team_id } = await createRes.json();

    const res = await SELF.fetch(`http://localhost/teams/${team_id}/activity`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        files: ['src/app.js'],
        summary: '',
      }),
    });
    // Empty summary should pass moderation (isBlocked('') returns false)
    expect(res.status).toBe(200);
  });
});
