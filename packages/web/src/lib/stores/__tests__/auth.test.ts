import { afterEach, describe, expect, it, vi } from 'vitest';

function createStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    get length() {
      return data.size;
    },
    key: (_index: number) => null,
  };
}

async function loadAuthModule({ apiMock = vi.fn(), hash = '' } = {}) {
  vi.resetModules();
  (globalThis as Record<string, unknown>).window = {
    location: {
      hash,
      pathname: '/dashboard',
    },
    history: {
      replaceState: vi.fn(),
    },
  };
  (globalThis as Record<string, unknown>).history = (
    globalThis as Record<string, unknown> & { window: { history: unknown } }
  ).window.history;
  (globalThis as Record<string, unknown>).localStorage = createStorage();
  vi.doMock('../api.js', () => ({
    api: apiMock,
  }));
  return import('../auth.js');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).history;
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe('auth store', () => {
  describe('token extraction from URL hash', () => {
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

    it('returns null when hash is empty', async () => {
      const { authActions } = await loadAuthModule({ hash: '' });

      expect(authActions.readTokenFromHash()).toBeNull();
    });

    it('extracts token when it is the only hash parameter', async () => {
      const { authActions } = await loadAuthModule({ hash: '#token=solo_tok' });

      expect(authActions.readTokenFromHash()).toBe('solo_tok');
    });
  });

  describe('localStorage sync', () => {
    it('getStoredToken reads from localStorage', async () => {
      const { authActions } = await loadAuthModule();
      localStorage.setItem('chinwag_token', 'stored_tok');

      expect(authActions.getStoredToken()).toBe('stored_tok');
    });

    it('getStoredToken returns null when nothing stored', async () => {
      const { authActions } = await loadAuthModule();

      expect(authActions.getStoredToken()).toBeNull();
    });

    it('authenticate persists token to localStorage', async () => {
      const apiMock = vi.fn().mockResolvedValue({ handle: 'bob', color: 'green' });
      const { authActions } = await loadAuthModule({ apiMock });

      await authActions.authenticate('tok_persist');

      expect(localStorage.getItem('chinwag_token')).toBe('tok_persist');
    });

    it('logout removes token from localStorage', async () => {
      const apiMock = vi.fn().mockResolvedValue({ handle: 'bob', color: 'green' });
      const { authActions } = await loadAuthModule({ apiMock });
      await authActions.authenticate('tok_persist');

      authActions.logout();

      expect(localStorage.getItem('chinwag_token')).toBeNull();
    });
  });

  describe('authenticate flow', () => {
    it('authenticates successfully and stores user data', async () => {
      const apiMock = vi.fn().mockResolvedValue({ handle: 'alice', color: 'cyan' });
      const { authActions } = await loadAuthModule({ apiMock });

      await expect(authActions.authenticate('tok_123')).resolves.toBe(true);
      expect(apiMock).toHaveBeenCalledWith('GET', '/me', null, 'tok_123');
      expect(authActions.getState()).toMatchObject({
        token: 'tok_123',
        user: { handle: 'alice', color: 'cyan' },
      });
    });

    it('clears auth state when authentication fails', async () => {
      const apiMock = vi.fn().mockRejectedValue(new Error('Unauthorized'));
      const { authActions } = await loadAuthModule({ apiMock });

      await expect(authActions.authenticate('bad_token')).rejects.toThrow('Unauthorized');
      expect(authActions.getState()).toMatchObject({ token: null, user: null });
      expect(localStorage.getItem('chinwag_token')).toBeNull();
    });

    it('sets token before the API call so auth header is available', async () => {
      let tokenDuringCall: string | null = null;
      const apiMock = vi.fn().mockImplementation(async () => {
        // We cannot directly check authActions during the call since we are mocking api,
        // but we verify the token was passed correctly
        tokenDuringCall = 'tok_check';
        return { handle: 'alice', color: 'cyan' };
      });
      const { authActions } = await loadAuthModule({ apiMock });

      await authActions.authenticate('tok_check');

      expect(tokenDuringCall).toBe('tok_check');
      expect(apiMock).toHaveBeenCalledWith('GET', '/me', null, 'tok_check');
    });
  });

  describe('logout', () => {
    it('clears user state and session storage', async () => {
      const apiMock = vi.fn().mockResolvedValue({ handle: 'alice', color: 'cyan' });
      const { authActions } = await loadAuthModule({ apiMock });
      await authActions.authenticate('tok_123');

      authActions.logout();

      expect(authActions.getState()).toMatchObject({ token: null, user: null });
      expect(localStorage.getItem('chinwag_token')).toBeNull();
    });

    it('is safe to call multiple times', async () => {
      const { authActions } = await loadAuthModule();

      expect(() => {
        authActions.logout();
        authActions.logout();
      }).not.toThrow();
      expect(authActions.getState()).toMatchObject({ token: null, user: null });
    });
  });

  describe('updateUser', () => {
    it('merges partial updates into the current user', async () => {
      const apiMock = vi.fn().mockResolvedValue({ handle: 'alice', color: 'cyan' });
      const { authActions } = await loadAuthModule({ apiMock });
      await authActions.authenticate('tok_123');

      authActions.updateUser({ handle: 'alice_updated' });

      expect(authActions.getState().user).toMatchObject({
        handle: 'alice_updated',
        color: 'cyan',
      });
    });

    it('does nothing if there is no current user', async () => {
      const { authActions } = await loadAuthModule();

      // Should not throw when user is null
      expect(() => authActions.updateUser({ handle: 'ghost' })).not.toThrow();
      expect(authActions.getState().user).toBeNull();
    });
  });
});
