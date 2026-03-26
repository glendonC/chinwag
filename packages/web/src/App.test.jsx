// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createApiMock({
  user = { handle: 'alice', user_id: 'u_1' },
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

async function loadAppModule(options = {}) {
  vi.resetModules();
  sessionStorage.clear();
  window.location.hash = options.hashToken ? `#token=${options.hashToken}` : '';

  if (options.storedToken) {
    sessionStorage.setItem('chinwag_token', options.storedToken);
  }

  const apiMock = options.apiMock || createApiMock(options);

  vi.doMock('./lib/api.js', () => ({
    api: apiMock,
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

  vi.doMock('./components/Sidebar/Sidebar.jsx', () => ({
    default: function MockSidebar({ showSettings, onSelectSettings }) {
      return (
        <div data-testid="sidebar">
          <button data-testid="show-settings" onClick={() => onSelectSettings(true)}>
            show settings
          </button>
          <button data-testid="hide-settings" onClick={() => onSelectSettings(false)}>
            hide settings
          </button>
          <span data-testid="sidebar-state">{String(showSettings)}</span>
        </div>
      );
    },
  }));

  const [{ default: App }, { authActions }, { teamActions }, { stopPolling }] = await Promise.all([
    import('./App.jsx'),
    import('./lib/stores/auth.js'),
    import('./lib/stores/teams.js'),
    import('./lib/stores/polling.js'),
  ]);

  return { App, apiMock, authActions, teamActions, stopPolling };
}

function renderApp(App) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<App />);
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
  sessionStorage.clear();
  window.location.hash = '';
  document.body.innerHTML = '';
});

describe('App boot and view switching', () => {
  it('renders the connect view when no token is available', async () => {
    const { App, stopPolling } = await loadAppModule();
    const { container, unmount } = renderApp(App);

    await flushEffects();

    expect(container.querySelector('[data-testid="connect-view"]')?.textContent).toBe('connect-view');

    unmount();
    stopPolling();
  });

  it('prefers the hash token over the stored token during boot', async () => {
    const { App, apiMock, stopPolling } = await loadAppModule({
      hashToken: 'tok_from_hash',
      storedToken: 'tok_from_storage',
      teams: [{ team_id: 't_one' }, { team_id: 't_two' }],
    });
    const { container, unmount } = renderApp(App);

    await flushEffects();

    expect(apiMock).toHaveBeenCalledWith('GET', '/me', null, 'tok_from_hash');
    expect(container.querySelector('[data-testid="overview-view"]')).not.toBeNull();

    unmount();
    stopPolling();
  });

  it('boots into the project view when only one team exists', async () => {
    const { App, apiMock, stopPolling } = await loadAppModule({
      storedToken: 'tok_project',
      teams: [{ team_id: 't_solo' }],
      context: { members: [{ handle: 'alice', status: 'active' }] },
    });
    const { container, unmount } = renderApp(App);

    await flushEffects(6);

    expect(container.querySelector('[data-testid="project-view"]')).not.toBeNull();
    expect(apiMock).toHaveBeenCalledWith('POST', '/teams/t_solo/join', {}, 'tok_project');
    expect(apiMock).toHaveBeenCalledWith('GET', '/teams/t_solo/context', null, 'tok_project');

    unmount();
    stopPolling();
  });

  it('shows the auth error in the connect view when boot authentication fails', async () => {
    const { App, stopPolling } = await loadAppModule({
      storedToken: 'tok_bad',
      meError: new Error('Bad token'),
    });
    const { container, unmount } = renderApp(App);

    await flushEffects();

    expect(container.querySelector('[data-testid="connect-view"]')?.textContent).toContain('Bad token');

    unmount();
    stopPolling();
  });

  it('switches between overview and settings through the sidebar controls', async () => {
    const { App, stopPolling } = await loadAppModule({
      storedToken: 'tok_settings',
      teams: [{ team_id: 't_one' }, { team_id: 't_two' }],
    });
    const { container, unmount } = renderApp(App);

    await flushEffects();

    expect(container.querySelector('[data-testid="overview-view"]')).not.toBeNull();

    await act(async () => {
      container.querySelector('[data-testid="show-settings"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });

    expect(container.querySelector('[data-testid="settings-view"]')).not.toBeNull();

    await act(async () => {
      container.querySelector('[data-testid="hide-settings"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });

    expect(container.querySelector('[data-testid="overview-view"]')).not.toBeNull();

    unmount();
    stopPolling();
  });

  it('returns to the connect view when auth state is cleared after boot', async () => {
    const { App, authActions, stopPolling } = await loadAppModule({
      storedToken: 'tok_logout',
      teams: [{ team_id: 't_one' }, { team_id: 't_two' }],
    });
    const { container, unmount } = renderApp(App);

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
