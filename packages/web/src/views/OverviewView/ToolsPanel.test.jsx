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

async function loadToolsPanel() {
  vi.resetModules();

  vi.doMock('../../components/ToolIcon/ToolIcon.js', () => ({
    default: function MockToolIcon({ tool }) {
      return <span data-testid="tool-icon">{tool}</span>;
    },
  }));

  // Mock the svg arc utility from useOverviewData
  vi.doMock('./useOverviewData.js', () => ({
    arcPath: () => 'M 0 0',
    CX: 130,
    CY: 130,
    R: 110,
    SW: 20,
    GAP: 4,
    DEG: 360,
  }));

  const mod = await import('./ToolsPanel.js');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ToolsPanel', () => {
  it('shows empty hint when no arcs and no tool usage', async () => {
    const ToolsPanel = await loadToolsPanel();
    const { container, unmount } = renderComponent(ToolsPanel, {
      arcs: [],
      toolUsage: [],
      uniqueTools: 0,
      summaries: [],
    });

    expect(container.textContent).toContain('No tools connected yet');

    unmount();
  });

  it('renders ring chart and legend when arcs exist', async () => {
    const ToolsPanel = await loadToolsPanel();
    const { container, unmount } = renderComponent(ToolsPanel, {
      arcs: [
        {
          tool: 'cursor',
          share: 0.6,
          joins: 10,
          startDeg: 0,
          sweepDeg: 216,
          anchorX: 240,
          anchorY: 130,
          labelX: 255,
          labelY: 130,
          side: 'right',
        },
        {
          tool: 'windsurf',
          share: 0.4,
          joins: 6,
          startDeg: 220,
          sweepDeg: 136,
          anchorX: 20,
          anchorY: 130,
          labelX: 5,
          labelY: 130,
          side: 'left',
        },
      ],
      toolUsage: [
        { tool: 'cursor', joins: 10, share: 0.6 },
        { tool: 'windsurf', joins: 6, share: 0.4 },
      ],
      uniqueTools: 2,
      summaries: [
        {
          team_id: 't_1',
          team_name: 'Alpha',
          hosts_configured: [{ host_tool: 'cursor', joins: 5 }],
        },
      ],
    });

    // Ring chart should be present
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toContain('TOOLS');
    expect(container.textContent).toContain('2'); // uniqueTools

    // Legend rows
    expect(container.textContent).toContain('60%');
    expect(container.textContent).toContain('10 sessions');
    expect(container.textContent).toContain('40%');
    expect(container.textContent).toContain('6 sessions');

    unmount();
  });

  it('shows project names in legend', async () => {
    const ToolsPanel = await loadToolsPanel();
    const { container, unmount } = renderComponent(ToolsPanel, {
      arcs: [
        {
          tool: 'cursor',
          share: 1,
          joins: 5,
          startDeg: 0,
          sweepDeg: 356,
          anchorX: 240,
          anchorY: 130,
          labelX: 255,
          labelY: 130,
          side: 'right',
        },
      ],
      toolUsage: [{ tool: 'cursor', joins: 5, share: 1 }],
      uniqueTools: 1,
      summaries: [
        {
          team_id: 't_1',
          team_name: 'Alpha',
          hosts_configured: [{ host_tool: 'cursor', joins: 5 }],
        },
      ],
    });

    expect(container.textContent).toContain('Alpha');

    unmount();
  });

  it('pluralizes "session" vs "sessions"', async () => {
    const ToolsPanel = await loadToolsPanel();
    const { container, unmount } = renderComponent(ToolsPanel, {
      arcs: [
        {
          tool: 'cursor',
          share: 1,
          joins: 1,
          startDeg: 0,
          sweepDeg: 356,
          anchorX: 240,
          anchorY: 130,
          labelX: 255,
          labelY: 130,
          side: 'right',
        },
      ],
      toolUsage: [{ tool: 'cursor', joins: 1, share: 1 }],
      uniqueTools: 1,
      summaries: [],
    });

    expect(container.textContent).toContain('1 session');
    expect(container.textContent).not.toContain('1 sessions');

    unmount();
  });
});
