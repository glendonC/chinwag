import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for packages/cli/lib/dashboard/memory.js - useMemoryManager hook.
 *
 * Since we cannot render React hooks in a node environment without a test renderer,
 * we test the logic by importing the module with mocked dependencies and exercising
 * the hook's internal functions through the returned object.
 *
 * Pattern: vi.doMock the api module, then dynamically import memory.js so each test
 * gets fresh mocks. We use a minimal React mock that captures hook state.
 */

// ── Minimal hook simulation ────────────────────────────
// We don't render React - we simulate useState/useRef so the hook's logic
// functions are callable and we can inspect state changes.

let hookStates;
let stateIdx;

function resetHookSim() {
  hookStates = [];
  stateIdx = 0;
}

function mockUseState(initial) {
  const idx = stateIdx++;
  if (hookStates[idx] === undefined) {
    hookStates[idx] = typeof initial === 'function' ? initial() : initial;
  }
  const setState = (val) => {
    hookStates[idx] = typeof val === 'function' ? val(hookStates[idx]) : val;
  };
  return [hookStates[idx], setState];
}

// ── Module loader with mock overrides ──────────────────

async function loadMemoryModule(apiOverrides = {}) {
  vi.resetModules();

  const mockPost = apiOverrides.post || vi.fn(() => Promise.resolve());
  const mockDel = apiOverrides.del || vi.fn(() => Promise.resolve());

  vi.doMock('../api.js', () => ({
    api: () => ({
      post: mockPost,
      del: mockDel,
      get: vi.fn(() => Promise.resolve()),
    }),
  }));

  vi.doMock('react', () => ({
    useState: mockUseState,
    useRef: (initial) => ({ current: initial }),
  }));

  const mod = await import('../dashboard/memory.js');
  return { mod, mockPost, mockDel };
}

function callHook(mod, overrides = {}) {
  resetHookSim();
  stateIdx = 0;
  const config = overrides.config || { token: 'tok_test' };
  const teamId = 'teamId' in overrides ? overrides.teamId : 'team_abc';
  const bumpRefreshKey = overrides.bumpRefreshKey || vi.fn();
  const flash = overrides.flash || vi.fn();

  const result = mod.useMemoryManager({ config, teamId, bumpRefreshKey, flash });
  return { result, config, teamId, bumpRefreshKey, flash };
}

// ── Tests ──────────────────────────────────────────────

describe('useMemoryManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── deleteMemoryItem ─────────────────────────────────

  describe('deleteMemoryItem', () => {
    it('calls the API delete endpoint with correct path and body', async () => {
      const mockDel = vi.fn(() => Promise.resolve());
      const { mod } = await loadMemoryModule({ del: mockDel });
      const { result } = callHook(mod);

      result.deleteMemoryItem({ id: 'mem_123' });
      expect(mockDel).toHaveBeenCalledWith('/teams/team_abc/memory', { id: 'mem_123' });
    });

    it('does nothing when mem is null', async () => {
      const mockDel = vi.fn(() => Promise.resolve());
      const { mod } = await loadMemoryModule({ del: mockDel });
      const { result } = callHook(mod);

      result.deleteMemoryItem(null);
      expect(mockDel).not.toHaveBeenCalled();
    });

    it('does nothing when mem has no id', async () => {
      const mockDel = vi.fn(() => Promise.resolve());
      const { mod } = await loadMemoryModule({ del: mockDel });
      const { result } = callHook(mod);

      result.deleteMemoryItem({ text: 'no id here' });
      expect(mockDel).not.toHaveBeenCalled();
    });

    it('does nothing when teamId is falsy', async () => {
      const mockDel = vi.fn(() => Promise.resolve());
      const { mod } = await loadMemoryModule({ del: mockDel });
      const { result } = callHook(mod, { teamId: null });

      result.deleteMemoryItem({ id: 'mem_123' });
      expect(mockDel).not.toHaveBeenCalled();
    });

    it('on success: resets deleteConfirm, clears selection, bumps refresh key', async () => {
      const mockDel = vi.fn(() => Promise.resolve());
      const { mod } = await loadMemoryModule({ del: mockDel });
      const bumpRefreshKey = vi.fn();
      const { result } = callHook(mod, { bumpRefreshKey });

      // Set some state first
      result.setDeleteConfirm(true);
      result.setMemorySelectedIdx(3);

      result.deleteMemoryItem({ id: 'mem_123' });
      await vi.runAllTimersAsync();
      // After the promise resolves, the .then() callback should have fired
      await Promise.resolve(); // flush microtasks

      // Re-read state by calling the hook again
      stateIdx = 0;
      const refreshed = mod.useMemoryManager({
        config: { token: 'tok_test' },
        teamId: 'team_abc',
        bumpRefreshKey,
        flash: vi.fn(),
      });

      expect(bumpRefreshKey).toHaveBeenCalled();
      // deleteConfirm should be reset to false
      expect(refreshed.deleteConfirm).toBe(false);
      // selectedIdx should be -1
      expect(refreshed.memorySelectedIdx).toBe(-1);
    });

    it('on failure: flashes error, resets deleteConfirm, clears deleteMsg', async () => {
      const apiError = new Error('Network error');
      const mockDel = vi.fn(() => Promise.reject(apiError));
      const { mod } = await loadMemoryModule({ del: mockDel });
      const flash = vi.fn();
      const { result } = callHook(mod, { flash });

      // Set deleteConfirm to true (simulating user already confirmed once)
      result.setDeleteConfirm(true);

      // Suppress expected console.error
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      result.deleteMemoryItem({ id: 'mem_123' });
      await Promise.resolve(); // flush the rejection
      await vi.runAllTimersAsync();
      await Promise.resolve();

      expect(flash).toHaveBeenCalledWith(
        expect.stringContaining('Could not delete'),
        expect.objectContaining({ tone: 'error' }),
      );

      // Re-read state
      stateIdx = 0;
      const refreshed = mod.useMemoryManager({
        config: { token: 'tok_test' },
        teamId: 'team_abc',
        bumpRefreshKey: vi.fn(),
        flash,
      });

      expect(refreshed.deleteConfirm).toBe(false);
      expect(refreshed.deleteMsg).toBeNull();
      spy.mockRestore();
    });

    it('on success: sets deleteMsg to "Deleted" then clears after timeout', async () => {
      const mockDel = vi.fn(() => Promise.resolve());
      const { mod } = await loadMemoryModule({ del: mockDel });
      const { result } = callHook(mod);

      result.deleteMemoryItem({ id: 'mem_123' });
      await Promise.resolve(); // flush microtasks for .then()

      // After .then() runs, deleteMsg should be 'Deleted'
      stateIdx = 0;
      const afterDelete = mod.useMemoryManager({
        config: { token: 'tok_test' },
        teamId: 'team_abc',
        bumpRefreshKey: vi.fn(),
        flash: vi.fn(),
      });
      expect(afterDelete.deleteMsg).toBe('Deleted');

      // Advance past DELETE_FEEDBACK_MS (2000ms)
      vi.advanceTimersByTime(2000);

      stateIdx = 0;
      const afterClear = mod.useMemoryManager({
        config: { token: 'tok_test' },
        teamId: 'team_abc',
        bumpRefreshKey: vi.fn(),
        flash: vi.fn(),
      });
      expect(afterClear.deleteMsg).toBeNull();
    });
  });

  // ── saveMemory ───────────────────────────────────────

  describe('saveMemory', () => {
    it('calls API post with trimmed text', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadMemoryModule({ post: mockPost });
      const { result } = callHook(mod);

      await result.saveMemory('  hello world  ');
      expect(mockPost).toHaveBeenCalledWith('/teams/team_abc/memory', { text: 'hello world' });
    });

    it('does not call API when text is empty or whitespace', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadMemoryModule({ post: mockPost });
      const { result } = callHook(mod);

      await result.saveMemory('   ');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('does not call API when teamId is falsy', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadMemoryModule({ post: mockPost });
      const { result } = callHook(mod, { teamId: null });

      await result.saveMemory('test');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('flashes info before save and success after', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadMemoryModule({ post: mockPost });
      const flash = vi.fn();
      const { result } = callHook(mod, { flash });

      await result.saveMemory('test memory');
      expect(flash).toHaveBeenCalledWith(expect.stringContaining('Saving'), expect.any(Object));
      expect(flash).toHaveBeenCalledWith(
        expect.stringContaining('Saved'),
        expect.objectContaining({ tone: 'success' }),
      );
    });

    it('flashes error and re-throws on API failure', async () => {
      const apiError = new Error('Server error');
      const mockPost = vi.fn(() => Promise.reject(apiError));
      const { mod } = await loadMemoryModule({ post: mockPost });
      const flash = vi.fn();
      const { result } = callHook(mod, { flash });

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(result.saveMemory('test')).rejects.toThrow('Server error');
      expect(flash).toHaveBeenCalledWith(
        expect.stringContaining('Could not save'),
        expect.objectContaining({ tone: 'error' }),
      );
      spy.mockRestore();
    });

    it('bumps refresh key on successful save', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadMemoryModule({ post: mockPost });
      const bumpRefreshKey = vi.fn();
      const { result } = callHook(mod, { bumpRefreshKey });

      await result.saveMemory('test');
      expect(bumpRefreshKey).toHaveBeenCalledTimes(1);
    });
  });

  // ── onMemorySubmit ───────────────────────────────────

  describe('onMemorySubmit', () => {
    it('clears memoryInput immediately on submit', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadMemoryModule({ post: mockPost });
      const { result } = callHook(mod);

      // Set input text
      result.setMemoryInput('important memory');

      // Submit
      result.onMemorySubmit();

      // Input should be cleared immediately (optimistic clear)
      stateIdx = 0;
      const afterSubmit = mod.useMemoryManager({
        config: { token: 'tok_test' },
        teamId: 'team_abc',
        bumpRefreshKey: vi.fn(),
        flash: vi.fn(),
      });
      expect(afterSubmit.memoryInput).toBe('');
    });

    it('saveMemory re-throws on failure so caller can restore input', async () => {
      // The onMemorySubmit -> saveMemory().catch() chain relies on saveMemory
      // re-throwing the error after flashing it. This test verifies that
      // contract, which is what enables the input restoration.
      const apiError = new Error('Server error');
      const mockPost = vi.fn(() => Promise.reject(apiError));
      const { mod } = await loadMemoryModule({ post: mockPost });
      const flash = vi.fn();
      const { result } = callHook(mod, { flash });

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(result.saveMemory('test input')).rejects.toThrow('Server error');

      // The error flash should fire before the re-throw
      expect(flash).toHaveBeenCalledWith(
        expect.stringContaining('Could not save'),
        expect.objectContaining({ tone: 'error' }),
      );
      spy.mockRestore();
    });
  });

  // ── resetMemorySelection ─────────────────────────────

  describe('resetMemorySelection', () => {
    it('resets selectedIdx to -1 and clears deleteConfirm', async () => {
      const { mod } = await loadMemoryModule();
      const { result } = callHook(mod);

      result.setMemorySelectedIdx(5);
      result.setDeleteConfirm(true);
      result.resetMemorySelection();

      stateIdx = 0;
      const refreshed = mod.useMemoryManager({
        config: { token: 'tok_test' },
        teamId: 'team_abc',
        bumpRefreshKey: vi.fn(),
        flash: vi.fn(),
      });
      expect(refreshed.memorySelectedIdx).toBe(-1);
      expect(refreshed.deleteConfirm).toBe(false);
    });
  });
});
