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
    rerender(newProps) {
      act(() => {
        root.render(<Component {...newProps} />);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

let mockTeams = [];
let mockActiveTeamId = null;
let mockNavigate = vi.fn();

async function loadSidebar({ teams = [], activeTeamId = null } = {}) {
  vi.resetModules();

  mockTeams = teams;
  mockActiveTeamId = activeTeamId;
  mockNavigate = vi.fn();

  vi.doMock('../../lib/stores/teams.js', () => ({
    useTeamStore: (selector) =>
      selector({
        teams: mockTeams,
        activeTeamId: mockActiveTeamId,
      }),
  }));

  vi.doMock('../../lib/router.js', () => ({
    navigate: (...args) => mockNavigate(...args),
  }));

  vi.doMock('../../lib/projectGradient.js', () => ({
    projectGradient: (id) => `gradient-${id}`,
  }));

  const mod = await import('./Sidebar.jsx');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Sidebar', () => {
  it('renders overview, tools, and settings nav items', async () => {
    const Sidebar = await loadSidebar();
    const { container, unmount } = renderComponent(Sidebar, { activeView: 'overview' });

    const buttons = container.querySelectorAll('button');
    const labels = [...buttons].map((b) => b.textContent.trim());

    expect(labels).toContain('Overview');
    expect(labels).toContain('Tools');
    expect(labels).toContain('Settings');

    unmount();
  });

  it('navigates to overview when overview is clicked', async () => {
    const Sidebar = await loadSidebar();
    const { container, unmount } = renderComponent(Sidebar, { activeView: 'settings' });

    const overviewBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Overview',
    );
    act(() => {
      overviewBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockNavigate).toHaveBeenCalledWith('overview');

    unmount();
  });

  it('navigates to tools when tools is clicked', async () => {
    const Sidebar = await loadSidebar();
    const { container, unmount } = renderComponent(Sidebar, { activeView: 'overview' });

    const toolsBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Tools',
    );
    act(() => {
      toolsBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockNavigate).toHaveBeenCalledWith('tools');

    unmount();
  });

  it('navigates to settings when settings is clicked', async () => {
    const Sidebar = await loadSidebar();
    const { container, unmount } = renderComponent(Sidebar, { activeView: 'overview' });

    const settingsBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Settings',
    );
    act(() => {
      settingsBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockNavigate).toHaveBeenCalledWith('settings');

    unmount();
  });

  it('renders team list when teams exist', async () => {
    const Sidebar = await loadSidebar({
      teams: [
        { team_id: 't_1', team_name: 'Project Alpha' },
        { team_id: 't_2', team_name: 'Project Beta' },
      ],
    });
    const { container, unmount } = renderComponent(Sidebar, { activeView: 'overview' });

    const text = container.textContent;
    expect(text).toContain('Project Alpha');
    expect(text).toContain('Project Beta');

    unmount();
  });

  it('shows empty message when no teams exist', async () => {
    const Sidebar = await loadSidebar({ teams: [] });
    const { container, unmount } = renderComponent(Sidebar, { activeView: 'overview' });

    expect(container.textContent).toContain('No projects yet');

    unmount();
  });

  it('navigates to project when project button is clicked', async () => {
    const Sidebar = await loadSidebar({
      teams: [{ team_id: 't_abc', team_name: 'My Project' }],
    });
    const { container, unmount } = renderComponent(Sidebar, { activeView: 'overview' });

    const projectBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('My Project'),
    );
    act(() => {
      projectBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockNavigate).toHaveBeenCalledWith('project', 't_abc');

    unmount();
  });

  it('renders mobile toggle button', async () => {
    const Sidebar = await loadSidebar();
    const { container, unmount } = renderComponent(Sidebar, { activeView: 'overview' });

    const toggleBtn = container.querySelector('[aria-label="Toggle sidebar"]');
    expect(toggleBtn).not.toBeNull();

    unmount();
  });

  it('toggles mobile sidebar open/closed', async () => {
    const Sidebar = await loadSidebar();
    const { container, unmount } = renderComponent(Sidebar, { activeView: 'overview' });

    const toggleBtn = container.querySelector('[aria-label="Toggle sidebar"]');

    // Open
    act(() => {
      toggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Backdrop should appear when mobile is open
    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();

    // Close by clicking backdrop
    act(() => {
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Backdrop should be gone
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();

    unmount();
  });

  it('marks overview as active when activeView is "overview"', async () => {
    const Sidebar = await loadSidebar({ activeTeamId: null });
    const { container, unmount } = renderComponent(Sidebar, { activeView: 'overview' });

    const overviewBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Overview',
    );
    expect(overviewBtn.getAttribute('aria-current')).toBe('page');

    unmount();
  });

  it('marks settings as active when activeView is "settings"', async () => {
    const Sidebar = await loadSidebar();
    const { container, unmount } = renderComponent(Sidebar, { activeView: 'settings' });

    const settingsBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Settings',
    );
    expect(settingsBtn.getAttribute('aria-current')).toBe('page');

    unmount();
  });
});
