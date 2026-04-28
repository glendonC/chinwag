import { type z } from 'zod';
import { createStore, useStore } from 'zustand';
import { api } from '../api.js';
import { userProfileSchema, validateResponse } from '../apiSchemas.js';
import { isDemoActive, getActiveScenarioId } from '../demoMode.js';
import { getDemoData } from '../demo/index.js';

const TOKEN_KEY = 'chinmeister_token';
// Synthetic token used when demo is active and no real token is in storage.
// The api() call is bypassed entirely on the demo path, so the value never
// reaches the wire - it's just a non-null marker so the App boot flow
// proceeds past its `if (!t)` guard into authenticate().
const DEMO_TOKEN = '__demo__';

type UserProfile = z.infer<typeof userProfileSchema>;

// Inflight deduplication: if two concurrent authenticate() calls fire,
// the second awaits the first's promise instead of starting a new one.
// Same pattern as packages/mcp/lib/api.ts inflightRefresh.
let inflightAuth: Promise<boolean> | null = null;

interface AuthState {
  token: string | null;
  user: UserProfile | null;
  readTokenFromHash: () => string | null;
  getStoredToken: () => string | null;
  authenticate: (t: string) => Promise<boolean>;
  logout: () => void;
}

const authStore = createStore<AuthState>((set) => ({
  token: null,
  user: null,

  readTokenFromHash() {
    const hash = window.location.hash;
    if (!hash.includes('token=')) return null;
    const match = hash.match(/token=([^&]+)/);
    if (!match) return null;
    window.history.replaceState(null, '', window.location.pathname);
    return match[1];
  },

  getStoredToken() {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) return stored;
    // Demo mode without a real token: hand back a synthetic so the App
    // boot path proceeds into authenticate(), which will short-circuit on
    // the demo path. This lets ?demo work for first-time visitors who
    // never authenticated.
    if (isDemoActive()) return DEMO_TOKEN;
    return null;
  },

  async authenticate(t: string) {
    if (inflightAuth) return inflightAuth;

    inflightAuth = (async () => {
      set({ token: t });
      try {
        // Demo path: skip the API and inject the scenario's user. Don't
        // touch localStorage so toggling demo off restores any real token.
        if (isDemoActive()) {
          const me = getDemoData(getActiveScenarioId()).me;
          set({ user: me });
          return true;
        }
        const rawUser = await api('GET', '/me', null, t);
        const userData = validateResponse(userProfileSchema, rawUser, 'me', {
          throwOnError: true,
        }) as UserProfile;
        set({ user: userData });
        localStorage.setItem(TOKEN_KEY, t);
        return true;
      } catch (err) {
        set({ token: null, user: null });
        localStorage.removeItem(TOKEN_KEY);
        throw err;
      }
    })().finally(() => {
      inflightAuth = null;
    });

    return inflightAuth;
  },

  logout() {
    set({ token: null, user: null });
    localStorage.removeItem(TOKEN_KEY);
  },
}));

// Re-evaluate auth on demo toggle so the sidebar/profile pill reflects the
// active mode without a page reload. Three branches:
//   - real token in storage → re-run authenticate (real path off, demo path on)
//   - no real token, demo just turned on → authenticate with the synthetic
//   - no real token, demo just turned off → drop to unauthenticated so the
//     boot screen state is honest about there being no real session.
//
// The function-shape check matters: jsdom-style test stubs sometimes provide
// a partial `window` object without addEventListener, and we don't want
// module evaluation to crash in that case.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('chinmeister:demo-scenario-changed', () => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) {
      authStore
        .getState()
        .authenticate(stored)
        .catch(() => {});
    } else if (isDemoActive()) {
      authStore
        .getState()
        .authenticate(DEMO_TOKEN)
        .catch(() => {});
    } else {
      authStore.setState({ token: null, user: null });
    }
  });
}

export function useAuthStore<T>(selector: (state: AuthState) => T): T {
  return useStore(authStore, selector);
}

export const authActions = {
  getState: (): AuthState => authStore.getState(),
  authenticate: (t: string): Promise<boolean> => authStore.getState().authenticate(t),
  logout: (): void => authStore.getState().logout(),
  readTokenFromHash: (): string | null => authStore.getState().readTokenFromHash(),
  getStoredToken: (): string | null => authStore.getState().getStoredToken(),
  subscribe: authStore.subscribe,

  updateUser(updates: Partial<UserProfile>): void {
    const current = authStore.getState().user;
    if (current) authStore.setState({ user: { ...current, ...updates } });
  },
};
