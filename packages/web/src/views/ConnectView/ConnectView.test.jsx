// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderComponent(Component, props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<Component {...props} />);
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

async function flushEffects(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function loadConnectView({
  authenticateMock = vi.fn(),
  loadTeamsMock = vi.fn(),
  hash = '',
  runtimeTargets = {
    profile: 'prod',
    apiUrl: 'https://test.chinmeister.com',
    dashboardUrl: 'https://chinmeister.com/dashboard',
    dashboardOrigin: 'https://chinmeister.com',
    dashboardPath: '/dashboard',
    chatWsUrl: 'wss://test.chinmeister.com/ws/chat',
    teamWsOrigin: 'wss://test.chinmeister.com',
  },
} = {}) {
  vi.resetModules();

  window.location.hash = hash;

  vi.doMock('../../lib/stores/auth.js', () => ({
    authActions: {
      authenticate: authenticateMock,
    },
  }));

  vi.doMock('../../lib/stores/teams.js', () => ({
    teamActions: {
      loadTeams: loadTeamsMock,
    },
  }));

  vi.doMock('../../lib/api.js', () => ({
    getApiUrl: () => runtimeTargets.apiUrl,
    getRuntimeTargets: () => runtimeTargets,
  }));

  const mod = await import('./ConnectView.js');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
  document.body.innerHTML = '';
});

describe('ConnectView', () => {
  it('renders the connect screen with sign-in and token input', async () => {
    const ConnectView = await loadConnectView();
    const { container, unmount } = renderComponent(ConnectView, {});

    expect(container.textContent).toContain('Open your dashboard');
    expect(container.textContent).toContain('Sign in with GitHub');
    expect(container.textContent).toContain('Production profile');
    expect(container.querySelector('input[type="password"]')).not.toBeNull();

    unmount();
  });

  it('displays the boot error passed as a prop', async () => {
    const ConnectView = await loadConnectView();
    const { container, unmount } = renderComponent(ConnectView, {
      error: 'Unauthorized',
    });

    await flushEffects();

    // Should show a friendly error based on the "unauthorized" keyword
    expect(container.textContent).toContain('invalid or expired');

    unmount();
  });

  it('disables the connect button when token input is empty', async () => {
    const authenticateMock = vi.fn();
    const ConnectView = await loadConnectView({ authenticateMock });
    const { container, unmount } = renderComponent(ConnectView, {});

    const connectButton = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Connect'),
    );

    expect(connectButton?.disabled).toBe(true);
    expect(authenticateMock).not.toHaveBeenCalled();

    unmount();
  });

  it('calls authenticate and loadTeams on valid token submission', async () => {
    const authenticateMock = vi.fn().mockResolvedValue(true);
    const loadTeamsMock = vi.fn().mockResolvedValue(undefined);
    const ConnectView = await loadConnectView({ authenticateMock, loadTeamsMock });
    const { container, unmount } = renderComponent(ConnectView, {});

    const input = container.querySelector('input[type="password"]');
    const connectButton = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Connect'),
    );

    await act(async () => {
      // Simulate typing a token
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      nativeInputValueSetter.call(input, 'tok_valid');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(authenticateMock).toHaveBeenCalledWith('tok_valid');
    expect(loadTeamsMock).toHaveBeenCalled();

    unmount();
  });

  it('shows a friendly error when authentication fails', async () => {
    const authenticateMock = vi.fn().mockRejectedValue(new Error('HTTP 500 (server error)'));
    const ConnectView = await loadConnectView({ authenticateMock });
    const { container, unmount } = renderComponent(ConnectView, {});

    const input = container.querySelector('input[type="password"]');
    const connectButton = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Connect'),
    );

    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      nativeInputValueSetter.call(input, 'tok_bad');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(container.textContent).toContain('Something went wrong on our end');

    unmount();
  });

  it('displays GitHub OAuth error from URL hash', async () => {
    const ConnectView = await loadConnectView({
      hash: '#error=github_denied',
    });
    const { container, unmount } = renderComponent(ConnectView, {});

    await flushEffects();

    expect(container.textContent).toContain('GitHub sign-in was cancelled');

    unmount();
  });

  it('shows local-profile commands and guidance when targeting local dev', async () => {
    const ConnectView = await loadConnectView({
      runtimeTargets: {
        profile: 'local',
        apiUrl: 'http://localhost:8787',
        dashboardUrl: 'http://localhost:56790/dashboard.html',
        dashboardOrigin: 'http://localhost:56790',
        dashboardPath: '/dashboard.html',
        chatWsUrl: 'ws://localhost:8787/ws/chat',
        teamWsOrigin: 'ws://localhost:8787',
      },
    });
    const { container, unmount } = renderComponent(ConnectView, {});

    expect(container.textContent).toContain('Local profile');
    expect(container.textContent).toContain('CHINMEISTER_PROFILE=local npx chinmeister dashboard');
    expect(container.textContent).toContain('CHINMEISTER_PROFILE=local npx chinmeister token');

    unmount();
  });
});
