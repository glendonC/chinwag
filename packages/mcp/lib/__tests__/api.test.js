import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getApiUrl } from '../api.js';

function mockJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe('MCP API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('includes auth, user-agent, and agent headers', async () => {
    vi.stubEnv('CHINMEISTER_API_URL', 'http://localhost:8787');
    fetch.mockResolvedValue(mockJsonResponse({ ok: true }));

    await api(
      { token: 'mcp-token' },
      {
        agentId: 'cursor:abc123',
        runtimeIdentity: {
          hostTool: 'cursor',
          agentSurface: 'cline',
          transport: 'mcp',
          tier: 'connected',
        },
      },
    ).get('/teams/t_test/context');

    expect(getApiUrl()).toBe('http://localhost:8787');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8787/teams/t_test/context',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer mcp-token',
          'Content-Type': 'application/json',
          'User-Agent': 'chinmeister-mcp/1.0',
          'X-Agent-Id': 'cursor:abc123',
          'X-Agent-Host-Tool': 'cursor',
          'X-Agent-Surface': 'cline',
          'X-Agent-Transport': 'mcp',
          'X-Agent-Tier': 'connected',
        }),
      }),
    );
  });

  it('uses the local profile defaults without explicit URL overrides', async () => {
    vi.stubEnv('CHINMEISTER_PROFILE', 'local');
    fetch.mockResolvedValue(mockJsonResponse({ ok: true }));

    await api({ token: 'mcp-token' }, { agentId: 'cursor:abc123' }).get('/me');

    expect(getApiUrl()).toBe('http://localhost:8787');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8787/me',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('retries retryable network errors', async () => {
    vi.useFakeTimers();
    const err = new Error('connection reset');
    err.code = 'ECONNRESET';
    fetch.mockRejectedValueOnce(err).mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const request = api({ token: 'mcp-token' }, { agentId: 'cursor:abc123' }).post(
      '/teams/t_test/heartbeat',
      {},
    );
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('issues PUT and DELETE through the same refresh wrapper', async () => {
    vi.stubEnv('CHINMEISTER_API_URL', 'http://localhost:8787');
    fetch.mockResolvedValue(mockJsonResponse({ ok: true }));

    const client = api({ token: 'mcp-token' }, { agentId: 'cursor:abc' });
    await client.put('/teams/t/handle', { handle: 'newone' });
    await client.del('/teams/t/memory', { id: 'mem_1' });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8787/teams/t/handle',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8787/teams/t/memory',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('updateIdentity rebuilds the inner client so subsequent requests carry new headers', async () => {
    vi.stubEnv('CHINMEISTER_API_URL', 'http://localhost:8787');
    fetch.mockResolvedValue(mockJsonResponse({ ok: true }));

    const client = api(
      { token: 'mcp-token' },
      {
        agentId: 'cursor:old',
        runtimeIdentity: {
          hostTool: 'cursor',
          agentSurface: null,
          transport: 'mcp',
          tier: 'connected',
        },
      },
    );

    await client.get('/me');
    expect(fetch.mock.calls[0][1].headers['X-Agent-Id']).toBe('cursor:old');

    client.updateIdentity('cursor:new', {
      hostTool: 'cursor',
      agentSurface: 'inline',
      transport: 'mcp',
      tier: 'connected',
    });

    await client.get('/me');
    expect(fetch.mock.calls[1][1].headers['X-Agent-Id']).toBe('cursor:new');
    expect(fetch.mock.calls[1][1].headers['X-Agent-Surface']).toBe('inline');
  });

  it('refreshes the token on 401 and retries the original request', async () => {
    vi.stubEnv('CHINMEISTER_API_URL', 'http://localhost:8787');

    // Seed config with a refresh_token so tryRefreshToken can find one.
    const { saveConfig } = await import('@chinmeister/shared/config.js');
    saveConfig({ token: 'old-token', refresh_token: 'rt_abc' });

    let call = 0;
    fetch.mockImplementation((url) => {
      call += 1;
      // Refresh endpoint
      if (typeof url === 'string' && url.endsWith('/auth/refresh')) {
        return Promise.resolve(
          mockJsonResponse({ ok: true, token: 'new-token', refresh_token: 'rt_new' }),
        );
      }
      if (call === 1) {
        return Promise.resolve(mockJsonResponse({ error: 'expired' }, 401));
      }
      return Promise.resolve(mockJsonResponse({ ok: true, retried: true }));
    });

    const client = api(
      { token: 'old-token' },
      {
        agentId: 'cursor:abc',
        runtimeIdentity: {
          hostTool: 'cursor',
          agentSurface: null,
          transport: 'mcp',
          tier: 'connected',
        },
      },
    );

    const result = await client.get('/me');
    expect(result).toEqual({ ok: true, retried: true });

    // Three calls: original (401), refresh, retry
    expect(fetch).toHaveBeenCalledTimes(3);

    const retryCall = fetch.mock.calls[2];
    expect(retryCall[1].headers.Authorization).toBe('Bearer new-token');
  });

  it('propagates the 401 when no refresh_token is available', async () => {
    vi.stubEnv('CHINMEISTER_API_URL', 'http://localhost:8787');
    const { saveConfig } = await import('@chinmeister/shared/config.js');
    saveConfig({ token: 'old-token' }); // no refresh_token

    fetch.mockResolvedValue(mockJsonResponse({ error: 'expired' }, 401));

    const client = api({ token: 'old-token' }, { agentId: 'cursor:abc' });
    await expect(client.get('/me')).rejects.toMatchObject({ status: 401 });
  });
});
