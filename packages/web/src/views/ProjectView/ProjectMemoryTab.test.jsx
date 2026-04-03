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

  vi.doMock('../../components/MemoryRow/MemoryRow.js', () => ({
    default: function MockMemoryRow({ memory }) {
      return <div data-testid="memory-row">{memory.text}</div>;
    },
  }));

  vi.doMock('../../components/EmptyState/EmptyState.js', () => ({
    default: function MockEmptyState({ title, hint }) {
      return (
        <div data-testid="empty-state">
          {title}::{hint}
        </div>
      );
    },
  }));

  const mod = await import('./ProjectMemoryTab.js');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ProjectMemoryTab states', () => {
  it('shows empty state when there are no memories', async () => {
    const ProjectMemoryTab = await loadProjectMemoryTab();
    const { container, unmount } = renderComponent(ProjectMemoryTab, {
      memories: [],
      memoryBreakdown: [],
      onUpdateMemory: vi.fn(),
      onDeleteMemory: vi.fn(),
    });

    const emptyState = container.querySelector('[data-testid="empty-state"]');
    expect(emptyState).not.toBeNull();
    expect(emptyState.textContent).toContain('No memory saved');

    unmount();
  });

  it('renders memory rows when memories are present', async () => {
    const ProjectMemoryTab = await loadProjectMemoryTab();
    const { container, unmount } = renderComponent(ProjectMemoryTab, {
      memories: [
        { id: 'm1', text: 'API design decision', tags: ['decision'] },
        { id: 'm2', text: 'Bug workaround', tags: ['bug'] },
      ],
      memoryBreakdown: [
        ['decision', 1],
        ['bug', 1],
      ],
      onUpdateMemory: vi.fn(),
      onDeleteMemory: vi.fn(),
    });

    const rows = container.querySelectorAll('[data-testid="memory-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toBe('API design decision');
    expect(rows[1].textContent).toBe('Bug workaround');

    unmount();
  });
});
