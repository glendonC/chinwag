// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function loadProjectsWidget() {
  vi.resetModules();
  const mod = await import('./TeamWidgets.js');
  return mod.teamWidgets.projects;
}

function makeProps({ summaries = [], liveAgents = [] } = {}) {
  return {
    analytics: {},
    conversationData: { sessions: [] },
    summaries,
    liveAgents,
    locks: [],
    selectTeam: () => {},
  };
}

function render(Component, props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Component {...props} />);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ProjectsWidget — empty state', () => {
  it('renders "No projects" when summaries is empty', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(Projects, makeProps());
    expect(r.container.textContent).toContain('No projects');
    expect(r.container.querySelector('button')).toBeNull();
    r.unmount();
  });
});

describe('ProjectsWidget — team name binding', () => {
  it('renders team_name when present', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinwag' }],
      }),
    );
    expect(r.container.textContent).toContain('chinwag');
    r.unmount();
  });

  it('falls back to team_id when team_name is missing', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 'raw-id-abc' }],
      }),
    );
    expect(r.container.textContent).toContain('raw-id-abc');
    r.unmount();
  });
});

describe('ProjectsWidget — meta stat bindings', () => {
  it('shows "N sessions (24h)" when recent_sessions_24h > 0', async () => {
    // Locks the label fix: label must match the rolling-24h SQL semantics,
    // not the earlier misleading "sessions today" copy.
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinwag', recent_sessions_24h: 7 }],
      }),
    );
    expect(r.container.textContent).toContain('7 sessions (24h)');
    expect(r.container.textContent).not.toContain('sessions today');
    r.unmount();
  });

  it('omits session stat when recent_sessions_24h is 0', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinwag', recent_sessions_24h: 0 }],
      }),
    );
    expect(r.container.textContent).not.toContain('sessions');
    r.unmount();
  });

  it('omits session stat when recent_sessions_24h is undefined (server omitted)', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinwag' }],
      }),
    );
    expect(r.container.textContent).not.toContain('sessions');
    r.unmount();
  });

  it('shows conflict count when conflict_count > 0', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinwag', conflict_count: 1 }],
      }),
    );
    expect(r.container.textContent).toContain('1 conflict');
    r.unmount();
  });

  it('pluralizes conflict count correctly', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinwag', conflict_count: 3 }],
      }),
    );
    expect(r.container.textContent).toContain('3 conflicts');
    r.unmount();
  });

  it('shows memory count when memory_count > 0', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinwag', memory_count: 42 }],
      }),
    );
    expect(r.container.textContent).toContain('42 memories');
    r.unmount();
  });
});

describe('ProjectsWidget — liveCount derivation', () => {
  // Current behavior: liveCount is derived from liveAgents filtered by teamId.
  // PR2 will switch this to bind `active_agents` from the summary directly —
  // update these assertions at that time.
  it('counts liveAgents matching this teamId', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinwag' }],
        liveAgents: [
          { agent_id: 'a1', teamId: 't1', handle: 'one', host_tool: 'claude-code' },
          { agent_id: 'a2', teamId: 't1', handle: 'two', host_tool: 'claude-code' },
          { agent_id: 'a3', teamId: 't2', handle: 'three', host_tool: 'claude-code' },
        ],
      }),
    );
    expect(r.container.textContent).toContain('2 live');
    r.unmount();
  });

  it('omits live row when no agents match this teamId', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinwag' }],
        liveAgents: [
          { agent_id: 'a1', teamId: 't-other', handle: 'elsewhere', host_tool: 'claude-code' },
        ],
      }),
    );
    expect(r.container.textContent).not.toContain('live');
    r.unmount();
  });
});
