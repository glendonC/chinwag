import { afterEach, describe, expect, it, vi } from 'vitest';

async function flushPromises(n = 3) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

async function loadPollingModule({
  token = 'tok_123',
  activeTeamId = null as string | null,
  teamState = { activeTeamId } as { activeTeamId: string | null },
  apiMock = vi.fn(),
  ensureJoinedMock = vi.fn(),
  loadTeamsMock = vi.fn(),
  logoutMock = vi.fn(),
  withDocument = false,
} = {}) {
  vi.resetModules();

  const listeners = new Map<string, () => void>();
  if (withDocument) {
    globalThis.document = {
      hidden: false,
      addEventListener: vi.fn((event: string, handler: () => void) =>
        listeners.set(event, handler),
      ),
    } as unknown as Document;
  } else {
    delete (globalThis as Record<string, unknown>).document;
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

  const mod = await import('../polling.js');
  return { ...mod, apiMock, ensureJoinedMock, loadTeamsMock, logoutMock, listeners };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).document;
});

describe('polling store', () => {
  describe('start and stop', () => {
    it('starts polling and fetches dashboard data immediately', async () => {
      const apiMock = vi.fn().mockResolvedValue({ teams: [] });
      const { startPolling, stopPolling, pollingActions } = await loadPollingModule({ apiMock });

      startPolling();
      await flushPromises();

      expect(apiMock).toHaveBeenCalledWith('GET', '/me/dashboard', null, 'tok_123', {
        signal: expect.any(AbortSignal),
      });
      expect(pollingActions.getState().dashboardStatus).toBe('ready');

      stopPolling();
    });

    it('stops polling and clears timer', async () => {
      const apiMock = vi.fn().mockResolvedValue({ teams: [] });
      const { startPolling, stopPolling, pollingActions } = await loadPollingModule({ apiMock });

      startPolling();
      await flushPromises();
      stopPolling();

      const callCount = apiMock.mock.calls.length;
      await flushPromises();
      // No additional calls after stop
      expect(apiMock.mock.calls.length).toBe(callCount);
      expect(pollingActions.getState().dashboardStatus).toBe('ready');
    });

    it('resetPollingState clears all state', async () => {
      const apiMock = vi.fn().mockResolvedValue({ teams: [{ team_id: 't_one' }] });
      const { forceRefresh, resetPollingState, pollingActions } = await loadPollingModule({
        apiMock,
      });

      forceRefresh();
      await flushPromises();
      expect(pollingActions.getState().dashboardData).not.toBeNull();

      resetPollingState();

      expect(pollingActions.getState()).toMatchObject({
        dashboardData: null,
        dashboardStatus: 'idle',
        contextData: null,
        contextStatus: 'idle',
        contextTeamId: null,
        pollError: null,
        pollErrorData: null,
        lastUpdate: null,
        consecutiveFailures: 0,
      });
    });
  });

  describe('AbortController cancellation', () => {
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
          (_m: string, _p: string, _b: unknown, _t: string, opts: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              opts?.signal?.addEventListener('abort', () =>
                reject(new DOMException('The operation was aborted.', 'AbortError')),
              );
            }),
        )
        .mockResolvedValueOnce({ teams: [{ team_id: 't_two' }] });
      const { forceRefresh, pollingActions } = await loadPollingModule({ apiMock });

      forceRefresh();

      const firstSignal = apiMock.mock.calls[0][4].signal as AbortSignal;
      expect(firstSignal.aborted).toBe(false);

      forceRefresh();
      expect(firstSignal.aborted).toBe(true);
      await flushPromises();

      expect(pollingActions.getState()).toMatchObject({
        dashboardData: { teams: [{ team_id: 't_two' }] },
        dashboardStatus: 'ready',
      });
    });

    it('does not count AbortError as a failure', async () => {
      const abortErr = new DOMException('The operation was aborted.', 'AbortError');
      const apiMock = vi.fn().mockRejectedValue(abortErr);
      const { forceRefresh, pollingActions } = await loadPollingModule({ apiMock });

      forceRefresh();
      await flushPromises();

      expect(pollingActions.getState()).toMatchObject({
        pollError: null,
        consecutiveFailures: 0,
      });
    });
  });

  describe('error classification', () => {
    it('classifies network errors as friendly messages', async () => {
      const apiMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
      const { forceRefresh, pollingActions } = await loadPollingModule({ apiMock });

      forceRefresh();
      await flushPromises();

      expect(pollingActions.getState().pollError).toBe(
        'Cannot reach server. Check your connection.',
      );
    });

    it('classifies HTTP 500 as the error message', async () => {
      const apiMock = vi.fn().mockRejectedValue(new Error('HTTP 500 (server error)'));
      const { forceRefresh, pollingActions } = await loadPollingModule({ apiMock });

      forceRefresh();
      await flushPromises();

      expect(pollingActions.getState().pollError).toBe('HTTP 500 (server error)');
    });

    it('logs out on 401 responses', async () => {
      const err = Object.assign(new Error('Unauthorized'), { status: 401 });
      const apiMock = vi.fn().mockRejectedValue(err);
      const logoutMock = vi.fn();
      const { forceRefresh } = await loadPollingModule({ apiMock, logoutMock });

      forceRefresh();
      await flushPromises();

      expect(logoutMock).toHaveBeenCalledTimes(1);
    });

    it('formats string errors directly', async () => {
      const apiMock = vi.fn().mockRejectedValue('raw string error');
      const { forceRefresh, pollingActions } = await loadPollingModule({ apiMock });

      forceRefresh();
      await flushPromises();

      expect(pollingActions.getState().pollError).toBe('raw string error');
    });
  });

  describe('consecutive failure tracking', () => {
    it('increments consecutiveFailures on each error', async () => {
      const apiMock = vi.fn().mockRejectedValue(new Error('fail'));
      const { forceRefresh, pollingActions } = await loadPollingModule({ apiMock });

      forceRefresh();
      await flushPromises();
      expect(pollingActions.getState().consecutiveFailures).toBe(1);

      forceRefresh();
      await flushPromises();
      expect(pollingActions.getState().consecutiveFailures).toBe(2);
    });

    it('resets consecutiveFailures on success', async () => {
      const apiMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ teams: [] });
      const { forceRefresh, pollingActions } = await loadPollingModule({ apiMock });

      forceRefresh();
      await flushPromises();
      forceRefresh();
      await flushPromises();
      expect(pollingActions.getState().consecutiveFailures).toBe(2);

      forceRefresh();
      await flushPromises();
      expect(pollingActions.getState().consecutiveFailures).toBe(0);
    });

    it('marks dashboard status as stale when it has data and a new poll fails', async () => {
      const apiMock = vi
        .fn()
        .mockResolvedValueOnce({ teams: [{ team_id: 't_one' }] })
        .mockRejectedValueOnce(new Error('Server error'));
      const { forceRefresh, pollingActions } = await loadPollingModule({ apiMock });

      forceRefresh();
      await flushPromises();
      forceRefresh();
      await flushPromises();

      expect(pollingActions.getState()).toMatchObject({
        dashboardData: { teams: [{ team_id: 't_one' }] },
        dashboardStatus: 'stale',
        pollError: 'Server error',
      });
    });
  });

  describe('data versioning (stale update prevention)', () => {
    it('loads context for an active team', async () => {
      const apiMock = vi.fn().mockResolvedValue({ members: [{ agent_id: 'a1', handle: 'a' }] });
      const ensureJoinedMock = vi.fn().mockResolvedValue({ ok: true });
      const { forceRefresh, pollingActions } = await loadPollingModule({
        activeTeamId: 't_active',
        apiMock,
        ensureJoinedMock,
      });

      forceRefresh();
      await flushPromises();

      expect(ensureJoinedMock).toHaveBeenCalledWith('t_active');
      expect(pollingActions.getState()).toMatchObject({
        contextData: { members: [{ agent_id: 'a1', handle: 'a' }] },
        contextStatus: 'ready',
        contextTeamId: 't_active',
      });
    });

    it('clears inactive data branch when switching between overview and project', async () => {
      const teamState = { activeTeamId: null as string | null };
      const apiMock = vi
        .fn()
        .mockResolvedValueOnce({ teams: [{ team_id: 't_one' }] })
        .mockResolvedValueOnce({ members: [] });
      const ensureJoinedMock = vi.fn().mockResolvedValue({ ok: true });
      const { forceRefresh, pollingActions } = await loadPollingModule({
        teamState,
        apiMock,
        ensureJoinedMock,
      });

      forceRefresh();
      await flushPromises();
      expect(pollingActions.getState().dashboardData).not.toBeNull();
      expect(pollingActions.getState().contextData).toBeNull();

      teamState.activeTeamId = 't_active';
      forceRefresh();
      await flushPromises();

      expect(pollingActions.getState().dashboardData).toBeNull();
      expect(pollingActions.getState().contextData).not.toBeNull();
    });

    it('refreshes team list when dashboard reports failed teams', async () => {
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
  });

  describe('visibility change', () => {
    it('registers a visibilitychange handler when document is available', async () => {
      const apiMock = vi.fn().mockResolvedValue({ teams: [] });
      const { listeners } = await loadPollingModule({ apiMock, withDocument: true });

      expect(listeners.has('visibilitychange')).toBe(true);
    });

    it('resumes polling when the tab becomes visible', async () => {
      const apiMock = vi.fn().mockResolvedValue({ teams: [] });
      const { listeners, stopPolling } = await loadPollingModule({
        apiMock,
        withDocument: true,
      });

      listeners.get('visibilitychange')?.();
      await flushPromises();

      expect(apiMock).toHaveBeenCalledTimes(1);
      stopPolling();
    });
  });
});
