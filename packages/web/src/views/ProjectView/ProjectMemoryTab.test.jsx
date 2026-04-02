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

async function loadProjectMemoryTab() {
  vi.resetModules();

  vi.doMock('../../components/MemoryRow/MemoryRow.jsx', () => ({
    default: function MockMemoryRow({ memory }) {
      return <div data-testid={`memory-${memory.id}`}>{memory.text}</div>;
    },
  }));

  vi.doMock('../../components/EmptyState/EmptyState.jsx', () => ({
    default: function MockEmptyState({ title, hint }) {
      return <div data-testid="empty-state">{title} {hint}</div>;
    },
  }));

  const mod = await import('./ProjectMemoryTab.jsx');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const sampleMemories = [
  { id: 'm1', text: 'Use TypeScript for new modules', tags: ['convention', 'typescript'] },
  { id: 'm2', text: 'API keys in .env', tags: ['security'] },
  { id: 'm3', text: 'Always write tests', tags: ['convention'] },
];

const sampleBreakdown = [
  ['convention', 2],
  ['typescript', 1],
  ['security', 1],
];

describe('ProjectMemoryTab', () => {
  it('shows empty state when no memories exist', async () => {
    const Tab = await loadProjectMemoryTab();
    const { container, unmount } = renderComponent(Tab, {
      memories: [],
      memoryBreakdown: [],
      onUpdateMemory: vi.fn(),
      onDeleteMemory: vi.fn(),
    });

    expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
    expect(container.textContent).toContain('No memory saved');
    unmount();
  });

  it('renders memory list', async () => {
    const Tab = await loadProjectMemoryTab();
    const { container, unmount } = renderComponent(Tab, {
      memories: sampleMemories,
      memoryBreakdown: sampleBreakdown,
      onUpdateMemory: vi.fn(),
      onDeleteMemory: vi.fn(),
    });

    expect(container.querySelector('[data-testid="memory-m1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="memory-m2"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="memory-m3"]')).not.toBeNull();
    unmount();
  });

  it('shows search input when more than 3 memories or tags exist', async () => {
    const Tab = await loadProjectMemoryTab();
    const { container, unmount } = renderComponent(Tab, {
      memories: sampleMemories,
      memoryBreakdown: sampleBreakdown,
      onUpdateMemory: vi.fn(),
      onDeleteMemory: vi.fn(),
    });

    const searchInput = container.querySelector('input[type="text"]');
    expect(searchInput).not.toBeNull();
    expect(searchInput.placeholder).toBe('Search memories');
    unmount();
  });

  it('filters memories by search text', async () => {
    const Tab = await loadProjectMemoryTab();
    const { container, unmount } = renderComponent(Tab, {
      memories: sampleMemories,
      memoryBreakdown: sampleBreakdown,
      onUpdateMemory: vi.fn(),
      onDeleteMemory: vi.fn(),
    });

    const searchInput = container.querySelector('input[type="text"]');
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      ).set;
      nativeInputValueSetter.call(searchInput, 'TypeScript');
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="memory-m1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="memory-m2"]')).toBeNull();
    expect(container.querySelector('[data-testid="memory-m3"]')).toBeNull();
    unmount();
  });

  it('renders tag filter buttons', async () => {
    const Tab = await loadProjectMemoryTab();
    const { container, unmount } = renderComponent(Tab, {
      memories: sampleMemories,
      memoryBreakdown: sampleBreakdown,
      onUpdateMemory: vi.fn(),
      onDeleteMemory: vi.fn(),
    });

    const buttons = [...container.querySelectorAll('button')];
    const labels = buttons.map((b) => b.textContent.trim());
    expect(labels).toContain('convention');
    expect(labels).toContain('typescript');
    expect(labels).toContain('security');
    unmount();
  });

  it('filters by tag when tag button is clicked', async () => {
    const Tab = await loadProjectMemoryTab();
    const { container, unmount } = renderComponent(Tab, {
      memories: sampleMemories,
      memoryBreakdown: sampleBreakdown,
      onUpdateMemory: vi.fn(),
      onDeleteMemory: vi.fn(),
    });

    const securityBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'security'
    );
    act(() => {
      securityBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="memory-m1"]')).toBeNull();
    expect(container.querySelector('[data-testid="memory-m2"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="memory-m3"]')).toBeNull();
    unmount();
  });

  it('shows "All" button and clears tag filter when clicked', async () => {
    const Tab = await loadProjectMemoryTab();
    const { container, unmount } = renderComponent(Tab, {
      memories: sampleMemories,
      memoryBreakdown: sampleBreakdown,
      onUpdateMemory: vi.fn(),
      onDeleteMemory: vi.fn(),
    });

    // Activate a tag filter
    const securityBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'security'
    );
    act(() => {
      securityBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // "All" button should appear
    const allBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'All'
    );
    expect(allBtn).toBeTruthy();

    // Click "All" to clear filter
    act(() => {
      allBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // All memories should be visible again
    expect(container.querySelector('[data-testid="memory-m1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="memory-m2"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="memory-m3"]')).not.toBeNull();
    unmount();
  });

  it('shows "No matches" when search/tag filter yields no results', async () => {
    const Tab = await loadProjectMemoryTab();
    const { container, unmount } = renderComponent(Tab, {
      memories: sampleMemories,
      memoryBreakdown: sampleBreakdown,
      onUpdateMemory: vi.fn(),
      onDeleteMemory: vi.fn(),
    });

    const searchInput = container.querySelector('input[type="text"]');
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      ).set;
      nativeInputValueSetter.call(searchInput, 'xyznonexistent');
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.textContent).toContain('No matches');
    unmount();
  });

  it('toggles tag off when same tag clicked again', async () => {
    const Tab = await loadProjectMemoryTab();
    const { container, unmount } = renderComponent(Tab, {
      memories: sampleMemories,
      memoryBreakdown: sampleBreakdown,
      onUpdateMemory: vi.fn(),
      onDeleteMemory: vi.fn(),
    });

    // Click to activate
    const securityBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'security'
    );
    act(() => {
      securityBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="memory-m1"]')).toBeNull();

    // Click again to deactivate
    const securityBtn2 = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'security'
    );
    act(() => {
      securityBtn2.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="memory-m1"]')).not.toBeNull();

    unmount();
  });
});
