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
    vi.stubEnv('CHINWAG_API_URL', 'http://localhost:8787');
    fetch.mockResolvedValue(mockJsonResponse({ ok: true }));

    await api({ token: 'mcp-token' }, {
      agentId: 'cursor:abc123',
      runtimeIdentity: {
        hostTool: 'cursor',
        agentSurface: 'cline',
        transport: 'mcp',
        tier: 'connected',
      },
    }).get('/teams/t_test/context');

    expect(getApiUrl()).toBe('http://localhost:8787');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8787/teams/t_test/context',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer mcp-token',
          'Content-Type': 'application/json',
          'User-Agent': 'chinwag-mcp/1.0',
          'X-Agent-Id': 'cursor:abc123',
          'X-Agent-Host-Tool': 'cursor',
          'X-Agent-Surface': 'cline',
          'X-Agent-Transport': 'mcp',
          'X-Agent-Tier': 'connected',
        }),
      })
    );
  });

  it('retries retryable network errors', async () => {
    vi.useFakeTimers();
    const err = new Error('connection reset');
    err.code = 'ECONNRESET';
    fetch
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const request = api({ token: 'mcp-token' }, { agentId: 'cursor:abc123' }).post('/teams/t_test/heartbeat', {});
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
