import { afterEach, describe, expect, it, vi } from 'vitest';

function createSessionStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
  };
}

async function loadAuthModule({ apiMock, hash = '' } = {}) {
  vi.resetModules();
  globalThis.window = {
    location: {
      hash,
      pathname: '/dashboard',
    },
  };
  globalThis.history = {
    replaceState: vi.fn(),
  };
  globalThis.sessionStorage = createSessionStorage();
  vi.doMock('../api.js', () => ({
    api: apiMock || vi.fn(),
  }));
  return import('./auth.js');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete globalThis.window;
  delete globalThis.history;
  delete globalThis.sessionStorage;
});

describe('auth store', () => {
  it('reads a token from the URL hash and clears it', async () => {
    const { authActions } = await loadAuthModule({ hash: '#token=abc123&next=%2Fdashboard' });

    expect(authActions.readTokenFromHash()).toBe('abc123');
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/dashboard');
  });

  it('returns null when no token is present in the hash', async () => {
    const { authActions } = await loadAuthModule({ hash: '#view=overview' });

    expect(authActions.readTokenFromHash()).toBeNull();
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it('authenticates successfully and persists the token', async () => {
    const apiMock = vi.fn().mockResolvedValue({ handle: 'alice', color: 'cyan' });
    const { authActions } = await loadAuthModule({ apiMock });

    await expect(authActions.authenticate('tok_123')).resolves.toBe(true);
    expect(apiMock).toHaveBeenCalledWith('GET', '/me', null, 'tok_123');
    expect(authActions.getState()).toMatchObject({
      token: 'tok_123',
      user: { handle: 'alice', color: 'cyan' },
    });
    expect(sessionStorage.getItem('chinwag_token')).toBe('tok_123');
  });

  it('clears auth state and storage when authentication fails', async () => {
    const apiMock = vi.fn().mockRejectedValue(new Error('Unauthorized'));
    const { authActions } = await loadAuthModule({ apiMock });

    await expect(authActions.authenticate('bad_token')).rejects.toThrow('Unauthorized');
    expect(authActions.getState()).toMatchObject({ token: null, user: null });
    expect(sessionStorage.getItem('chinwag_token')).toBeNull();
  });

  it('logs out by clearing user state and session storage', async () => {
    const apiMock = vi.fn().mockResolvedValue({ handle: 'alice' });
    const { authActions } = await loadAuthModule({ apiMock });
    await authActions.authenticate('tok_123');

    authActions.logout();

    expect(authActions.getState()).toMatchObject({ token: null, user: null });
    expect(sessionStorage.getItem('chinwag_token')).toBeNull();
  });
});
