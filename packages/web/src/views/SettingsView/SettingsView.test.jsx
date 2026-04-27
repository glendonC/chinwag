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

let apiMock;
let mockAuthState;
let mockStopPolling;
let mockLogout;
let mockUpdateUser;
let mockTheme;
let mockSetTheme;

async function loadSettingsView({
  user = { handle: 'alice', color: 'cyan', github_login: null, avatar_url: null },
  token = 'tok_test',
  theme = 'system',
  apiOverride = null,
} = {}) {
  vi.resetModules();

  apiMock = apiOverride || vi.fn().mockResolvedValue({ ok: true });
  mockAuthState = { token, user };
  mockStopPolling = vi.fn();
  mockLogout = vi.fn();
  mockUpdateUser = vi.fn();
  mockTheme = theme;
  mockSetTheme = vi.fn();

  vi.doMock('../../lib/stores/auth.js', () => ({
    useAuthStore: (selector) => selector(mockAuthState),
    authActions: {
      logout: mockLogout,
      updateUser: mockUpdateUser,
    },
  }));

  vi.doMock('../../lib/stores/polling.js', () => ({
    stopPolling: mockStopPolling,
  }));

  vi.doMock('../../lib/api.js', () => ({
    api: apiMock,
  }));

  vi.doMock('../../lib/useTheme.js', () => ({
    useTheme: () => ({
      theme: mockTheme,
      resolved: mockTheme === 'system' ? 'dark' : mockTheme,
      setTheme: mockSetTheme,
    }),
  }));

  vi.doMock('../../components/ViewHeader/ViewHeader.js', () => ({
    default: function MockViewHeader({ title }) {
      return <div data-testid="view-header">{title}</div>;
    },
  }));

  const mod = await import('./SettingsView.js');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('SettingsView', () => {
  it('renders the settings header', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    expect(container.querySelector('[data-testid="view-header"]')?.textContent).toBe('Settings');

    unmount();
  });

  it('displays the user handle', async () => {
    const SettingsView = await loadSettingsView({ user: { handle: 'bob', color: 'red' } });
    const { container, unmount } = renderComponent(SettingsView, {});

    expect(container.textContent).toContain('bob');

    unmount();
  });

  it('shows "Unknown user" when user has no handle', async () => {
    const SettingsView = await loadSettingsView({ user: { handle: null, color: 'white' } });
    const { container, unmount } = renderComponent(SettingsView, {});

    expect(container.textContent).toContain('Unknown user');

    unmount();
  });

  it('shows Edit button that opens handle editor', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    const editBtn = container.querySelector('[aria-label="Edit handle"]');
    expect(editBtn).not.toBeNull();

    await act(async () => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Should now show input and Save/Cancel buttons
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    expect(input.value).toBe('alice');
    expect(container.textContent).toContain('Save');
    expect(container.textContent).toContain('Cancel');

    unmount();
  });

  it('validates handle and shows error for invalid input', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    // Open editor
    const editBtn = container.querySelector('[aria-label="Edit handle"]');
    await act(async () => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Change to invalid handle (too short)
    const input = container.querySelector('input');
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    await act(async () => {
      nativeInputValueSetter.call(input, 'ab');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Click Save
    const saveBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Save'),
    );
    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(container.textContent).toContain('3-20 characters');
    expect(apiMock).not.toHaveBeenCalled();

    unmount();
  });

  it('validates handle with special characters', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    const editBtn = container.querySelector('[aria-label="Edit handle"]');
    await act(async () => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = container.querySelector('input');
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    await act(async () => {
      nativeInputValueSetter.call(input, 'bad@handle');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Save'),
    );
    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(container.textContent).toContain('letters, numbers, and underscores');

    unmount();
  });

  it('calls API and updates user on valid handle save', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    const editBtn = container.querySelector('[aria-label="Edit handle"]');
    await act(async () => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = container.querySelector('input');
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    await act(async () => {
      nativeInputValueSetter.call(input, 'new_handle');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Save'),
    );
    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(apiMock).toHaveBeenCalledWith('PUT', '/me/handle', { handle: 'new_handle' }, 'tok_test');
    expect(mockUpdateUser).toHaveBeenCalledWith({ handle: 'new_handle' });

    unmount();
  });

  it('shows error when handle save API fails', async () => {
    const SettingsView = await loadSettingsView({
      apiOverride: vi.fn().mockRejectedValue(new Error('Handle taken')),
    });
    const { container, unmount } = renderComponent(SettingsView, {});

    const editBtn = container.querySelector('[aria-label="Edit handle"]');
    await act(async () => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = container.querySelector('input');
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    await act(async () => {
      nativeInputValueSetter.call(input, 'new_handle');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Save'),
    );
    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(container.textContent).toContain('Handle taken');

    unmount();
  });

  it('closes editor on Cancel click', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    const editBtn = container.querySelector('[aria-label="Edit handle"]');
    await act(async () => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('input')).not.toBeNull();

    const cancelBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Cancel'),
    );
    await act(async () => {
      cancelBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Should be back to view mode
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('[aria-label="Edit handle"]')).not.toBeNull();

    unmount();
  });

  it('renders color palette buttons', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    // 12 color dots in the palette
    const colorButtons = container.querySelectorAll('[aria-label^="Select "]');
    expect(colorButtons.length).toBe(12);

    unmount();
  });

  it('calls API on color selection', async () => {
    const SettingsView = await loadSettingsView({ user: { handle: 'alice', color: 'cyan' } });
    const { container, unmount } = renderComponent(SettingsView, {});

    const redButton = container.querySelector('[aria-label="Select red"]');
    await act(async () => {
      redButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(apiMock).toHaveBeenCalledWith('PUT', '/me/color', { color: 'red' }, 'tok_test');
    expect(mockUpdateUser).toHaveBeenCalledWith({ color: 'red' });

    unmount();
  });

  it('does not call API when selecting the current color', async () => {
    const SettingsView = await loadSettingsView({ user: { handle: 'alice', color: 'cyan' } });
    const { container, unmount } = renderComponent(SettingsView, {});

    const cyanButton = container.querySelector('[aria-label="Select cyan"]');
    await act(async () => {
      cyanButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(apiMock).not.toHaveBeenCalled();

    unmount();
  });

  it('renders theme toggle with System, Light, Dark options', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    expect(container.textContent).toContain('System');
    expect(container.textContent).toContain('Light');
    expect(container.textContent).toContain('Dark');

    unmount();
  });

  it('calls setTheme when a theme option is clicked', async () => {
    const SettingsView = await loadSettingsView({ theme: 'system' });
    const { container, unmount } = renderComponent(SettingsView, {});

    const darkBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Dark',
    );
    await act(async () => {
      darkBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockSetTheme).toHaveBeenCalledWith('dark');

    unmount();
  });

  it('shows GitHub connect button when not linked', async () => {
    const SettingsView = await loadSettingsView({
      user: { handle: 'alice', color: 'cyan', github_login: null },
    });
    const { container, unmount } = renderComponent(SettingsView, {});

    expect(container.textContent).toContain('Connect GitHub');

    unmount();
  });

  it('shows GitHub connected state with login name and disconnect button', async () => {
    const SettingsView = await loadSettingsView({
      user: {
        handle: 'alice',
        color: 'cyan',
        github_login: 'alice-gh',
        avatar_url: 'https://example.com/avatar.png',
      },
    });
    const { container, unmount } = renderComponent(SettingsView, {});

    // Connected state is signaled by the @login + Disconnect button pair,
    // not a literal "Connected" word; the latter was removed as redundant.
    expect(container.textContent).toContain('@alice-gh');
    expect(container.textContent).toContain('Disconnect');
    expect(container.textContent).not.toContain('Connect GitHub');

    unmount();
  });

  it('calls logout and stops polling when sign out is clicked', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    const signOutBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Sign out'),
    );
    await act(async () => {
      signOutBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockStopPolling).toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalled();

    unmount();
  });
});
