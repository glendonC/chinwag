import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getApiUrl, initAccount } from '../api.js';

function mockJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe('CLI API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses the configured base URL and auth header', async () => {
    vi.stubEnv('CHINMEISTER_API_URL', 'http://localhost:8787');
    fetch.mockResolvedValue(mockJsonResponse({ ok: true }));

    await api({ token: 'cli-token' }).post('/teams', { name: 'chinmeister' });

    expect(getApiUrl()).toBe('http://localhost:8787');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8787/teams',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'chinmeister' }),
        headers: expect.objectContaining({
          Authorization: 'Bearer cli-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('uses the local profile defaults without explicit URL overrides', async () => {
    vi.stubEnv('CHINMEISTER_PROFILE', 'local');
    fetch.mockResolvedValue(mockJsonResponse({ ok: true }));

    await api({ token: 'cli-token' }).get('/me');

    expect(getApiUrl()).toBe('http://localhost:8787');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8787/me',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('retries server errors before succeeding', async () => {
    vi.useFakeTimers();
    fetch
      .mockResolvedValueOnce(mockJsonResponse({ error: 'temporary' }, 502))
      .mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const request = api({ token: 'cli-token' }).get('/me');
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('initAccount posts to auth init without auth', async () => {
    fetch.mockResolvedValue(mockJsonResponse({ token: 'abc' }));

    await initAccount();

    expect(fetch).toHaveBeenCalledWith(
      'https://chinmeister-api.glendonchin.workers.dev/auth/init',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });
});
