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
    rerender(newProps) {
      act(() => {
        root.render(<Component {...newProps} />);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function loadMemoryRow() {
  vi.resetModules();

  vi.doMock('../../lib/relativeTime.js', () => ({
    formatRelativeTime: (date) => (date ? '2m ago' : ''),
  }));

  vi.doMock('../../lib/toolMeta.js', () => ({
    getToolMeta: (tool) => ({
      label: tool === 'claude-code' ? 'Claude Code' : tool,
      color: '#8ec0a4',
      icon: tool === 'claude-code' ? 'CC' : null,
    }),
  }));

  vi.doMock('../ToolIcon/ToolIcon.jsx', () => ({
    default: function MockToolIcon({ tool }) {
      return <span data-testid="tool-icon">{tool}</span>;
    },
  }));

  const mod = await import('./MemoryRow.jsx');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const baseMemory = {
  id: 'mem_1',
  text: 'Always use TypeScript for new modules',
  tags: ['convention', 'typescript'],
  source_tool: 'claude-code',
  source_handle: 'alice',
  source_model: 'claude-4',
  updated_at: '2025-01-01T00:00:00Z',
};

describe('MemoryRow display', () => {
  it('renders memory text', async () => {
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
    });

    expect(container.textContent).toContain('Always use TypeScript for new modules');
    unmount();
  });

  it('renders tags', async () => {
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
    });

    expect(container.textContent).toContain('convention');
    expect(container.textContent).toContain('typescript');
    unmount();
  });

  it('renders source info (tool, model, handle, time)', async () => {
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
    });

    expect(container.textContent).toContain('Claude Code');
    expect(container.textContent).toContain('claude-4');
    expect(container.textContent).toContain('alice');
    expect(container.textContent).toContain('2m ago');
    unmount();
  });

  it('renders without tags', async () => {
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: { ...baseMemory, tags: [] },
    });

    expect(container.textContent).toContain('Always use TypeScript');
    unmount();
  });

  it('renders without source tool', async () => {
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: { ...baseMemory, source_tool: null },
    });

    expect(container.textContent).toContain('alice');
    unmount();
  });

  it('shows edit and delete buttons when handlers provided', async () => {
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    const buttons = [...container.querySelectorAll('button')];
    const labels = buttons.map((b) => b.textContent.trim());
    expect(labels).toContain('Edit');
    expect(labels).toContain('Delete');
    unmount();
  });

  it('hides action buttons when no handlers provided', async () => {
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
    });

    const buttons = [...container.querySelectorAll('button')];
    const labels = buttons.map((b) => b.textContent.trim());
    expect(labels).not.toContain('Edit');
    expect(labels).not.toContain('Delete');
    unmount();
  });
});

describe('MemoryRow edit mode', () => {
  it('enters edit mode when Edit is clicked', async () => {
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    const editBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Edit'
    );
    act(() => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('textarea')).not.toBeNull();
    expect(container.querySelector('textarea').value).toBe(baseMemory.text);
    unmount();
  });

  it('shows tags input pre-filled in edit mode', async () => {
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    const editBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Edit'
    );
    act(() => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const tagInput = container.querySelector('input[type="text"]');
    expect(tagInput).not.toBeNull();
    expect(tagInput.value).toBe('convention, typescript');
    unmount();
  });

  it('calls onUpdate with changed text on save', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
      onUpdate,
      onDelete: vi.fn(),
    });

    // Enter edit mode
    const editBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Edit'
    );
    act(() => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Change text
    const textarea = container.querySelector('textarea');
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ).set;
      nativeInputValueSetter.call(textarea, 'Updated text');
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Save
    const saveBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Save'
    );
    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onUpdate).toHaveBeenCalledWith('mem_1', 'Updated text', undefined);
    unmount();
  });

  it('cancels edit mode without calling onUpdate', async () => {
    const onUpdate = vi.fn();
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
      onUpdate,
      onDelete: vi.fn(),
    });

    // Enter edit mode
    const editBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Edit'
    );
    act(() => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Cancel
    const cancelBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Cancel'
    );
    act(() => {
      cancelBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onUpdate).not.toHaveBeenCalled();
    // Should be back in display mode
    expect(container.querySelector('textarea')).toBeNull();
    unmount();
  });

  it('does not save when text is unchanged', async () => {
    const onUpdate = vi.fn();
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
      onUpdate,
      onDelete: vi.fn(),
    });

    // Enter edit mode
    const editBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Edit'
    );
    act(() => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Save without changes
    const saveBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Save'
    );
    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onUpdate).not.toHaveBeenCalled();
    // Should exit edit mode
    expect(container.querySelector('textarea')).toBeNull();
    unmount();
  });

  it('handles Escape key to cancel', async () => {
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    // Enter edit mode
    const editBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Edit'
    );
    act(() => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('textarea')).not.toBeNull();

    // Press Escape on the edit form
    const editBody = container.querySelector('textarea').closest('div');
    act(() => {
      // Dispatch on a parent that has the onKeyDown handler
      const keyEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      editBody.dispatchEvent(keyEvent);
    });

    expect(container.querySelector('textarea')).toBeNull();
    unmount();
  });

  it('shows error when onUpdate rejects', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('Network error'));
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
      onUpdate,
      onDelete: vi.fn(),
    });

    // Enter edit mode
    const editBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Edit'
    );
    act(() => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Change text
    const textarea = container.querySelector('textarea');
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ).set;
      nativeInputValueSetter.call(textarea, 'Changed');
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Save
    const saveBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Save'
    );
    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Network error');
    // Should still be in edit mode
    expect(container.querySelector('textarea')).not.toBeNull();
    unmount();
  });
});

describe('MemoryRow delete', () => {
  it('requires confirmation before deleting', async () => {
    const onDelete = vi.fn();
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
      onUpdate: vi.fn(),
      onDelete,
    });

    const deleteBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Delete'
    );
    act(() => {
      deleteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Should not have called onDelete yet - need confirmation
    expect(onDelete).not.toHaveBeenCalled();

    // Should now show "Confirm?"
    expect(container.textContent).toContain('Confirm?');

    unmount();
  });

  it('calls onDelete after confirmation click', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
      onUpdate: vi.fn(),
      onDelete,
    });

    // First click: show confirmation
    const deleteBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Delete'
    );
    act(() => {
      deleteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Second click: confirm deletion
    const confirmBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.includes('Confirm')
    );
    await act(async () => {
      confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onDelete).toHaveBeenCalledWith('mem_1');
    unmount();
  });

  it('resets to Delete button when onDelete rejects', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('Delete failed'));
    const MemoryRow = await loadMemoryRow();
    const { container, unmount } = renderComponent(MemoryRow, {
      memory: baseMemory,
      onUpdate: vi.fn(),
      onDelete,
    });

    // First click to show confirmation
    const deleteBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Delete'
    );
    act(() => {
      deleteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('Confirm?');

    // Confirm - will fail
    const confirmBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent.includes('Confirm')
    );
    await act(async () => {
      confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // After rejection, confirmDelete resets so "Delete" button returns
    expect(onDelete).toHaveBeenCalledWith('mem_1');
    const buttons = [...container.querySelectorAll('button')];
    const labels = buttons.map((b) => b.textContent.trim());
    expect(labels).toContain('Delete');
    unmount();
  });
});
