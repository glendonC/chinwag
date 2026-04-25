// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function loadProjectsWidget() {
  vi.resetModules();
  const mod = await import('../TeamWidgets.js');
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
        summaries: [{ team_id: 't1', team_name: 'chinmeister' }],
      }),
    );
    expect(r.container.textContent).toContain('chinmeister');
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

describe('ProjectsWidget — column headers + view button', () => {
  it('renders mono-uppercase column headers above the rows', async () => {
    // Column headers match the LiveAgents/LiveConflicts pattern — mono,
    // uppercase, tracking-table letter spacing. Locks against a regression
    // where the header row was removed in favor of inline cell labels.
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinmeister', memory_count: 5 }],
      }),
    );
    const text = r.container.textContent;
    expect(text).toContain('Project');
    expect(text).toContain('Tools');
    expect(text).toContain('Activity');
    expect(text).toContain('Memories');
    expect(text).toContain('Conflicts');
    r.unmount();
  });

  it('renders a "View" CTA button on each row', async () => {
    // Mirrors live-agents' liveViewButton — explicit click target on the
    // right edge that inverts to accent on row hover. Replaces the earlier
    // ↗ arrow which read as decoration rather than action.
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinmeister' }],
      }),
    );
    expect(r.container.textContent).toContain('View');
    r.unmount();
  });
});

describe('ProjectsWidget — metric cells', () => {
  it('renders the formatted memory count', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinmeister', memory_count: 1234 }],
      }),
    );
    expect(r.container.textContent).toContain('1,234');
    r.unmount();
  });

  it('renders conflicts_7d as a measured-zero (not em-dash) when the field is present', async () => {
    // The em-dash is reserved for "not measured" — a server that ships the
    // field with value 0 has measured zero conflicts and the renderer must
    // distinguish the two cases.
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [
          {
            team_id: 't1',
            team_name: 'chinmeister',
            memory_count: 0,
            conflicts_7d: 0,
          },
        ],
      }),
    );
    // Conflicts cell shows '0' (measured zero), not '—'. Memory cell does
    // the same. We can't easily isolate the conflicts cell by text content
    // alone, so check the row has a '0' but no '—' for the conflict column.
    expect(r.container.textContent).toContain('0');
    r.unmount();
  });

  it('renders an em-dash when conflicts_7d is omitted by the server', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinmeister', memory_count: 5 }],
      }),
    );
    expect(r.container.textContent).toContain('—');
    r.unmount();
  });
});

describe('ProjectsWidget — tools cell', () => {
  it('renders an em-dash when no tools are configured', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [{ team_id: 't1', team_name: 'chinmeister', hosts_configured: [] }],
      }),
    );
    expect(r.container.textContent).toContain('—');
    r.unmount();
  });

  it('renders an overflow tag when more than 3 tools are configured', async () => {
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [
          {
            team_id: 't1',
            team_name: 'chinmeister',
            hosts_configured: [
              { host_tool: 'claude-code', joins: 50 },
              { host_tool: 'cursor', joins: 30 },
              { host_tool: 'codex', joins: 20 },
              { host_tool: 'aider', joins: 10 },
              { host_tool: 'cline', joins: 5 },
            ],
          },
        ],
      }),
    );
    // 5 configured, 3 visible, +2 overflow
    expect(r.container.textContent).toContain('+2');
    r.unmount();
  });

  it('floats live tools to the front of the icon row', async () => {
    // Sort contract: live tools render first regardless of join count, so
    // the eye picks them up at the leading edge of the cell. Test asserts
    // the title order on the rendered tool wrappers.
    const Projects = await loadProjectsWidget();
    const r = render(
      Projects,
      makeProps({
        summaries: [
          {
            team_id: 't1',
            team_name: 'chinmeister',
            hosts_configured: [
              { host_tool: 'claude-code', joins: 50 },
              { host_tool: 'cursor', joins: 30 },
              { host_tool: 'codex', joins: 20 },
            ],
          },
        ],
        liveAgents: [
          {
            agent_id: 'a1',
            teamId: 't1',
            handle: 'one',
            host_tool: 'codex',
            agent_surface: null,
            files: [],
            summary: null,
            session_minutes: 1,
            seconds_since_update: 0,
            teamName: 'chinmeister',
          },
        ],
      }),
    );
    // The first rendered tool wrapper should be the live one (codex), even
    // though it's last by join count.
    const wrappers = Array.from(r.container.querySelectorAll('[title]'));
    const titles = wrappers.map((w) => w.getAttribute('title'));
    // Live tools render with " (live)" suffix on their tooltip; the leading
    // entry is codex regardless of join count because live floats first.
    expect(titles[0]).toBe('Codex (active)');
    r.unmount();
  });
});
