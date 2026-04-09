// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock dependencies that use browser APIs or complex imports
vi.mock('../../lib/toolMeta.js', () => ({
  getToolMeta: (tool) =>
    tool === 'claude-code' ? { label: 'Claude Code', color: '#6366f1', icon: null } : null,
}));

vi.mock('../ToolIcon/ToolIcon.js', () => ({
  default: () => null,
}));

import MemoryRow from './MemoryRow.tsx';

function renderRow(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<MemoryRow {...props} />);
  });

  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
    click(text) {
      const el = findByText(container, text);
      if (!el) throw new Error(`Could not find element with text "${text}"`);
      act(() => el.click());
    },
  };
}

function findByText(container, text) {
  // eslint-disable-next-line no-undef
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (walker.currentNode.textContent.trim() === text) {
      return walker.currentNode.parentElement;
    }
  }
  // Also check buttons/spans with exact textContent
  for (const el of container.querySelectorAll('button, span')) {
    if (el.textContent.trim() === text) return el;
  }
  return null;
}

function makeMemory(overrides = {}) {
  return {
    id: 'm1',
    text: 'Use Redis for caching',
    tags: ['infra', 'cache'],
    categories: ['architecture'],
    handle: 'alice',
    host_tool: 'claude-code',
    agent_model: 'claude-sonnet-4-5-20250514',
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T12:00:00Z',
    last_accessed_at: '2026-04-02T08:00:00Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------

describe('MemoryRow — collapsed state', () => {
  it('renders memory text', () => {
    const { container, unmount } = renderRow({ memory: makeMemory() });
    expect(container.textContent).toContain('Use Redis for caching');
    unmount();
  });

  it('shows top tags inline (max 3)', () => {
    const { container, unmount } = renderRow({ memory: makeMemory() });
    expect(findByText(container, 'infra')).not.toBeNull();
    expect(findByText(container, 'cache')).not.toBeNull();
    unmount();
  });

  it('shows overflow count for 4+ tags', () => {
    const { container, unmount } = renderRow({
      memory: makeMemory({ tags: ['a', 'b', 'c', 'd'] }),
    });
    expect(findByText(container, '+1')).not.toBeNull();
    unmount();
  });

  it('does not show model when collapsed', () => {
    const { container, unmount } = renderRow({ memory: makeMemory() });
    expect(findByText(container, 'claude-sonnet-4-5-20250514')).toBeNull();
    unmount();
  });
});

describe('MemoryRow — expanded state', () => {
  it('shows tags on expand', () => {
    const r = renderRow({ memory: makeMemory() });
    r.click('Use Redis for caching');
    expect(findByText(r.container, 'infra')).not.toBeNull();
    expect(findByText(r.container, 'cache')).not.toBeNull();
    r.unmount();
  });

  it('shows model on expand', () => {
    const r = renderRow({ memory: makeMemory() });
    r.click('Use Redis for caching');
    expect(findByText(r.container, 'claude-sonnet-4-5-20250514')).not.toBeNull();
    r.unmount();
  });

  it('collapses on second click', () => {
    const r = renderRow({ memory: makeMemory() });
    r.click('Use Redis for caching');
    expect(findByText(r.container, 'claude-sonnet-4-5-20250514')).not.toBeNull();
    r.click('Use Redis for caching');
    expect(findByText(r.container, 'claude-sonnet-4-5-20250514')).toBeNull();
    r.unmount();
  });
});

describe('MemoryRow — delete', () => {
  it('shows delete when expanded and onDelete provided', () => {
    const r = renderRow({ memory: makeMemory(), onDelete: vi.fn() });
    r.click('Use Redis for caching');
    expect(findByText(r.container, 'Delete')).not.toBeNull();
    r.unmount();
  });

  it('requires confirmation', () => {
    const onDelete = vi.fn();
    const r = renderRow({ memory: makeMemory(), onDelete });
    r.click('Use Redis for caching');
    r.click('Delete');
    expect(onDelete).not.toHaveBeenCalled();
    expect(findByText(r.container, 'Confirm delete?')).not.toBeNull();
    r.unmount();
  });

  it('no delete button without onDelete', () => {
    const r = renderRow({ memory: makeMemory() });
    r.click('Use Redis for caching');
    expect(findByText(r.container, 'Delete')).toBeNull();
    r.unmount();
  });
});

describe('MemoryRow — no text editing', () => {
  it('has no textarea or edit button', () => {
    const r = renderRow({
      memory: makeMemory(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });
    r.click('Use Redis for caching');
    expect(r.container.querySelector('textarea')).toBeNull();
    expect(findByText(r.container, 'Edit')).toBeNull();
    r.unmount();
  });
});
