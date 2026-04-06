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

let mockToolsViewData;

async function loadToolsView(overrides = {}) {
  vi.resetModules();

  mockToolsViewData = {
    loading: false,
    evaluations: [],
    categories: {},
    toolShare: [],
    hostShare: [],
    surfaceShare: [],
    categoryShare: [],
    categoryList: [],
    connectedProjects: 0,
    arcs: [],
    uniqueTools: 0,
    filteredEvaluations: [],
    activeCategory: 'all',
    setActiveCategory: vi.fn(),
    activeVerdict: 'all',
    setActiveVerdict: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    expandedId: null,
    setExpandedId: vi.fn(),
    showAll: false,
    setShowAll: vi.fn(),
    hideConfigured: true,
    setHideConfigured: vi.fn(),
    isConfigured: () => false,
    ...overrides,
  };

  vi.doMock('./useToolsViewData.js', () => ({
    useToolsViewData: () => mockToolsViewData,
    arcPath: () => 'M0 0',
    CX: 130,
    CY: 130,
    R: 58,
    SW: 13,
  }));

  vi.doMock('../../components/ViewHeader/ViewHeader.js', () => ({
    default: function MockViewHeader({ title }) {
      return <div data-testid="view-header">{title}</div>;
    },
  }));

  vi.doMock('../../components/Skeleton/Skeleton.js', () => ({
    ShimmerText: function MockShimmerText({ children, as: Tag = 'span' }) {
      return <Tag data-testid="shimmer-text">{children}</Tag>;
    },
    SkeletonStatGrid: function MockSkeletonStatGrid() {
      return <div data-testid="skeleton-stat-grid" />;
    },
    SkeletonRows: function MockSkeletonRows() {
      return <div data-testid="skeleton-rows" />;
    },
  }));

  vi.doMock('../../components/ToolIcon/ToolIcon.js', () => ({
    default: function MockToolIcon() {
      return <span data-testid="tool-icon" />;
    },
  }));

  vi.doMock('./DirectoryRow.js', () => ({
    default: function MockDirectoryRow({ evaluation, isExpanded, onToggle }) {
      return (
        <div data-testid="directory-row" data-id={evaluation.id} data-expanded={String(isExpanded)}>
          <button data-testid={`toggle-${evaluation.id}`} onClick={onToggle}>
            {evaluation.name}
          </button>
        </div>
      );
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
  it('shows loading state when loading with no data', async () => {
    const ToolsView = await loadToolsView({ loading: true, evaluations: [], toolShare: [] });
    const { container, unmount } = renderComponent(ToolsView, {});

    expect(container.textContent).toContain('Loading your tools');

    unmount();
  });

  it('renders header when data is loaded', async () => {
    const ToolsView = await loadToolsView({
      toolShare: [{ tool: 'claude', value: 5, share: 1, projects: ['proj1'] }],
      arcs: [
        {
          tool: 'claude',
          joins: 5,
          share: 1,
          startDeg: 0,
          sweepDeg: 346,
          labelX: 152,
          labelY: 60,
          anchorX: 145,
          anchorY: 65,
          side: 'right',
        },
      ],
      uniqueTools: 1,
    });
    const { container, unmount } = renderComponent(ToolsView, {});

    expect(container.querySelector('[data-testid="view-header"]')?.textContent).toBe('Tools');

    unmount();
  });

  it('renders configured tools in stack zone', async () => {
    const ToolsView = await loadToolsView({
      toolShare: [
        { tool: 'cursor', value: 8, share: 0.6, projects: ['proj1', 'proj2'] },
        { tool: 'claude', value: 5, share: 0.4, projects: ['proj1'] },
      ],
      arcs: [],
      uniqueTools: 2,
    });
    const { container, unmount } = renderComponent(ToolsView, {});

    expect(container.textContent).toContain('Cursor');
    expect(container.textContent).toContain('Claude Code');
    expect(container.textContent).toContain('60%');

    unmount();
  });

  it('renders directory rows for evaluations', async () => {
    const ToolsView = await loadToolsView({
      evaluations: [{ id: 'cursor' }, { id: 'claude' }],
      filteredEvaluations: [
        { id: 'cursor', name: 'Cursor' },
        { id: 'claude', name: 'Claude Code' },
      ],
    });
    const { container, unmount } = renderComponent(ToolsView, {});

    const rows = container.querySelectorAll('[data-testid="directory-row"]');
    expect(rows.length).toBe(2);
    expect(container.textContent).toContain('2 of 2 tools');

    unmount();
  });

  it('shows "No tools match" when filteredEvaluations is empty', async () => {
    const ToolsView = await loadToolsView({
      evaluations: [{ id: 'x' }],
      filteredEvaluations: [],
    });
    const { container, unmount } = renderComponent(ToolsView, {});

    expect(container.textContent).toContain('No tools match the current filters');

    unmount();
  });

  it('shows "Show more" button when more than 15 evaluations exist', async () => {
    const evals = Array.from({ length: 20 }, (_, i) => ({
      id: `tool_${i}`,
      name: `Tool ${i}`,
    }));
    const ToolsView = await loadToolsView({
      evaluations: evals,
      filteredEvaluations: evals,
      showAll: false,
    });
    const { container, unmount } = renderComponent(ToolsView, {});

    // Should only show 15 rows
    const rows = container.querySelectorAll('[data-testid="directory-row"]');
    expect(rows.length).toBe(15);

    const showMoreBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('more tools'),
    );
    expect(showMoreBtn).not.toBeUndefined();
    expect(showMoreBtn.textContent).toContain('5 more tools');

    unmount();
  });

  it('shows "Show less" button when showAll is true with many evaluations', async () => {
    const evals = Array.from({ length: 20 }, (_, i) => ({
      id: `tool_${i}`,
      name: `Tool ${i}`,
    }));
    const ToolsView = await loadToolsView({
      evaluations: evals,
      filteredEvaluations: evals,
      showAll: true,
    });
    const { container, unmount } = renderComponent(ToolsView, {});

    const rows = container.querySelectorAll('[data-testid="directory-row"]');
    expect(rows.length).toBe(20);

    const showLessBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Show less'),
    );
    expect(showLessBtn).not.toBeUndefined();

    unmount();
  });

  it('renders verdict filter buttons', async () => {
    const ToolsView = await loadToolsView();
    const { container, unmount } = renderComponent(ToolsView, {});

    expect(container.textContent).toContain('All');
    expect(container.textContent).toContain('Integrated');
    expect(container.textContent).toContain('Installable');
    expect(container.textContent).toContain('Listed');

    unmount();
  });

  it('renders Not configured toggle', async () => {
    const ToolsView = await loadToolsView();
    const { container, unmount } = renderComponent(ToolsView, {});

    expect(container.textContent).toContain('Not configured');

    unmount();
  });

  it('renders search input', async () => {
    const ToolsView = await loadToolsView();
    const { container, unmount } = renderComponent(ToolsView, {});

    const searchInput = container.querySelector('input[placeholder="Search tools..."]');
    expect(searchInput).not.toBeNull();

    unmount();
  });

  it('calls setSearchQuery on search input change', async () => {
    const setSearchQuery = vi.fn();
    const ToolsView = await loadToolsView({ setSearchQuery });
    const { container, unmount } = renderComponent(ToolsView, {});

    const searchInput = container.querySelector('input[placeholder="Search tools..."]');

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    await act(async () => {
      nativeInputValueSetter.call(searchInput, 'cursor');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(setSearchQuery).toHaveBeenCalledWith('cursor');

    unmount();
  });
});
