// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderComponent(Component) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<Component />);
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

function makeProjectData(overrides = {}) {
  return {
    // Store values
    contextData: {},
    contextStatus: 'ready',
    contextTeamId: 't_test',
    pollError: null,
    lastUpdate: new Date(),
    activeTeamId: 't_test',
    teams: [{ team_id: 't_test', team_name: 'Test Project' }],

    // Derived team info
    activeTeam: { team_id: 't_test', team_name: 'Test Project' },
    hasCurrentContext: true,
    projectLabel: 'Test Project',

    // Context data extractions
    members: [],
    memories: [],
    allSessions: [],
    sessions: [],
    locks: [],
    toolsConfigured: [],
    hostsConfigured: [],
    surfacesSeen: [],
    usage: {},

    // Computed derivations
    activeAgents: [],
    offlineAgents: [],
    sortedAgents: [],
    liveToolMix: [],
    usageEntries: [],
    conflicts: [],
    filesInPlay: [],
    filesTouched: [],
    memoryBreakdown: [],
    sessionEditCount: 0,
    filesTouchedCount: 0,
    liveSessionCount: 0,
    toolSummaries: [],
    hostSummaries: [],
    surfaceSummaries: [],
    modelsSeen: [],

    // View state
    lastSynced: '5s ago',
    isLoading: false,
    isUnavailable: false,

    ...overrides,
  };
}

async function loadProjectView(projectDataOverrides = {}) {
  vi.resetModules();

  const projectData = makeProjectData(projectDataOverrides);

  vi.doMock('./useProjectData.js', () => ({
    useProjectData: () => projectData,
  }));

  vi.doMock('../../lib/stores/polling.js', () => ({
    forceRefresh: vi.fn(),
  }));

  vi.doMock('../../lib/stores/teams.js', () => ({
    teamActions: {
      updateMemory: vi.fn(),
      deleteMemory: vi.fn(),
    },
  }));

  vi.doMock('../../lib/useTabKeyboard.js', () => ({
    useTabKeyboard: () => { return { current: null }; },
  }));

  vi.doMock('../../components/ActivityTimeline/ActivityTimeline.jsx', () => ({
    default: function MockActivityTimeline() {
      return <div data-testid="activity-timeline" />;
    },
  }));

  vi.doMock('../../components/StatusState/StatusState.jsx', () => ({
    default: function MockStatusState({ title, detail }) {
      return <div data-testid="status-state">{title}{detail && ` | ${detail}`}</div>;
    },
  }));

  vi.doMock('../../components/ViewHeader/ViewHeader.jsx', () => ({
    default: function MockViewHeader({ title }) {
      return <div data-testid="view-header">{title}</div>;
    },
  }));

  vi.doMock('../../components/KeyboardHint/KeyboardHint.jsx', () => ({
    default: function MockKeyboardHint() { return null; },
    useKeyboardHint: () => ({ open: false, onOpen: vi.fn(), onDismiss: vi.fn() }),
  }));

  vi.doMock('./ProjectLiveTab.jsx', () => ({
    default: function MockLiveTab() {
      return <div data-testid="live-tab">live-tab</div>;
    },
  }));

  vi.doMock('./ProjectMemoryTab.jsx', () => ({
    default: function MockMemoryTab() {
      return <div data-testid="memory-tab">memory-tab</div>;
    },
  }));

  vi.doMock('./ProjectSessionsTab.jsx', () => ({
    default: function MockSessionsTab() {
      return <div data-testid="sessions-tab">sessions-tab</div>;
    },
  }));

  vi.doMock('./ProjectToolsTab.jsx', () => ({
    default: function MockToolsTab() {
      return <div data-testid="tools-tab">tools-tab</div>;
    },
  }));

  const mod = await import('./ProjectView.jsx');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ProjectView states', () => {
  it('shows loading skeleton when isLoading is true', async () => {
    const ProjectView = await loadProjectView({
      isLoading: true,
      projectLabel: 'chinwag',
    });
    const { container, unmount } = renderComponent(ProjectView);

    expect(container.textContent).toContain('Loading chinwag');
    expect(container.querySelector('[data-testid="view-header"]')).toBeNull();
    expect(container.querySelector('[data-testid="status-state"]')).toBeNull();

    unmount();
  });

  it('shows unavailable state when isUnavailable is true', async () => {
    const ProjectView = await loadProjectView({
      isUnavailable: true,
      projectLabel: 'chinwag',
      pollError: 'Internal server error',
    });
    const { container, unmount } = renderComponent(ProjectView);

    expect(container.querySelector('[data-testid="status-state"]')?.textContent).toContain('Could not load chinwag');
    expect(container.querySelector('[data-testid="status-state"]')?.textContent).toContain('Internal server error');
    expect(container.querySelector('[data-testid="view-header"]')).toBeNull();

    unmount();
  });

  it('renders the main view with header and stats when data is loaded', async () => {
    const ProjectView = await loadProjectView({
      activeAgents: [{ handle: 'alice', status: 'active' }],
      memories: [{ id: 'm1', text: 'test', tags: [] }],
      toolSummaries: [{ tool: 'claude-code' }],
    });
    const { container, unmount } = renderComponent(ProjectView);

    expect(container.querySelector('[data-testid="view-header"]')?.textContent).toBe('Test Project');

    // Stats should be rendered
    const tabButtons = container.querySelectorAll('[role="tab"]');
    expect(tabButtons.length).toBe(4);

    const labels = [...tabButtons].map((b) => b.textContent);
    expect(labels.some((l) => l.includes('Agents'))).toBe(true);
    expect(labels.some((l) => l.includes('Memory'))).toBe(true);
    expect(labels.some((l) => l.includes('Edits'))).toBe(true);
    expect(labels.some((l) => l.includes('Tools'))).toBe(true);

    unmount();
  });

  it('defaults to the live tab', async () => {
    const ProjectView = await loadProjectView();
    const { container, unmount } = renderComponent(ProjectView);

    expect(container.querySelector('[data-testid="live-tab"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="memory-tab"]')).toBeNull();

    unmount();
  });

  it('switches to memory tab when Memory stat is clicked', async () => {
    const ProjectView = await loadProjectView();
    const { container, unmount } = renderComponent(ProjectView);

    const memoryTab = container.querySelector('[data-tab="memory"]');
    act(() => {
      memoryTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="memory-tab"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="live-tab"]')).toBeNull();

    unmount();
  });

  it('switches to sessions tab when Edits stat is clicked', async () => {
    const ProjectView = await loadProjectView();
    const { container, unmount } = renderComponent(ProjectView);

    const sessionsTab = container.querySelector('[data-tab="sessions"]');
    act(() => {
      sessionsTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="sessions-tab"]')).not.toBeNull();

    unmount();
  });

  it('switches to tools tab when Tools stat is clicked', async () => {
    const ProjectView = await loadProjectView();
    const { container, unmount } = renderComponent(ProjectView);

    const toolsTab = container.querySelector('[data-tab="tools"]');
    act(() => {
      toolsTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="tools-tab"]')).not.toBeNull();

    unmount();
  });

  it('shows conflict banner when conflicts exist', async () => {
    const ProjectView = await loadProjectView({
      conflicts: [
        { file: 'a.js', owners: ['alice', 'bob'] },
        { file: 'b.js', owners: ['carol', 'dave'] },
      ],
    });
    const { container, unmount } = renderComponent(ProjectView);

    expect(container.textContent).toContain('2 files with overlapping edits');

    unmount();
  });

  it('hides conflict banner when no conflicts', async () => {
    const ProjectView = await loadProjectView({ conflicts: [] });
    const { container, unmount } = renderComponent(ProjectView);

    expect(container.textContent).not.toContain('overlapping edits');

    unmount();
  });

  it('renders activity timeline', async () => {
    const ProjectView = await loadProjectView();
    const { container, unmount } = renderComponent(ProjectView);

    expect(container.querySelector('[data-testid="activity-timeline"]')).not.toBeNull();

    unmount();
  });

  it('shows stat values correctly', async () => {
    const ProjectView = await loadProjectView({
      activeAgents: [{ handle: 'a' }, { handle: 'b' }],
      memories: [{ id: '1' }, { id: '2' }, { id: '3' }],
      sessionEditCount: 42,
      toolSummaries: [{ tool: 'cc' }, { tool: 'cursor' }],
    });
    const { container, unmount } = renderComponent(ProjectView);

    const tabButtons = container.querySelectorAll('[role="tab"]');
    const tabTexts = [...tabButtons].map((b) => b.textContent);

    // Check agent count
    expect(tabTexts.some((t) => t.includes('2'))).toBe(true);
    // Check memory count
    expect(tabTexts.some((t) => t.includes('3'))).toBe(true);
    // Check edit count
    expect(tabTexts.some((t) => t.includes('42'))).toBe(true);
    // Check tools count
    expect(tabTexts.some((t) => t.includes('2'))).toBe(true);

    unmount();
  });

  it('uses singular "file" for single conflict', async () => {
    const ProjectView = await loadProjectView({
      conflicts: [{ file: 'a.js', owners: ['alice', 'bob'] }],
    });
    const { container, unmount } = renderComponent(ProjectView);

    expect(container.textContent).toContain('1 file with overlapping edits');

    unmount();
  });
});
