// @vitest-environment jsdom

import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createApiMock({
  user = { handle: 'alice', color: 'blue', user_id: 'u_1' },
  teams = [],
  dashboard = { teams: [] },
  context = { members: [] },
  meError = null,
} = {}) {
  return vi.fn(async (method, path, _body, token) => {
    if (path === '/me') {
      if (meError) throw meError;
      return { ...user, tokenSeen: token };
    }
    if (path === '/me/teams') {
      return { teams };
    }
    if (path === '/me/dashboard') {
      return dashboard;
    }
    if (method === 'POST' && /^\/teams\/[^/]+\/join$/.test(path)) {
      return { ok: true };
    }
    if (method === 'GET' && /^\/teams\/[^/]+\/context$/.test(path)) {
      return context;
    }
    if (method === 'POST' && path === '/auth/ws-ticket') {
      return { ticket: 'tk_test' };
    }
    throw new Error(`Unexpected API call: ${method} ${path}`);
  });
}

async function flushEffects(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function createMockStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  function setState(update) {
    state = typeof update === 'function' ? update(state) : { ...state, ...update };
    listeners.forEach((listener) => listener());
  }

  return {
    getState: () => state,
    setState,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    useStore(selector) {
      const [selected, setSelected] = React.useState(() => selector(state));

      React.useEffect(() => {
        const handleChange = () => setSelected(selector(state));
        listeners.add(handleChange);
        return () => listeners.delete(handleChange);
      }, [selector]);

      return selected;
    },
  };
}

async function loadAppModule(options = {}) {
  vi.resetModules();
  localStorage.clear();
  window.location.hash = options.hashToken ? `#token=${options.hashToken}` : '';

  if (options.storedToken) {
    localStorage.setItem('chinwag_token', options.storedToken);
  }

  const apiMock = options.apiMock || createApiMock(options);
  vi.doMock('react', () => ({ ...React, default: React }));

  vi.doMock('./lib/api.js', () => ({
    api: apiMock,
    getApiUrl: () => 'https://test.chinwag.dev',
  }));

  vi.doMock('./views/ConnectView/ConnectView.jsx', () => ({
    default: function MockConnectView({ error }) {
      return <div data-testid="connect-view">{error || 'connect-view'}</div>;
    },
  }));

  vi.doMock('./views/OverviewView/OverviewView.jsx', () => ({
    default: function MockOverviewView() {
      return <div data-testid="overview-view">overview-view</div>;
    },
  }));

  vi.doMock('./views/ProjectView/ProjectView.jsx', () => ({
    default: function MockProjectView() {
      return <div data-testid="project-view">project-view</div>;
    },
  }));

  vi.doMock('./views/SettingsView/SettingsView.jsx', () => ({
    default: function MockSettingsView() {
      return <div data-testid="settings-view">settings-view</div>;
    },
  }));

  vi.doMock('./views/ToolsView/ToolsView.jsx', () => ({
    default: function MockToolsView() {
      return <div data-testid="tools-view">tools-view</div>;
    },
  }));

  vi.doMock('./components/Sidebar/Sidebar.jsx', () => ({
    default: function MockSidebar({ activeNav, onNavigate }) {
      return (
        <div data-testid="sidebar">
          <button data-testid="show-settings" onClick={() => onNavigate('settings')}>
            show settings
          </button>
          <button data-testid="hide-settings" onClick={() => onNavigate(null)}>
            hide settings
          </button>
          <button data-testid="show-tools" onClick={() => onNavigate('tools')}>
            show tools
          </button>
          <span data-testid="sidebar-state">{String(activeNav)}</span>
        </div>
      );
    },
  }));

  vi.doMock('./components/RenderErrorBoundary/RenderErrorBoundary.jsx', () => ({
    default: function MockRenderErrorBoundary({ children }) {
      return <>{children}</>;
    },
  }));

  const authStore = createMockStore({ token: null, user: null });
  const teamStore = createMockStore({ teams: [], activeTeamId: null, teamsError: null });
  const pollingStore = createMockStore({
    dashboardData: null,
    dashboardStatus: 'idle',
    contextData: null,
    contextStatus: 'idle',
    contextTeamId: null,
    pollError: null,
    pollErrorData: null,
    lastUpdate: null,
  });
  const joinedTeams = new Set();
  const stopPolling = vi.fn();

  const authActions = {
    getState: () => authStore.getState(),
    readTokenFromHash() {
      const hash = window.location.hash;
      if (!hash.includes('token=')) return null;
      const match = hash.match(/token=([^&]+)/);
      if (!match) return null;
      history.replaceState(null, '', window.location.pathname);
      return match[1];
    },
    getStoredToken() {
      return localStorage.getItem('chinwag_token');
    },
    async authenticate(token) {
      authStore.setState({ token });
      try {
        const user = await apiMock('GET', '/me', null, token);
        authStore.setState({ token, user });
        localStorage.setItem('chinwag_token', token);
        return true;
      } catch (error) {
        authStore.setState({ token: null, user: null });
        localStorage.removeItem('chinwag_token');
        throw error;
      }
    },
    logout() {
      authStore.setState({ token: null, user: null });
      localStorage.removeItem('chinwag_token');
    },
    updateUser(updates) {
      const current = authStore.getState().user;
      if (current) authStore.setState({ user: { ...current, ...updates } });
    },
    subscribe: authStore.subscribe,
  };

  const teamActions = {
    getState: () => teamStore.getState(),
    async loadTeams() {
      const token = authStore.getState().token;
      try {
        const result = await apiMock('GET', '/me/teams', null, token);
        const teams = result.teams || [];
        teamStore.setState({
          teams,
          activeTeamId: teams.length === 1 ? teams[0].team_id : null,
          teamsError: null,
        });
      } catch (error) {
        teamStore.setState({
          teams: [],
          activeTeamId: null,
          teamsError: error?.message || 'Could not load projects.',
        });
      }
    },
    selectTeam(teamId) {
      teamStore.setState({ activeTeamId: teamId });
    },
    async ensureJoined(teamId) {
      const token = authStore.getState().token;
      if (joinedTeams.has(teamId)) return;
      await apiMock('POST', `/teams/${teamId}/join`, {}, token);
      joinedTeams.add(teamId);
    },
    subscribe: teamStore.subscribe,
  };

  async function runPollingCycle() {
    const token = authStore.getState().token;
    const activeTeamId = teamStore.getState().activeTeamId;
    if (!token) return;

    if (activeTeamId === null) {
      const dashboardData = await apiMock('GET', '/me/dashboard', null, token);
      pollingStore.setState({
        dashboardData,
        dashboardStatus: 'ready',
        contextData: null,
        contextStatus: 'idle',
        contextTeamId: null,
        lastUpdate: new Date(),
        pollError: null,
        pollErrorData: null,
      });
      return;
    }

    await teamActions.ensureJoined(activeTeamId);
    const contextData = await apiMock('GET', `/teams/${activeTeamId}/context`, null, token);
    pollingStore.setState({
      dashboardData: null,
      dashboardStatus: 'idle',
      contextData,
      contextStatus: 'ready',
      contextTeamId: activeTeamId,
      lastUpdate: new Date(),
      pollError: null,
      pollErrorData: null,
    });
  }

  const resetPollingState = () => {
    pollingStore.setState({
      dashboardData: null,
      dashboardStatus: 'idle',
      contextData: null,
      contextStatus: 'idle',
      contextTeamId: null,
      pollError: null,
      pollErrorData: null,
      lastUpdate: null,
    });
  };

  const startPolling = () => {
    void runPollingCycle();
  };

  const forceRefresh = () => {
    void runPollingCycle();
  };

  vi.doMock('./lib/stores/auth.js', () => ({
    useAuthStore: (selector) => authStore.useStore(selector),
    authActions,
  }));

  vi.doMock('./lib/stores/teams.js', () => ({
    useTeamStore: (selector) => teamStore.useStore(selector),
    teamActions,
  }));

  vi.doMock('./lib/stores/polling.js', () => ({
    usePollingStore: (selector) => pollingStore.useStore(selector),
    startPolling,
    stopPolling,
    resetPollingState,
    forceRefresh,
  }));

  const [{ default: App }] = await Promise.all([import('./App.js')]);

  return {
    App,
    apiMock,
    authActions,
    teamActions,
    stopPolling,
    react: React,
    createRoot,
  };
}

function renderApp(App, ReactModule, createRoot) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(ReactModule.createElement(App));
  });

  return {
    container,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.location.hash = '';
  document.body.innerHTML = '';
});

describe('App boot and view switching', () => {
  it('renders the connect view when no token is available', async () => {
    const { App, stopPolling, react, createRoot } = await loadAppModule();
    const { container, unmount } = renderApp(App, react, createRoot);

    await flushEffects();

    expect(container.querySelector('[data-testid="connect-view"]')?.textContent).toBe(
      'connect-view',
    );

    unmount();
    stopPolling();
  });

  it('prefers the hash token over the stored token during boot', async () => {
    const { App, apiMock, stopPolling, react, createRoot } = await loadAppModule({
      hashToken: 'tok_from_hash',
      storedToken: 'tok_from_storage',
      teams: [{ team_id: 't_one' }, { team_id: 't_two' }],
    });
    const { container, unmount } = renderApp(App, react, createRoot);

    await flushEffects();

    expect(apiMock).toHaveBeenCalledWith('GET', '/me', null, 'tok_from_hash');
    expect(container.querySelector('[data-testid="overview-view"]')).not.toBeNull();

    unmount();
    stopPolling();
  });

  it('boots into the project view when only one team exists', async () => {
    const { App, apiMock, stopPolling, react, createRoot } = await loadAppModule({
      storedToken: 'tok_project',
      teams: [{ team_id: 't_solo' }],
      context: { members: [{ handle: 'alice', status: 'active' }] },
    });
    const { container, unmount } = renderApp(App, react, createRoot);

    await flushEffects(6);

    expect(container.querySelector('[data-testid="project-view"]')).not.toBeNull();
    expect(apiMock).toHaveBeenCalledWith('POST', '/teams/t_solo/join', {}, 'tok_project');
    expect(apiMock).toHaveBeenCalledWith('GET', '/teams/t_solo/context', null, 'tok_project');

    unmount();
    stopPolling();
  });

  it('shows the auth error in the connect view when boot authentication fails', async () => {
    const { App, stopPolling, react, createRoot } = await loadAppModule({
      storedToken: 'tok_bad',
      meError: new Error('Bad token'),
    });
    const { container, unmount } = renderApp(App, react, createRoot);

    await flushEffects();

    expect(container.querySelector('[data-testid="connect-view"]')?.textContent).toContain(
      'Bad token',
    );

    unmount();
    stopPolling();
  });

  it('switches between overview and settings through the sidebar controls', async () => {
    const { App, stopPolling, react, createRoot } = await loadAppModule({
      storedToken: 'tok_settings',
      teams: [{ team_id: 't_one' }, { team_id: 't_two' }],
    });
    const { container, unmount } = renderApp(App, react, createRoot);

    await flushEffects();

    expect(container.querySelector('[data-testid="overview-view"]')).not.toBeNull();

    await act(async () => {
      container
        .querySelector('[data-testid="show-settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="settings-view"]')).not.toBeNull();

    await act(async () => {
      container
        .querySelector('[data-testid="hide-settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="overview-view"]')).not.toBeNull();

    unmount();
    stopPolling();
  });

  it('switches to the tools view through the sidebar controls', async () => {
    const { App, stopPolling, react, createRoot } = await loadAppModule({
      storedToken: 'tok_tools',
      teams: [{ team_id: 't_one' }, { team_id: 't_two' }],
    });
    const { container, unmount } = renderApp(App, react, createRoot);

    await flushEffects();
    expect(container.querySelector('[data-testid="overview-view"]')).not.toBeNull();

    await act(async () => {
      container
        .querySelector('[data-testid="show-tools"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="tools-view"]')).not.toBeNull();

    unmount();
    stopPolling();
  });

  it('returns to the connect view when auth state is cleared after boot', async () => {
    const { App, authActions, stopPolling, react, createRoot } = await loadAppModule({
      storedToken: 'tok_logout',
      teams: [{ team_id: 't_one' }, { team_id: 't_two' }],
    });
    const { container, unmount } = renderApp(App, react, createRoot);

    await flushEffects();
    expect(container.querySelector('[data-testid="overview-view"]')).not.toBeNull();

    await act(async () => {
      authActions.logout();
    });
    await flushEffects();

    expect(container.querySelector('[data-testid="connect-view"]')).not.toBeNull();

    unmount();
    stopPolling();
  });
});
