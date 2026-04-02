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

async function loadProjectLiveTab() {
  vi.resetModules();

  vi.doMock('../../components/ConflictBanner/ConflictBanner.jsx', () => ({
    default: function MockConflictBanner({ conflicts }) {
      return <div data-testid="conflict-banner">{conflicts.length} conflicts</div>;
    },
  }));

  vi.doMock('../../components/AgentRow/AgentRow.jsx', () => ({
    default: function MockAgentRow({ agent }) {
      return <div data-testid={`agent-${agent.handle}`}>{agent.handle} ({agent.status})</div>;
    },
  }));

  vi.doMock('../../components/LockRow/LockRow.jsx', () => ({
    default: function MockLockRow({ lock }) {
      return <div data-testid="lock-row">{lock.file_path}</div>;
    },
  }));

  vi.doMock('../../components/EmptyState/EmptyState.jsx', () => ({
    default: function MockEmptyState({ title }) {
      return <div data-testid="empty-state">{title}</div>;
    },
  }));

  vi.doMock('../../components/ToolIcon/ToolIcon.jsx', () => ({
    default: function MockToolIcon({ tool }) {
      return <span data-testid="tool-icon">{tool}</span>;
    },
  }));

  vi.doMock('../../lib/toolAnalytics.js', () => ({
    formatShare: (share) => `${Math.round((share || 0) * 100)}%`,
  }));

  vi.doMock('../../lib/toolMeta.js', () => ({
    getToolMeta: (tool) => ({
      label: tool || 'Unknown',
      color: '#ccc',
    }),
  }));

  const mod = await import('./ProjectLiveTab.jsx');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ProjectLiveTab', () => {
  it('shows empty state when no agents and no aside data', async () => {
    const Tab = await loadProjectLiveTab();
    const { container, unmount } = renderComponent(Tab, {
      sortedAgents: [],
      offlineAgents: [],
      conflicts: [],
      filesInPlay: [],
      locks: [],
      liveToolMix: [],
    });

    expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
    expect(container.textContent).toContain('No agents connected');
    unmount();
  });

  it('renders agent rows', async () => {
    const Tab = await loadProjectLiveTab();
    const agents = [
      { agent_id: 'a1', handle: 'alice', status: 'active', tool: 'claude-code' },
      { agent_id: 'a2', handle: 'bob', status: 'offline', tool: 'cursor' },
    ];
    const { container, unmount } = renderComponent(Tab, {
      sortedAgents: agents,
      offlineAgents: [agents[1]],
      conflicts: [],
      filesInPlay: [],
      locks: [],
      liveToolMix: [],
    });

    expect(container.querySelector('[data-testid="agent-alice"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-bob"]')).not.toBeNull();
    expect(container.textContent).toContain('alice');
    expect(container.textContent).toContain('bob');
    unmount();
  });

  it('shows offline count', async () => {
    const Tab = await loadProjectLiveTab();
    const { container, unmount } = renderComponent(Tab, {
      sortedAgents: [
        { agent_id: 'a1', handle: 'alice', status: 'active', tool: 'claude-code' },
        { agent_id: 'a2', handle: 'bob', status: 'offline', tool: 'cursor' },
      ],
      offlineAgents: [{ agent_id: 'a2', handle: 'bob', status: 'offline' }],
      conflicts: [],
      filesInPlay: [],
      locks: [],
      liveToolMix: [],
    });

    expect(container.textContent).toContain('1 offline');
    unmount();
  });

  it('shows conflict banner when conflicts exist', async () => {
    const Tab = await loadProjectLiveTab();
    const { container, unmount } = renderComponent(Tab, {
      sortedAgents: [{ agent_id: 'a1', handle: 'alice', status: 'active', tool: 'cc' }],
      offlineAgents: [],
      conflicts: [
        { file: 'a.js', owners: ['alice', 'bob'] },
      ],
      filesInPlay: ['a.js'],
      locks: [],
      liveToolMix: [],
    });

    expect(container.querySelector('[data-testid="conflict-banner"]')).not.toBeNull();
    expect(container.textContent).toContain('1 conflicts');
    unmount();
  });

  it('renders files in play', async () => {
    const Tab = await loadProjectLiveTab();
    const { container, unmount } = renderComponent(Tab, {
      sortedAgents: [{ agent_id: 'a1', handle: 'alice', status: 'active', tool: 'cc' }],
      offlineAgents: [],
      conflicts: [],
      filesInPlay: ['src/app.js', 'src/utils.js'],
      locks: [],
      liveToolMix: [],
    });

    expect(container.textContent).toContain('src/app.js');
    expect(container.textContent).toContain('src/utils.js');
    expect(container.textContent).toContain('2 files');
    unmount();
  });

  it('renders lock rows', async () => {
    const Tab = await loadProjectLiveTab();
    const { container, unmount } = renderComponent(Tab, {
      sortedAgents: [{ agent_id: 'a1', handle: 'alice', status: 'active', tool: 'cc' }],
      offlineAgents: [],
      conflicts: [],
      filesInPlay: ['config.json'],
      locks: [{ file_path: 'config.json', owner_handle: 'alice' }],
      liveToolMix: [],
    });

    expect(container.querySelector('[data-testid="lock-row"]')).not.toBeNull();
    expect(container.textContent).toContain('config.json');
    unmount();
  });

  it('renders live tool mix section', async () => {
    const Tab = await loadProjectLiveTab();
    const { container, unmount } = renderComponent(Tab, {
      sortedAgents: [{ agent_id: 'a1', handle: 'alice', status: 'active', tool: 'claude-code' }],
      offlineAgents: [],
      conflicts: [],
      filesInPlay: [],
      locks: [],
      liveToolMix: [
        { tool: 'claude-code', label: 'Claude Code', value: 2, share: 0.67 },
        { tool: 'cursor', label: 'Cursor', value: 1, share: 0.33 },
      ],
    });

    expect(container.textContent).toContain('Live tools');
    expect(container.textContent).toContain('2 live');
    expect(container.textContent).toContain('1 live');
    unmount();
  });

  it('shows aside only when files, locks, conflicts, or tool mix exist', async () => {
    const Tab = await loadProjectLiveTab();

    // With agents but no aside content - still renders agents section
    const { container, unmount } = renderComponent(Tab, {
      sortedAgents: [{ agent_id: 'a1', handle: 'alice', status: 'active', tool: 'cc' }],
      offlineAgents: [],
      conflicts: [],
      filesInPlay: [],
      locks: [],
      liveToolMix: [],
    });

    expect(container.querySelector('[data-testid="agent-alice"]')).not.toBeNull();
    // "Work in play" heading should not appear without files
    expect(container.textContent).not.toContain('Work in play');
    unmount();
  });
});
