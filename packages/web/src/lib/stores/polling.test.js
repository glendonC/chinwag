import { afterEach, describe, expect, it, vi } from 'vitest';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function loadPollingModule({
  token = 'tok_123',
  activeTeamId = null,
  teamState = { activeTeamId },
  apiMock = vi.fn(),
  ensureJoinedMock = vi.fn(),
  loadTeamsMock = vi.fn(),
  logoutMock = vi.fn(),
  withDocument = false,
} = {}) {
  vi.resetModules();

  const listeners = new Map();
  if (withDocument) {
    globalThis.document = {
      hidden: false,
      addEventListener: vi.fn((event, handler) => listeners.set(event, handler)),
    };
  } else {
    delete globalThis.document;
  }

  vi.doMock('../api.js', () => ({
    api: apiMock,
  }));
  vi.doMock('./auth.js', () => ({
    authActions: {
      getState: () => ({ token }),
      logout: logoutMock,
      subscribe: vi.fn(),
    },
  }));
  vi.doMock('./teams.js', () => ({
    teamActions: {
      getState: () => teamState,
      ensureJoined: ensureJoinedMock,
      loadTeams: loadTeamsMock,
    },
  }));
  vi.doMock('./websocket.js', () => ({
    closeWebSocket: vi.fn(),
    connectTeamWebSocket: vi.fn(),
    setPollingBridge: vi.fn(),
  }));

  const mod = await import('./polling.js');
  return { ...mod, apiMock, ensureJoinedMock, loadTeamsMock, logoutMock, listeners };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete globalThis.document;
});

describe('polling store', () => {
  it('loads dashboard data in overview mode', async () => {
    const apiMock = vi.fn().mockResolvedValue({ teams: [{ team_id: 't_one' }] });
    const { forceRefresh, pollingActions } = await loadPollingModule({ apiMock });

    forceRefresh();
    await flushPromises();

    expect(apiMock).toHaveBeenCalledWith('GET', '/me/dashboard', null, 'tok_123', {
      signal: expect.any(AbortSignal),
    });
    expect(pollingActions.getState()).toMatchObject({
      dashboardData: { teams: [{ team_id: 't_one' }] },
      dashboardStatus: 'ready',
      contextStatus: 'idle',
      pollError: null,
    });
    expect(pollingActions.getState().lastUpdate).toBeInstanceOf(Date);
  });

  it('joins the active team and loads context in single-team mode', async () => {
    const apiMock = vi.fn().mockResolvedValue({ members: [] });
    const ensureJoinedMock = vi.fn().mockResolvedValue({ ok: true });
    const { forceRefresh, pollingActions } = await loadPollingModule({
      activeTeamId: 't_active',
      apiMock,
      ensureJoinedMock,
    });

    forceRefresh();
    await flushPromises();

    expect(ensureJoinedMock).toHaveBeenCalledWith('t_active');
    expect(apiMock).toHaveBeenCalledWith('GET', '/teams/t_active/context', null, 'tok_123', {
      signal: expect.any(AbortSignal),
    });
    expect(pollingActions.getState()).toMatchObject({
      contextData: { members: [] },
      contextStatus: 'ready',
      contextTeamId: 't_active',
      pollError: null,
    });
  });

  it('clears the inactive data branch when switching modes', async () => {
    const teamState = { activeTeamId: null };
    const apiMock = vi
      .fn()
      .mockResolvedValueOnce({ teams: [{ team_id: 't_one' }] })
      .mockResolvedValueOnce({ members: [{ agent_id: 'a_1', handle: 'alice' }] });
    const ensureJoinedMock = vi.fn().mockResolvedValue({ ok: true });
    const { forceRefresh, pollingActions } = await loadPollingModule({
      teamState,
      apiMock,
      ensureJoinedMock,
    });

    forceRefresh();
    await flushPromises();
    expect(pollingActions.getState().dashboardData).toMatchObject({
      teams: [{ team_id: 't_one' }],
    });

    teamState.activeTeamId = 't_active';
    forceRefresh();
    await flushPromises();

    expect(pollingActions.getState().dashboardData).toBeNull();
    expect(pollingActions.getState().contextData).toMatchObject({
      members: [{ agent_id: 'a_1', handle: 'alice' }],
    });
  });

  it('keeps the last overview snapshot when refresh fails', async () => {
    const apiMock = vi
      .fn()
      .mockResolvedValueOnce({ teams: [{ team_id: 't_one' }] })
      .mockRejectedValueOnce(new Error('HTTP 500 (server error)'));
    const { forceRefresh, pollingActions } = await loadPollingModule({ apiMock });

    forceRefresh();
    await flushPromises();
    forceRefresh();
    await flushPromises();

    expect(pollingActions.getState()).toMatchObject({
      dashboardData: { teams: [{ team_id: 't_one' }] },
      dashboardStatus: 'stale',
      pollError: 'HTTP 500 (server error)',
    });
  });

  it('refreshes the team list when dashboard fetch reports failed teams', async () => {
    const apiMock = vi.fn().mockResolvedValue({
      teams: [],
      degraded: true,
      failed_teams: [{ team_id: 't_one', team_name: 'chinwag' }],
    });
    const loadTeamsMock = vi.fn().mockResolvedValue(undefined);
    const { forceRefresh } = await loadPollingModule({ apiMock, loadTeamsMock });

    forceRefresh();
    await flushPromises();

    expect(loadTeamsMock).toHaveBeenCalledTimes(1);
  });

  it('marks the project view unavailable when the first context load fails', async () => {
    const apiMock = vi.fn().mockRejectedValue(new Error('HTTP 500 (server error)'));
    const ensureJoinedMock = vi.fn().mockResolvedValue({ ok: true });
    const { forceRefresh, pollingActions } = await loadPollingModule({
      activeTeamId: 't_active',
      apiMock,
      ensureJoinedMock,
    });

    forceRefresh();
    await flushPromises();

    expect(pollingActions.getState()).toMatchObject({
      contextData: null,
      contextStatus: 'error',
      contextTeamId: 't_active',
      pollError: 'HTTP 500 (server error)',
    });
  });

  it('logs out on 401 responses', async () => {
    const err = new Error('Unauthorized');
    err.status = 401;
    const apiMock = vi.fn().mockRejectedValue(err);
    const logoutMock = vi.fn();
    const { forceRefresh } = await loadPollingModule({ apiMock, logoutMock });

    forceRefresh();
    await flushPromises();

    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('formats network failures into a friendly poll error', async () => {
    const apiMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { forceRefresh, pollingActions } = await loadPollingModule({ apiMock });

    forceRefresh();
    await flushPromises();

    expect(pollingActions.getState().pollError).toBe('Cannot reach server. Check your connection.');
  });

  it('registers a visibilitychange handler when document is available', async () => {
    const apiMock = vi.fn().mockResolvedValue({ teams: [] });
    const { listeners } = await loadPollingModule({ apiMock, withDocument: true });

    expect(listeners.has('visibilitychange')).toBe(true);
  });

  it('resumes polling with a single immediate fetch when the tab becomes visible', async () => {
    const apiMock = vi.fn().mockResolvedValue({ teams: [] });
    const { listeners, stopPolling } = await loadPollingModule({ apiMock, withDocument: true });

    listeners.get('visibilitychange')?.();
    await flushPromises();

    expect(apiMock).toHaveBeenCalledTimes(1);
    stopPolling();
  });

  it('does not count AbortError as a failure or set pollError', async () => {
    const abortErr = new DOMException('The operation was aborted.', 'AbortError');
    const apiMock = vi.fn().mockRejectedValue(abortErr);
    const { forceRefresh, pollingActions } = await loadPollingModule({ apiMock });

    forceRefresh();
    await flushPromises();

    expect(pollingActions.getState()).toMatchObject({
      pollError: null,
      dashboardStatus: 'loading',
    });
  });

  it('passes an AbortSignal to api calls', async () => {
    const apiMock = vi.fn().mockResolvedValue({ teams: [] });
    const { forceRefresh } = await loadPollingModule({ apiMock });

    forceRefresh();
    await flushPromises();

    const callArgs = apiMock.mock.calls[0];
    expect(callArgs[4]).toEqual({ signal: expect.any(AbortSignal) });
  });

  it('aborts the previous request when a new poll starts', async () => {
    const apiMock = vi
      .fn()
      .mockImplementationOnce(
        (_m, _p, _b, _t, opts) =>
          new Promise((resolve, reject) => {
            // Simulate real fetch: reject with AbortError when signal fires
            opts?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError')),
            );
          }),
      )
      .mockResolvedValueOnce({ teams: [{ team_id: 't_two' }] });
    const { forceRefresh, pollingActions } = await loadPollingModule({ apiMock });

    // Start first poll — will hang until aborted
    forceRefresh();

    // Capture the signal from the first call
    const firstSignal = apiMock.mock.calls[0][4].signal;
    expect(firstSignal.aborted).toBe(false);

    // Start second poll — should abort the first
    forceRefresh();
    expect(firstSignal.aborted).toBe(true);
    await flushPromises();

    // Second poll's data should land, first was silently discarded
    expect(pollingActions.getState()).toMatchObject({
      dashboardData: { teams: [{ team_id: 't_two' }] },
      dashboardStatus: 'ready',
    });
  });
});
