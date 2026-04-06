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

async function loadAgentsPanel() {
  vi.resetModules();

  vi.doMock('../../components/ToolIcon/ToolIcon.js', () => ({
    default: function MockToolIcon({ tool }) {
      return <span data-testid="tool-icon">{tool}</span>;
    },
  }));

  const mod = await import('./AgentsPanel.js');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('AgentsPanel', () => {
  it('shows empty message when no live agents exist', async () => {
    const AgentsPanel = await loadAgentsPanel();
    const { container, unmount } = renderComponent(AgentsPanel, {
      liveAgents: [],
      selectTeam: () => {},
    });

    expect(container.textContent).toContain('No agents running');
    unmount();
  });

  it('renders column headers', async () => {
    const AgentsPanel = await loadAgentsPanel();
    const { container, unmount } = renderComponent(AgentsPanel, {
      liveAgents: [
        {
          agent_id: 'cursor:abc',
          handle: 'alice',
          host_tool: 'cursor',
          agent_surface: null,
          files: [],
          summary: null,
          session_minutes: 5,
          teamName: 'Alpha',
          teamId: 't_1',
        },
      ],
      selectTeam: () => {},
    });

    expect(container.textContent).toContain('Agent');
    expect(container.textContent).toContain('Owner');
    expect(container.textContent).toContain('Activity');
    expect(container.textContent).toContain('Session');
    unmount();
  });

  it('shows tool name, owner handle, and activity', async () => {
    const AgentsPanel = await loadAgentsPanel();
    const { container, unmount } = renderComponent(AgentsPanel, {
      liveAgents: [
        {
          agent_id: 'cursor:abc',
          handle: 'alice',
          host_tool: 'cursor',
          agent_surface: null,
          files: ['src/auth.ts'],
          summary: null,
          session_minutes: 15,
          teamName: 'Alpha',
          teamId: 't_1',
        },
      ],
      selectTeam: () => {},
    });

    expect(container.textContent).toContain('Cursor');
    expect(container.textContent).toContain('alice');
    expect(container.textContent).toContain('auth.ts');
    unmount();
  });

  it('extracts tool from agent_id prefix when host_tool is unknown', async () => {
    const AgentsPanel = await loadAgentsPanel();
    const { container, unmount } = renderComponent(AgentsPanel, {
      liveAgents: [
        {
          agent_id: 'claude-code:abc123',
          handle: 'bob',
          host_tool: 'unknown',
          agent_surface: null,
          files: [],
          summary: 'refactoring API',
          session_minutes: 42,
          teamName: 'chinwag',
          teamId: 't_2',
        },
      ],
      selectTeam: () => {},
    });

    expect(container.textContent).toContain('Claude Code');
    expect(container.textContent).toContain('bob');
    expect(container.textContent).toContain('refactoring API');
    unmount();
  });

  it('shows idle when no activity', async () => {
    const AgentsPanel = await loadAgentsPanel();
    const { container, unmount } = renderComponent(AgentsPanel, {
      liveAgents: [
        {
          agent_id: 'cursor:xyz',
          handle: 'carol',
          host_tool: 'cursor',
          agent_surface: null,
          files: [],
          summary: null,
          session_minutes: null,
          teamName: 'Alpha',
          teamId: 't_1',
        },
      ],
      selectTeam: () => {},
    });

    expect(container.textContent).toContain('idle');
    unmount();
  });
});
