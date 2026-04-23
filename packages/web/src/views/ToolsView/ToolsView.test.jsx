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

let mockScoredStackData;
const navigateSpy = vi.fn();
const setQueryParamSpy = vi.fn();

async function loadToolsView(scoredOverrides = {}) {
  vi.resetModules();
  navigateSpy.mockClear();
  setQueryParamSpy.mockClear();

  window.history.replaceState(null, '', '/dashboard/tools');

  mockScoredStackData = {
    analytics: {},
    isLoading: false,
    error: null,
    rows: [],
    getDrillIn: () => null,
    ...scoredOverrides,
  };

  vi.doMock('./useScoredStackData.js', () => ({
    useScoredStackData: () => mockScoredStackData,
  }));

  vi.doMock('./useToolsViewData.js', () => ({
    useToolsViewData: () => ({
      arcs: [],
      uniqueTools: 0,
      toolShare: [],
      evaluations: [],
    }),
    arcPath: () => 'M0 0',
    CX: 130,
    CY: 130,
    R: 58,
    SW: 13,
  }));

  vi.doMock('../../components/InlineHint/InlineHint.jsx', () => ({
    default: function MockInlineHint({ children, actionLabel, onAction, onDismiss }) {
      return (
        <div data-testid="inline-hint">
          {children}
          <button onClick={onAction}>{actionLabel}</button>
          <button onClick={onDismiss} aria-label="Dismiss">
            ×
          </button>
        </div>
      );
    },
  }));

  vi.doMock('../../hooks/useDismissible.js', () => ({
    useDismissible: () => ({
      isDismissed: () => false,
      dismiss: vi.fn(),
      reset: vi.fn(),
      dismissedIds: new Set(),
    }),
  }));

  vi.doMock('./StackToolDetail.js', () => ({
    default: function MockStackToolDetail() {
      return <div data-testid="stack-tool-detail" />;
    },
  }));

  vi.doMock('./Sparkline.js', () => ({
    default: function MockSparkline() {
      return <span data-testid="sparkline" />;
    },
  }));

  vi.doMock('../../lib/router.js', () => ({
    navigate: navigateSpy,
    setQueryParam: setQueryParamSpy,
    useQueryParam: () => null,
  }));

  vi.doMock('../../components/ViewHeader/ViewHeader.jsx', () => ({
    default: function MockViewHeader({ title }) {
      return <div data-testid="view-header">{title}</div>;
    },
  }));

  vi.doMock('../../components/Skeleton/Skeleton.jsx', () => ({
    SkeletonRows: function MockSkeletonRows() {
      return <div data-testid="skeleton-rows" />;
    },
  }));

  vi.doMock('../../components/ToolIcon/ToolIcon.jsx', () => ({
    default: function MockToolIcon() {
      return <span data-testid="tool-icon" />;
    },
  }));

  const mod = await import('./ToolsView.js');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ToolsView', () => {
  it('shows loading skeleton when fetching with no rows', async () => {
    const ToolsView = await loadToolsView({ isLoading: true, rows: [] });
    const { container, unmount } = renderComponent(ToolsView, {});

    expect(container.querySelector('[data-testid="skeleton-rows"]')).not.toBeNull();

    unmount();
  });

  it('renders the Tools header', async () => {
    const ToolsView = await loadToolsView();
    const { container, unmount } = renderComponent(ToolsView, {});

    expect(container.querySelector('[data-testid="view-header"]')?.textContent).toBe('Tools');

    unmount();
  });

  it('shows empty state when there are no scored rows', async () => {
    const ToolsView = await loadToolsView({ rows: [] });
    const { container, unmount } = renderComponent(ToolsView, {});

    expect(container.textContent).toContain('No tools have reported sessions yet');
    expect(container.textContent).toContain('npx chinmeister init');

    unmount();
  });

  it('renders a scored row with concrete metrics', async () => {
    const ToolsView = await loadToolsView({
      rows: [
        {
          toolId: 'cursor',
          sessions: 12,
          completed: 9,
          abandoned: 2,
          failed: 1,
          completionRate: 75,
          avgFirstEditMin: 1.5,
          inputTokens: 1200,
          outputTokens: 800,
          reporting: 'reporting',
          sparkline: [1, 2, 3, 2, 4],
        },
      ],
    });
    const { container, unmount } = renderComponent(ToolsView, {});

    expect(container.textContent).toContain('Cursor');
    expect(container.textContent).toContain('12');
    expect(container.textContent).toContain('75%');

    unmount();
  });

  it('clicking a row opens the stack drill-in via setQueryParam', async () => {
    const ToolsView = await loadToolsView({
      rows: [
        {
          toolId: 'cursor',
          sessions: 5,
          completed: 5,
          abandoned: 0,
          failed: 0,
          completionRate: 100,
          avgFirstEditMin: null,
          inputTokens: 0,
          outputTokens: 0,
          reporting: 'reporting',
          sparkline: [1, 2, 3],
        },
      ],
    });
    const { container, unmount } = renderComponent(ToolsView, {});

    const rowBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Cursor'),
    );
    expect(rowBtn).toBeDefined();

    act(() => {
      rowBtn.click();
    });

    expect(setQueryParamSpy).toHaveBeenCalledWith('stack', 'cursor');

    unmount();
  });

  it('renders sortable column headers', async () => {
    const ToolsView = await loadToolsView();
    const { container, unmount } = renderComponent(ToolsView, {});

    expect(container.textContent).toContain('Tool');
    expect(container.textContent).toContain('Sessions');
    expect(container.textContent).toContain('Completion');
    expect(container.textContent).toContain('First edit');
    expect(container.textContent).toContain('Trend');

    unmount();
  });

  it('sorts rows by sessions descending by default', async () => {
    const ToolsView = await loadToolsView({
      rows: [
        {
          toolId: 'claude',
          sessions: 3,
          completed: 1,
          abandoned: 1,
          failed: 1,
          completionRate: 33,
          avgFirstEditMin: null,
          inputTokens: 0,
          outputTokens: 0,
          reporting: 'reporting',
          sparkline: [1],
        },
        {
          toolId: 'cursor',
          sessions: 10,
          completed: 8,
          abandoned: 2,
          failed: 0,
          completionRate: 80,
          avgFirstEditMin: null,
          inputTokens: 0,
          outputTokens: 0,
          reporting: 'reporting',
          sparkline: [1],
        },
      ],
    });
    const { container, unmount } = renderComponent(ToolsView, {});

    const rows = [...container.querySelectorAll('button')].filter((b) =>
      /Cursor|Claude/.test(b.textContent),
    );
    expect(rows[0].textContent).toContain('Cursor');
    expect(rows[1].textContent).toContain('Claude');

    unmount();
  });
});
