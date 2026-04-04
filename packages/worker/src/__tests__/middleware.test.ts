import { describe, it, expect, vi } from 'vitest';

// Mock cloudflare:workers so DO class imports resolve outside the Workers runtime
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

import {
  publicRoute,
  authedRoute,
  authedJsonRoute,
  teamRoute,
  teamJsonRoute,
  doResult,
} from '../lib/middleware.js';
import { json } from '../lib/http.js';
import type { User, Env } from '../types.js';

// --- Test helpers ---

function makeRequest(
  opts: {
    method?: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {},
): Request {
  const init: RequestInit = { method: opts.method || 'GET' };
  const hdrs: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.body) {
    init.body = JSON.stringify(opts.body);
    hdrs['Content-Type'] = 'application/json';
  }
  init.headers = hdrs;
  return new Request('http://example.com/test', init);
}

const mockUser: User = {
  id: 'user-123',
  handle: 'alice',
  color: 'cyan',
  status: null,
  created_at: '2025-01-01T00:00:00Z',
  last_active: '2025-06-01T00:00:00Z',
};

function mockEnv(): Env {
  const stubFn = () => ({
    get: () => ({}),
    idFromName: () => ({}),
  });
  return {
    DATABASE: { get: () => ({}), idFromName: () => ({}) },
    LOBBY: { get: () => ({}), idFromName: () => ({}) },
    ROOM: { get: () => ({}), idFromName: () => ({}) },
    TEAM: { get: () => ({}), idFromName: () => ({}) },
    AUTH_KV: {} as KVNamespace,
    AI: {},
    ENVIRONMENT: 'test',
    DASHBOARD_URL: 'http://localhost',
  } as unknown as Env;
}

// --- publicRoute ---

describe('publicRoute', () => {
  it('passes request, env, and params to handler', async () => {
    let captured: { request: Request; env: Env; params: string[] } | null = null;
    const handler = publicRoute((ctx) => {
      captured = ctx;
      return json({ ok: true });
    });

    const req = makeRequest();
    const env = mockEnv();
    await handler(req, env, null, 'p1', 'p2');

    expect(captured).not.toBeNull();
    expect(captured!.request).toBe(req);
    expect(captured!.env).toBe(env);
    expect(captured!.params).toEqual(['p1', 'p2']);
  });

  it('returns the handler response directly', async () => {
    const handler = publicRoute(() => json({ data: 'test' }, 201));
    const response = await handler(makeRequest(), mockEnv(), null);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ data: 'test' });
  });

  it('works with no params', async () => {
    let captured: { params: string[] } | null = null;
    const handler = publicRoute((ctx) => {
      captured = ctx;
      return json({ ok: true });
    });

    await handler(makeRequest(), mockEnv(), null);
    expect(captured!.params).toEqual([]);
  });
});

// --- authedRoute ---

describe('authedRoute', () => {
  it('passes user as non-null in context', async () => {
    let captured: { user: User } | null = null;
    const handler = authedRoute((ctx) => {
      captured = ctx;
      return json({ ok: true });
    });

    await handler(makeRequest(), mockEnv(), mockUser);
    expect(captured!.user).toBe(mockUser);
    expect(captured!.user.handle).toBe('alice');
  });

  it('passes request, env, and params alongside user', async () => {
    let captured: { request: Request; env: Env; user: User; params: string[] } | null = null;
    const handler = authedRoute((ctx) => {
      captured = ctx;
      return json({ ok: true });
    });

    const req = makeRequest();
    const env = mockEnv();
    await handler(req, env, mockUser, 'tid_abc');

    expect(captured!.request).toBe(req);
    expect(captured!.env).toBe(env);
    expect(captured!.params).toEqual(['tid_abc']);
  });
});

// --- authedJsonRoute ---

describe('authedJsonRoute', () => {
  it('parses valid JSON body and passes it to handler', async () => {
    let captured: { body: Record<string, unknown>; user: User } | null = null;
    const handler = authedJsonRoute((ctx) => {
      captured = ctx;
      return json({ ok: true });
    });

    const req = makeRequest({ method: 'POST', body: { text: 'hello', count: 5 } });
    const response = await handler(req, mockEnv(), mockUser);
    expect(response.status).toBe(200);
    expect(captured!.body).toEqual({ text: 'hello', count: 5 });
    expect(captured!.user).toBe(mockUser);
  });

  it('returns 400 for missing Content-Type header', async () => {
    const handler = authedJsonRoute(() => json({ ok: true }));

    // No Content-Type, no body
    const req = new Request('http://example.com/test', {
      method: 'POST',
      body: '{"key":"val"}',
    });
    const response = await handler(req, mockEnv(), mockUser);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Content-Type');
  });

  it('returns 400 for invalid JSON body', async () => {
    const handler = authedJsonRoute(() => json({ ok: true }));

    const req = new Request('http://example.com/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json{',
    });
    const response = await handler(req, mockEnv(), mockUser);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Invalid JSON');
  });

  it('does not call inner handler when body parsing fails', async () => {
    const innerFn = vi.fn(() => json({ ok: true }));
    const handler = authedJsonRoute(innerFn);

    const req = new Request('http://example.com/test', {
      method: 'POST',
      body: 'bad json',
    });
    await handler(req, mockEnv(), mockUser);
    expect(innerFn).not.toHaveBeenCalled();
  });
});

// --- teamRoute ---

describe('teamRoute', () => {
  it('extracts teamId from first param and builds team context', async () => {
    let captured: {
      teamId: string;
      agentId: string;
      user: User;
      params: string[];
    } | null = null;

    const handler = teamRoute((ctx) => {
      captured = ctx;
      return json({ ok: true });
    });

    const req = makeRequest({
      headers: { 'X-Agent-Id': 'cursor:session-abc' },
    });
    await handler(req, mockEnv(), mockUser, 't_abcdef1234567890');

    expect(captured!.teamId).toBe('t_abcdef1234567890');
    expect(captured!.agentId).toBe('cursor:session-abc');
    expect(captured!.user).toBe(mockUser);
    expect(captured!.params).toEqual(['t_abcdef1234567890']);
  });

  it('falls back to user.id for agentId when no header', async () => {
    let captured: { agentId: string; runtime: { hostTool: string } } | null = null;

    const handler = teamRoute((ctx) => {
      captured = ctx;
      return json({ ok: true });
    });

    await handler(makeRequest(), mockEnv(), mockUser, 't_0000000000000000');
    expect(captured!.agentId).toBe('user-123');
    expect(captured!.runtime.hostTool).toBe('unknown');
  });

  it('provides runtime metadata in context', async () => {
    let captured: { runtime: { hostTool: string; agentSurface: string | null } } | null = null;

    const handler = teamRoute((ctx) => {
      captured = ctx;
      return json({ ok: true });
    });

    const req = makeRequest({
      headers: {
        'X-Agent-Id': 'windsurf:xyz',
        'X-Agent-Host-Tool': 'vscode',
        'X-Agent-Surface': 'cline',
      },
    });
    await handler(req, mockEnv(), mockUser, 't_abcdef1234567890');

    expect(captured!.runtime.hostTool).toBe('vscode');
    expect(captured!.runtime.agentSurface).toBe('cline');
  });
});

// --- teamJsonRoute ---

describe('teamJsonRoute', () => {
  it('combines team context with parsed JSON body', async () => {
    let captured: {
      teamId: string;
      agentId: string;
      body: Record<string, unknown>;
    } | null = null;

    const handler = teamJsonRoute((ctx) => {
      captured = ctx;
      return json({ ok: true });
    });

    const req = makeRequest({
      method: 'POST',
      body: { files: ['a.js'] },
      headers: { 'X-Agent-Id': 'cursor:abc' },
    });
    await handler(req, mockEnv(), mockUser, 't_abcdef1234567890');

    expect(captured!.teamId).toBe('t_abcdef1234567890');
    expect(captured!.agentId).toBe('cursor:abc');
    expect(captured!.body).toEqual({ files: ['a.js'] });
  });

  it('returns 400 for invalid body without calling handler', async () => {
    const innerFn = vi.fn(() => json({ ok: true }));
    const handler = teamJsonRoute(innerFn);

    const req = new Request('http://example.com/test', {
      method: 'POST',
      body: 'not json',
    });
    const response = await handler(req, mockEnv(), mockUser, 't_abcdef1234567890');
    expect(response.status).toBe(400);
    expect(innerFn).not.toHaveBeenCalled();
  });
});

// --- doResult ---

describe('doResult', () => {
  it('returns success JSON for non-error result', async () => {
    const response = await doResult(Promise.resolve({ ok: true, data: 'hello' }), 'test');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, data: 'hello' });
  });

  it('uses custom success status', async () => {
    const response = await doResult(Promise.resolve({ ok: true, id: 'new-123' }), 'create', 201);
    expect(response.status).toBe(201);
  });

  it('maps error result to appropriate HTTP status', async () => {
    const response = await doResult(
      Promise.resolve({ error: 'Not a member', code: 'NOT_MEMBER' }),
      'getContext',
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Not a member');
  });

  it('maps NOT_FOUND error to 404', async () => {
    const response = await doResult(
      Promise.resolve({ error: 'Memory not found', code: 'NOT_FOUND' }),
      'getMemory',
    );
    expect(response.status).toBe(404);
  });

  it('maps CONFLICT error to 409', async () => {
    const response = await doResult(
      Promise.resolve({ error: 'Already claimed', code: 'CONFLICT' }),
      'claimFiles',
    );
    expect(response.status).toBe(409);
  });

  it('maps unknown error codes to 400', async () => {
    const response = await doResult(Promise.resolve({ error: 'Bad input' }), 'badInput');
    expect(response.status).toBe(400);
  });

  it('maps INTERNAL error to 500', async () => {
    const response = await doResult(
      Promise.resolve({ error: 'Internal failure', code: 'INTERNAL' }),
      'internal',
    );
    expect(response.status).toBe(500);
  });

  it('defaults to 200 when no successStatus provided', async () => {
    const response = await doResult(Promise.resolve({ ok: true }), 'default');
    expect(response.status).toBe(200);
  });
});
