// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { shallow } from 'zustand/vanilla/shallow';
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

async function loadProjectView({ pollingState, teamState } = {}) {
  vi.resetModules();

  // Pin zustand/react/shallow to use the statically imported React instance.
  // Without this, vi.resetModules() causes zustand to load a second React copy.
  vi.doMock('zustand/react/shallow', () => ({
    useShallow: (selector) => {
      const prev = React.useRef(undefined);
      return (state) => {
        const next = selector(state);
        return shallow(prev.current, next) ? prev.current : (prev.current = next);
      };
    },
  }));

  vi.doMock('../../lib/stores/polling.js', () => ({
    usePollingStore: (selector) => selector(pollingState),
    forceRefresh: vi.fn(),
  }));

  vi.doMock('../../lib/stores/teams.js', () => ({
    useTeamStore: (selector) => selector(teamState),
    teamActions: {
      updateMemory: vi.fn(),
      deleteMemory: vi.fn(),
    },
  }));

  vi.doMock('../../components/ActivityTimeline/ActivityTimeline.js', () => ({
    default: function MockActivityTimeline() {
      return <div data-testid="activity-timeline" />;
    },
  }));

  vi.doMock('../../components/StatusState/StatusState.js', () => ({
    default: function MockStatusState({ title }) {
      return <div data-testid="status-state">{title}</div>;
    },
  }));

  vi.doMock('../../components/ViewHeader/ViewHeader.js', () => ({
    default: function MockViewHeader({ title }) {
      return <div data-testid="view-header">{title}</div>;
    },
  }));

  vi.doMock('./ProjectLiveTab.js', () => ({
    default: () => <div />,
  }));
  vi.doMock('./ProjectMemoryTab.js', () => ({
    default: () => <div />,
  }));
  vi.doMock('./ProjectSessionsTab.js', () => ({
    default: () => <div />,
  }));
  vi.doMock('./ProjectToolsTab.js', () => ({
    default: () => <div />,
  }));

  const mod = await import('./ProjectView.js');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ProjectView states', () => {
  it('replaces the normal project header with an unavailable state when context fails', async () => {
    const ProjectView = await loadProjectView({
      pollingState: {
        contextData: null,
        contextStatus: 'error',
        contextTeamId: 't_chinwag',
        pollError: 'Internal server error',
        pollErrorData: null,
        lastUpdate: null,
      },
      teamState: {
        activeTeamId: 't_chinwag',
        teams: [{ team_id: 't_chinwag', team_name: 'chinwag' }],
      },
    });
    const { container, unmount } = renderComponent(ProjectView);

    expect(container.querySelector('[data-testid="status-state"]')?.textContent).toContain(
      'Could not load chinwag',
    );
    expect(container.querySelector('[data-testid="view-header"]')).toBeNull();

    unmount();
  });
});
