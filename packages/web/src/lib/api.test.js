import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getApiUrl } from './api.js';

function stubHostname(hostname) {
  vi.stubGlobal('window', {
    ...window,
    location: { ...window.location, hostname },
  });
}

function mockJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe('web API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    stubHostname('localhost');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses the Vite API override and auth header', async () => {
    vi.stubEnv('VITE_CHINMEISTER_API_URL', 'http://localhost:8787');
    fetch.mockResolvedValue(mockJsonResponse({ teams: [] }));

    await api('GET', '/me/teams', null, 'web-token');

    expect(getApiUrl()).toBe('http://localhost:8787');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8787/me/teams',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer web-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('defaults to the production API when no env override is set', async () => {
    fetch.mockResolvedValue(mockJsonResponse({ teams: [] }));
    stubHostname('localhost');

    await api('GET', '/me/teams', null, 'web-token');

    expect(getApiUrl()).toBe('https://chinmeister-api.glendonchin.workers.dev');
    expect(fetch).toHaveBeenCalledWith(
      'https://chinmeister-api.glendonchin.workers.dev/me/teams',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('uses the local profile defaults without an explicit API override', () => {
    vi.stubEnv('VITE_CHINMEISTER_PROFILE', 'local');

    expect(getApiUrl()).toBe('http://localhost:8787');
  });

  it('uses DEFAULT_API_URL regardless of hostname when no local profile is set', () => {
    stubHostname('127.0.0.1');

    expect(getApiUrl()).toBe('https://chinmeister-api.glendonchin.workers.dev');
  });

  it('uses web-specific parse errors for non-JSON responses', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error('invalid json')),
    });

    await expect(api('GET', '/me')).rejects.toMatchObject({
      message: 'HTTP 500 (server error)',
      status: 500,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves parsed error payloads on HTTP failures', async () => {
    fetch.mockResolvedValue(
      mockJsonResponse(
        {
          error: 'Project summary is temporarily unavailable.',
          failed_teams: [{ team_id: 't_one', team_name: 'chinmeister' }],
        },
        503,
      ),
    );

    await expect(api('GET', '/me/dashboard')).rejects.toMatchObject({
      message: 'Project summary is temporarily unavailable.',
      status: 503,
      data: {
        failed_teams: [{ team_id: 't_one', team_name: 'chinmeister' }],
      },
    });
  });
});
