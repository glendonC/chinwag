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

async function loadDirectoryView(overrides = {}) {
  vi.resetModules();

  window.history.replaceState(null, '', '/dashboard/directory');

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
    sortBy: 'score',
    setSortBy: vi.fn(),
    selectedToolId: null,
    selectedEvaluation: null,
    selectTool: vi.fn(),
    showAll: false,
    setShowAll: vi.fn(),
    hideConfigured: true,
    setHideConfigured: vi.fn(),
    isConfigured: () => false,
    getScore: () => 0,
    ...overrides,
  };

  vi.doMock('../ToolsView/useToolsViewData.js', () => ({
    useToolsViewData: () => mockToolsViewData,
  }));

  vi.doMock('./DirectoryRow.jsx', () => ({
    default: function MockDirectoryRow({ evaluation }) {
      return (
        <div data-testid="directory-row" data-id={evaluation.id}>
          {evaluation.name}
        </div>
      );
    },
    VerdictBadge: function MockVerdictBadge() {
      return <span data-testid="verdict-badge" />;
    },
  }));

  vi.doMock('./ToolDetailView.jsx', () => ({
    default: function MockToolDetailView() {
      return <div data-testid="tool-detail-view" />;
    },
  }));

  vi.doMock('../../components/ViewHeader/ViewHeader.jsx', () => ({
    default: function MockViewHeader({ title }) {
      return <div data-testid="view-header">{title}</div>;
    },
  }));

  vi.doMock('../../components/Skeleton/Skeleton.jsx', () => ({
    ShimmerText: function MockShimmerText({ children, as: Tag = 'span' }) {
      return <Tag data-testid="shimmer-text">{children}</Tag>;
    },
    SkeletonRows: function MockSkeletonRows() {
      return <div data-testid="skeleton-rows" />;
    },
  }));

  vi.doMock('../../components/ToolIcon/ToolIcon.jsx', () => ({
    default: function MockToolIcon() {
      return <span data-testid="tool-icon" />;
    },
  }));

  const mod = await import('./DirectoryView.js');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('DirectoryView', () => {
  it('renders the Directory header', async () => {
    const DirectoryView = await loadDirectoryView();
    const { container, unmount } = renderComponent(DirectoryView, {});

    expect(container.querySelector('[data-testid="view-header"]')?.textContent).toBe('Directory');

    unmount();
  });

  it('shows loading skeleton when catalog is loading', async () => {
    const DirectoryView = await loadDirectoryView({ loading: true, evaluations: [] });
    const { container, unmount } = renderComponent(DirectoryView, {});

    expect(container.querySelector('[data-testid="skeleton-rows"]')).not.toBeNull();

    unmount();
  });

  it('renders directory rows for evaluations', async () => {
    const DirectoryView = await loadDirectoryView({
      evaluations: [{ id: 'cursor' }, { id: 'claude' }],
      filteredEvaluations: [
        { id: 'cursor', name: 'Cursor' },
        { id: 'claude', name: 'Claude Code' },
      ],
    });
    const { container, unmount } = renderComponent(DirectoryView, {});

    const rows = container.querySelectorAll('[data-testid="directory-row"]');
    expect(rows.length).toBe(2);
    expect(container.textContent).toContain('2 of 2 tools');

    unmount();
  });

  it('shows empty state when no evaluations match filters', async () => {
    const DirectoryView = await loadDirectoryView({
      evaluations: [{ id: 'x' }],
      filteredEvaluations: [],
    });
    const { container, unmount } = renderComponent(DirectoryView, {});

    expect(container.textContent).toContain('No tools found');

    unmount();
  });

  it('renders verdict filter buttons', async () => {
    const DirectoryView = await loadDirectoryView();
    const { container, unmount } = renderComponent(DirectoryView, {});

    expect(container.textContent).toContain('All');
    expect(container.textContent).toContain('Supported');
    expect(container.textContent).toContain('Available');
    expect(container.textContent).toContain('Coming soon');

    unmount();
  });

  it('renders hide-my-tools toggle', async () => {
    const DirectoryView = await loadDirectoryView();
    const { container, unmount } = renderComponent(DirectoryView, {});

    expect(container.textContent).toContain('Hide my tools');

    unmount();
  });

  it('renders search input', async () => {
    const DirectoryView = await loadDirectoryView();
    const { container, unmount } = renderComponent(DirectoryView, {});

    const searchInput = container.querySelector('input[placeholder="Search..."]');
    expect(searchInput).not.toBeNull();

    unmount();
  });
});
