import { z } from 'zod';
import { createStore, useStore } from 'zustand';
import { api } from '../api.js';
import { userProfileSchema, validateResponse } from '../apiSchemas.js';

const TOKEN_KEY = 'chinwag_token';

type UserProfile = z.infer<typeof userProfileSchema>;

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
    return localStorage.getItem(TOKEN_KEY);
  },

  async authenticate(t: string) {
    set({ token: t });
    try {
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
  },

  logout() {
    set({ token: null, user: null });
    localStorage.removeItem(TOKEN_KEY);
  },
}));

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
