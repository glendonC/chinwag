import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Tests for packages/cli/lib/dashboard/composer.ts - useComposer hook.
 *
 * Since we cannot render React hooks in a node environment without a test renderer,
 * we test the logic by importing the module with mocked dependencies and exercising
 * the hook's internal functions through the returned object.
 *
 * Pattern: vi.doMock the api module and dependencies, then dynamically import
 * composer.ts so each test gets fresh mocks. We use a minimal React mock that
 * captures hook state.
 */

// ── Minimal hook simulation ────────────────────────────
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

async function loadComposerModule(apiOverrides = {}) {
  vi.resetModules();

  const mockPost = apiOverrides.post || vi.fn(() => Promise.resolve());

  vi.doMock('../api.js', () => ({
    api: () => ({
      post: mockPost,
      get: vi.fn(() => Promise.resolve()),
    }),
  }));

  vi.doMock('react', () => ({
    useState: mockUseState,
    useRef: (initial) => ({ current: initial }),
  }));

  // Mock agent-display so isAgentAddressable and getAgentTargetLabel work
  vi.doMock('../dashboard/agent-display.js', () => ({
    isAgentAddressable: (agent) => {
      if (!agent?.agent_id) return false;
      if (agent._managed) return agent.status === 'running';
      return agent.status === 'active';
    },
    getAgentTargetLabel: (agent) => {
      if (!agent) return 'agent';
      if (agent.handle && agent._display) return `${agent.handle} (${agent._display})`;
      return agent.handle || agent._display || 'agent';
    },
  }));

  // Mock @chinmeister/shared
  vi.doMock('@chinmeister/shared', () => ({
    formatError: (err) => (err instanceof Error ? err.message : String(err)),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  }));

  const mod = await import('../dashboard/composer.js');
  return { mod, mockPost };
}

function callHook(mod, overrides = {}) {
  resetHookSim();
  stateIdx = 0;
  const config = overrides.config || { token: 'tok_test' };
  const teamId = 'teamId' in overrides ? overrides.teamId : 'team_abc';
  const bumpRefreshKey = overrides.bumpRefreshKey || vi.fn();
  const flash = overrides.flash || vi.fn();
  const clearMemorySearch = overrides.clearMemorySearch || vi.fn();
  const clearMemoryInput = overrides.clearMemoryInput || vi.fn();

  const result = mod.useComposer({
    config,
    teamId,
    bumpRefreshKey,
    flash,
    clearMemorySearch,
    clearMemoryInput,
  });
  return { result, config, teamId, bumpRefreshKey, flash, clearMemorySearch, clearMemoryInput };
}

function rereadHook(mod, overrides = {}) {
  stateIdx = 0;
  const config = overrides.config || { token: 'tok_test' };
  const teamId = 'teamId' in overrides ? overrides.teamId : 'team_abc';
  const bumpRefreshKey = overrides.bumpRefreshKey || vi.fn();
  const flash = overrides.flash || vi.fn();
  const clearMemorySearch = overrides.clearMemorySearch || vi.fn();
  const clearMemoryInput = overrides.clearMemoryInput || vi.fn();

  return mod.useComposer({
    config,
    teamId,
    bumpRefreshKey,
    flash,
    clearMemorySearch,
    clearMemoryInput,
  });
}

// ── Tests ──────────────────────────────────────────────

describe('useComposer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Initial state ─────────────────────────────────────

  describe('initial state', () => {
    it('starts with null composeMode', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);
      expect(result.composeMode).toBeNull();
    });

    it('starts with empty composeText', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);
      expect(result.composeText).toBe('');
    });

    it('starts with null composeTarget', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);
      expect(result.composeTarget).toBeNull();
    });

    it('starts with null composeTargetLabel', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);
      expect(result.composeTargetLabel).toBeNull();
    });

    it('starts with commandSelectedIdx of 0', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);
      expect(result.commandSelectedIdx).toBe(0);
    });

    it('starts with isComposing false', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);
      expect(result.isComposing).toBe(false);
    });

    it('starts with isSending false', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);
      expect(result.isSending).toBe(false);
    });
  });

  // ── clearCompose ──────────────────────────────────────

  describe('clearCompose', () => {
    it('resets all compose state to defaults', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      // Set some state first
      result.setComposeMode('command');
      result.setComposeText('hello');

      result.clearCompose();

      const refreshed = rereadHook(mod);
      expect(refreshed.composeMode).toBeNull();
      expect(refreshed.composeText).toBe('');
      expect(refreshed.composeTarget).toBeNull();
      expect(refreshed.composeTargetLabel).toBeNull();
    });

    it('calls clearMemorySearch when clearing from memory-search mode', async () => {
      const { mod } = await loadComposerModule();
      const clearMemorySearch = vi.fn();
      const { result } = callHook(mod, { clearMemorySearch });

      // Enter memory-search mode
      result.beginMemorySearch();
      // Re-read hook so clearCompose picks up the updated composeMode
      const afterBegin = rereadHook(mod, { clearMemorySearch });
      afterBegin.clearCompose();

      expect(clearMemorySearch).toHaveBeenCalled();
    });

    it('calls clearMemoryInput when clearing from memory-add mode', async () => {
      const { mod } = await loadComposerModule();
      const clearMemoryInput = vi.fn();
      const { result } = callHook(mod, { clearMemoryInput });

      // Enter memory-add mode
      result.beginMemoryAdd();
      // Re-read hook so clearCompose picks up the updated composeMode
      const afterBegin = rereadHook(mod, { clearMemoryInput });
      afterBegin.clearCompose();

      expect(clearMemoryInput).toHaveBeenCalled();
    });

    it('does not call clearMemorySearch when clearing from command mode', async () => {
      const { mod } = await loadComposerModule();
      const clearMemorySearch = vi.fn();
      const { result } = callHook(mod, { clearMemorySearch });

      result.setComposeMode('command');
      result.clearCompose();

      expect(clearMemorySearch).not.toHaveBeenCalled();
    });

    it('does not call clearMemoryInput when clearing from targeted mode', async () => {
      const { mod } = await loadComposerModule();
      const clearMemoryInput = vi.fn();
      const { result } = callHook(mod, { clearMemoryInput });

      result.setComposeMode('targeted');
      result.clearCompose();

      expect(clearMemoryInput).not.toHaveBeenCalled();
    });
  });

  // ── beginCommandInput ─────────────────────────────────

  describe('beginCommandInput', () => {
    it('sets mode to command', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginCommandInput();

      const refreshed = rereadHook(mod);
      expect(refreshed.composeMode).toBe('command');
    });

    it('sets initial text when provided', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginCommandInput('new');

      const refreshed = rereadHook(mod);
      expect(refreshed.composeText).toBe('new');
    });

    it('defaults to empty text when no argument given', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginCommandInput();

      const refreshed = rereadHook(mod);
      expect(refreshed.composeText).toBe('');
    });

    it('resets commandSelectedIdx to 0', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      // Move the index first
      result.setCommandSelectedIdx(3);
      result.beginCommandInput('test');

      const refreshed = rereadHook(mod);
      expect(refreshed.commandSelectedIdx).toBe(0);
    });

    it('makes isComposing true', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginCommandInput();

      const refreshed = rereadHook(mod);
      expect(refreshed.isComposing).toBe(true);
    });
  });

  // ── beginTargetedMessage ──────────────────────────────

  describe('beginTargetedMessage', () => {
    it('sets mode to targeted for addressable agent', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      const agent = { agent_id: 'a:b:c', _managed: true, status: 'running', _display: 'Claude' };
      result.beginTargetedMessage(agent);

      const refreshed = rereadHook(mod);
      expect(refreshed.composeMode).toBe('targeted');
    });

    it('sets composeTarget to agent_id', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      const agent = {
        agent_id: 'agent_123',
        _managed: true,
        status: 'running',
        _display: 'Claude',
      };
      result.beginTargetedMessage(agent);

      const refreshed = rereadHook(mod);
      expect(refreshed.composeTarget).toBe('agent_123');
    });

    it('sets composeTargetLabel from agent display', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      const agent = {
        agent_id: 'agent_123',
        _managed: true,
        status: 'running',
        _display: 'Claude Code',
        handle: 'dev1',
      };
      result.beginTargetedMessage(agent);

      const refreshed = rereadHook(mod);
      expect(refreshed.composeTargetLabel).toBe('dev1 (Claude Code)');
    });

    it('clears composeText when opening targeted mode', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.setComposeText('old text');
      const agent = { agent_id: 'a', _managed: true, status: 'running', _display: 'Agent' };
      result.beginTargetedMessage(agent);

      const refreshed = rereadHook(mod);
      expect(refreshed.composeText).toBe('');
    });

    it('flashes warning for non-addressable agent', async () => {
      const { mod } = await loadComposerModule();
      const flash = vi.fn();
      const { result } = callHook(mod, { flash });

      const agent = { agent_id: 'a', _managed: true, status: 'idle', _display: 'Claude' };
      result.beginTargetedMessage(agent);

      expect(flash).toHaveBeenCalledWith(
        expect.stringContaining('running agent'),
        expect.objectContaining({ tone: 'warning' }),
      );

      // Should not enter targeted mode
      const refreshed = rereadHook(mod);
      expect(refreshed.composeMode).toBeNull();
    });

    it('flashes warning for agent without agent_id', async () => {
      const { mod } = await loadComposerModule();
      const flash = vi.fn();
      const { result } = callHook(mod, { flash });

      const agent = { _managed: true, status: 'running', _display: 'Claude' };
      result.beginTargetedMessage(agent);

      expect(flash).toHaveBeenCalledWith(
        expect.stringContaining('running agent'),
        expect.objectContaining({ tone: 'warning' }),
      );
    });
  });

  // ── beginMemorySearch ─────────────────────────────────

  describe('beginMemorySearch', () => {
    it('sets mode to memory-search', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginMemorySearch();

      const refreshed = rereadHook(mod);
      expect(refreshed.composeMode).toBe('memory-search');
    });

    it('makes isComposing true', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginMemorySearch();

      const refreshed = rereadHook(mod);
      expect(refreshed.isComposing).toBe(true);
    });
  });

  // ── beginMemoryAdd ────────────────────────────────────

  describe('beginMemoryAdd', () => {
    it('sets mode to memory-add', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginMemoryAdd();

      const refreshed = rereadHook(mod);
      expect(refreshed.composeMode).toBe('memory-add');
    });

    it('makes isComposing true', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginMemoryAdd();

      const refreshed = rereadHook(mod);
      expect(refreshed.isComposing).toBe(true);
    });
  });

  // ── setCommandSelectedIdx ─────────────────────────────

  describe('setCommandSelectedIdx', () => {
    it('updates the command selected index', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.setCommandSelectedIdx(3);

      const refreshed = rereadHook(mod);
      expect(refreshed.commandSelectedIdx).toBe(3);
    });

    it('supports functional updater', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.setCommandSelectedIdx(2);
      // Re-read to apply update, then use functional updater
      const after = rereadHook(mod);
      after.setCommandSelectedIdx((prev) => prev + 1);

      const final = rereadHook(mod);
      expect(final.commandSelectedIdx).toBe(3);
    });
  });

  // ── State transitions: null -> various modes ──────────

  describe('state transitions', () => {
    it('transitions null -> command -> null', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      expect(result.composeMode).toBeNull();

      result.beginCommandInput('test');
      const afterBegin = rereadHook(mod);
      expect(afterBegin.composeMode).toBe('command');

      afterBegin.clearCompose();
      const afterClear = rereadHook(mod);
      expect(afterClear.composeMode).toBeNull();
    });

    it('transitions null -> targeted -> null', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      const agent = { agent_id: 'a', _managed: true, status: 'running', _display: 'A' };
      result.beginTargetedMessage(agent);
      const afterBegin = rereadHook(mod);
      expect(afterBegin.composeMode).toBe('targeted');

      afterBegin.clearCompose();
      const afterClear = rereadHook(mod);
      expect(afterClear.composeMode).toBeNull();
    });

    it('transitions null -> memory-search -> null', async () => {
      const { mod } = await loadComposerModule();
      const clearMemorySearch = vi.fn();
      const { result } = callHook(mod, { clearMemorySearch });

      result.beginMemorySearch();
      const afterBegin = rereadHook(mod, { clearMemorySearch });
      expect(afterBegin.composeMode).toBe('memory-search');

      afterBegin.clearCompose();
      const afterClear = rereadHook(mod, { clearMemorySearch });
      expect(afterClear.composeMode).toBeNull();
      expect(clearMemorySearch).toHaveBeenCalled();
    });

    it('transitions null -> memory-add -> null', async () => {
      const { mod } = await loadComposerModule();
      const clearMemoryInput = vi.fn();
      const { result } = callHook(mod, { clearMemoryInput });

      result.beginMemoryAdd();
      const afterBegin = rereadHook(mod, { clearMemoryInput });
      expect(afterBegin.composeMode).toBe('memory-add');

      afterBegin.clearCompose();
      const afterClear = rereadHook(mod, { clearMemoryInput });
      expect(afterClear.composeMode).toBeNull();
      expect(clearMemoryInput).toHaveBeenCalled();
    });
  });

  // ── sendMessage ───────────────────────────────────────

  describe('sendMessage', () => {
    it('calls API post with correct path and body', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadComposerModule({ post: mockPost });
      const bumpRefreshKey = vi.fn();
      const flash = vi.fn();
      const { result } = callHook(mod, { bumpRefreshKey, flash });

      await result.sendMessage('hello world', null);
      expect(mockPost).toHaveBeenCalledWith('/teams/team_abc/messages', {
        text: 'hello world',
        target: undefined,
      });
    });

    it('includes target when provided', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadComposerModule({ post: mockPost });
      const flash = vi.fn();
      const { result } = callHook(mod, { flash });

      await result.sendMessage('hello', 'agent_123', 'Claude Code');
      expect(mockPost).toHaveBeenCalledWith('/teams/team_abc/messages', {
        text: 'hello',
        target: 'agent_123',
      });
    });

    it('trims message text', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadComposerModule({ post: mockPost });
      const flash = vi.fn();
      const { result } = callHook(mod, { flash });

      await result.sendMessage('  hello  ', null);
      expect(mockPost).toHaveBeenCalledWith('/teams/team_abc/messages', {
        text: 'hello',
        target: undefined,
      });
    });

    it('flashes success message on send', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadComposerModule({ post: mockPost });
      const flash = vi.fn();
      const { result } = callHook(mod, { flash });

      await result.sendMessage('hello', null);
      expect(flash).toHaveBeenCalledWith(
        expect.stringContaining('Sent to team'),
        expect.objectContaining({ tone: 'success' }),
      );
    });

    it('flashes targeted success message when targetLabel provided', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadComposerModule({ post: mockPost });
      const flash = vi.fn();
      const { result } = callHook(mod, { flash });

      await result.sendMessage('hello', 'agent_123', 'Claude Code');
      expect(flash).toHaveBeenCalledWith(
        expect.stringContaining('Sent to Claude Code'),
        expect.objectContaining({ tone: 'success' }),
      );
    });

    it('bumps refresh key on success', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadComposerModule({ post: mockPost });
      const bumpRefreshKey = vi.fn();
      const flash = vi.fn();
      const { result } = callHook(mod, { bumpRefreshKey, flash });

      await result.sendMessage('hello', null);
      expect(bumpRefreshKey).toHaveBeenCalled();
    });

    it('rejects when config has no token', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadComposerModule({ post: mockPost });
      const flash = vi.fn();
      const { result } = callHook(mod, { config: { token: null }, flash });

      await expect(result.sendMessage('hello', null)).rejects.toBeUndefined();
      expect(flash).toHaveBeenCalledWith(
        expect.stringContaining('Not signed in'),
        expect.objectContaining({ tone: 'error' }),
      );
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('rejects when teamId is falsy', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadComposerModule({ post: mockPost });
      const flash = vi.fn();
      const { result } = callHook(mod, { teamId: null, flash });

      await expect(result.sendMessage('hello', null)).rejects.toBeUndefined();
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('rejects when text is empty/whitespace', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadComposerModule({ post: mockPost });
      const flash = vi.fn();
      const { result } = callHook(mod, { flash });

      await expect(result.sendMessage('   ', null)).rejects.toBeUndefined();
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('flashes error on API failure', async () => {
      const apiError = new Error('Network error');
      const mockPost = vi.fn(() => Promise.reject(apiError));
      const { mod } = await loadComposerModule({ post: mockPost });
      const flash = vi.fn();
      const { result } = callHook(mod, { flash });

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(result.sendMessage('hello', null)).rejects.toThrow('Network error');
      expect(flash).toHaveBeenCalledWith(
        expect.stringContaining('Send failed'),
        expect.objectContaining({ tone: 'error' }),
      );
      spy.mockRestore();
    });
  });

  // ── onComposeSubmit ───────────────────────────────────

  describe('onComposeSubmit', () => {
    it('dispatches to handleCommandSubmit in command mode with selected suggestion', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginCommandInput('');
      const afterBegin = rereadHook(mod);

      const handleCommandSubmit = vi.fn();
      const suggestions = [{ name: 'new' }, { name: 'doctor' }];
      afterBegin.onComposeSubmit(suggestions, handleCommandSubmit);

      expect(handleCommandSubmit).toHaveBeenCalledWith('new');
    });

    it('dispatches to handleCommandSubmit with composeText when no suggestions', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginCommandInput('');
      result.setComposeText('custom');
      const afterBegin = rereadHook(mod);

      const handleCommandSubmit = vi.fn();
      afterBegin.onComposeSubmit([], handleCommandSubmit);

      expect(handleCommandSubmit).toHaveBeenCalledWith('custom');
    });

    it('uses commandSelectedIdx for suggestion selection in command mode', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginCommandInput('');
      result.setCommandSelectedIdx(1);
      const afterBegin = rereadHook(mod);

      const handleCommandSubmit = vi.fn();
      const suggestions = [{ name: 'new' }, { name: 'doctor' }, { name: 'fix' }];
      afterBegin.onComposeSubmit(suggestions, handleCommandSubmit);

      expect(handleCommandSubmit).toHaveBeenCalledWith('doctor');
    });

    it('calls sendMessage and clearCompose in targeted mode', async () => {
      const mockPost = vi.fn(() => Promise.resolve());
      const { mod } = await loadComposerModule({ post: mockPost });
      const flash = vi.fn();
      const bumpRefreshKey = vi.fn();
      const { result } = callHook(mod, { flash, bumpRefreshKey });

      // Set up targeted compose state
      const agent = { agent_id: 'agent_1', _managed: true, status: 'running', _display: 'Claude' };
      result.beginTargetedMessage(agent);
      const afterTarget = rereadHook(mod, { flash, bumpRefreshKey });
      afterTarget.setComposeText('hello agent');
      const afterText = rereadHook(mod, { flash, bumpRefreshKey });

      const handleCommandSubmit = vi.fn();
      afterText.onComposeSubmit([], handleCommandSubmit);

      // Should not call handleCommandSubmit (not in command mode)
      expect(handleCommandSubmit).not.toHaveBeenCalled();
      // Should call sendMessage via API
      await Promise.resolve();
      expect(mockPost).toHaveBeenCalledWith('/teams/team_abc/messages', {
        text: 'hello agent',
        target: 'agent_1',
      });
    });
  });

  // ── isComposing derived state ─────────────────────────

  describe('isComposing', () => {
    it('is false when composeMode is null', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);
      expect(result.isComposing).toBe(false);
    });

    it('is true when composeMode is command', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginCommandInput();
      const refreshed = rereadHook(mod);
      expect(refreshed.isComposing).toBe(true);
    });

    it('is true when composeMode is targeted', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      const agent = { agent_id: 'a', _managed: true, status: 'running', _display: 'A' };
      result.beginTargetedMessage(agent);
      const refreshed = rereadHook(mod);
      expect(refreshed.isComposing).toBe(true);
    });

    it('is true when composeMode is memory-search', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginMemorySearch();
      const refreshed = rereadHook(mod);
      expect(refreshed.isComposing).toBe(true);
    });

    it('is true when composeMode is memory-add', async () => {
      const { mod } = await loadComposerModule();
      const { result } = callHook(mod);

      result.beginMemoryAdd();
      const refreshed = rereadHook(mod);
      expect(refreshed.isComposing).toBe(true);
    });
  });
});
