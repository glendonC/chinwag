import { afterEach, describe, expect, it, vi } from 'vitest';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function loadPollingModule({
  token = 'tok_123',
  activeTeamId = null,
  apiMock = vi.fn(),
  ensureJoinedMock = vi.fn(),
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
    },
  }));
  vi.doMock('./teams.js', () => ({
    teamActions: {
      getState: () => ({ activeTeamId }),
      ensureJoined: ensureJoinedMock,
    },
  }));

  const mod = await import('./polling.js');
  return { ...mod, apiMock, ensureJoinedMock, logoutMock, listeners };
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

    expect(apiMock).toHaveBeenCalledWith('GET', '/me/dashboard', null, 'tok_123');
    expect(pollingActions.getState()).toMatchObject({
      dashboardData: { teams: [{ team_id: 't_one' }] },
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
    expect(apiMock).toHaveBeenCalledWith('GET', '/teams/t_active/context', null, 'tok_123');
    expect(pollingActions.getState()).toMatchObject({
      contextData: { members: [] },
      pollError: null,
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
});
