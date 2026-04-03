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

  vi.doMock('../../components/ConflictBanner/ConflictBanner.js', () => ({
    default: function MockConflictBanner({ conflicts }) {
      return <div data-testid="conflict-banner">{conflicts.length} conflicts</div>;
    },
  }));

  vi.doMock('../../components/AgentRow/AgentRow.js', () => ({
    default: function MockAgentRow({ agent }) {
      return <div data-testid="agent-row">{agent.handle}</div>;
    },
  }));

  vi.doMock('../../components/LockRow/LockRow.js', () => ({
    default: function MockLockRow({ lock }) {
      return <div data-testid="lock-row">{lock.file_path}</div>;
    },
  }));

  vi.doMock('../../components/EmptyState/EmptyState.js', () => ({
    default: function MockEmptyState({ title, hint }) {
      return (
        <div data-testid="empty-state">
          {title}::{hint}
        </div>
      );
    },
  }));

  vi.doMock('../../components/ToolIcon/ToolIcon.js', () => ({
    default: function MockToolIcon() {
      return <span data-testid="tool-icon" />;
    },
  }));

  const mod = await import('./ProjectLiveTab.js');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ProjectLiveTab empty and populated states', () => {
  it('shows the empty state when there are no agents and no aside data', async () => {
    const ProjectLiveTab = await loadProjectLiveTab();
    const { container, unmount } = renderComponent(ProjectLiveTab, {
      sortedAgents: [],
      offlineAgents: [],
      conflicts: [],
      filesInPlay: [],
      locks: [],
      liveToolMix: [],
    });

    const emptyState = container.querySelector('[data-testid="empty-state"]');
    expect(emptyState).not.toBeNull();
    expect(emptyState.textContent).toContain('No agents connected');

    unmount();
  });

  it('renders agent rows when agents are present', async () => {
    const ProjectLiveTab = await loadProjectLiveTab();
    const { container, unmount } = renderComponent(ProjectLiveTab, {
      sortedAgents: [
        { agent_id: 'a1', handle: 'alice', status: 'active', tool: 'cursor' },
        { agent_id: 'a2', handle: 'bob', status: 'offline', tool: 'claude-code' },
      ],
      offlineAgents: [{ agent_id: 'a2', handle: 'bob', status: 'offline', tool: 'claude-code' }],
      conflicts: [],
      filesInPlay: [],
      locks: [],
      liveToolMix: [],
    });

    const agentRows = container.querySelectorAll('[data-testid="agent-row"]');
    expect(agentRows).toHaveLength(2);
    expect(agentRows[0].textContent).toBe('alice');
    expect(agentRows[1].textContent).toBe('bob');

    unmount();
  });

  it('shows empty agent list but still renders aside when files or locks exist', async () => {
    const ProjectLiveTab = await loadProjectLiveTab();
    const { container, unmount } = renderComponent(ProjectLiveTab, {
      sortedAgents: [],
      offlineAgents: [],
      conflicts: [],
      filesInPlay: ['src/index.js'],
      locks: [],
      liveToolMix: [],
    });

    // Should show an empty-state for agents within the block
    const emptyStates = container.querySelectorAll('[data-testid="empty-state"]');
    expect(emptyStates.length).toBeGreaterThanOrEqual(1);
    expect(emptyStates[0].textContent).toContain('No agents connected');

    unmount();
  });
});
