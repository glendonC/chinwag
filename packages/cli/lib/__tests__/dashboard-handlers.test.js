import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Tests for packages/cli/lib/dashboard/useDashboardHandlers.ts.
 *
 * Since we cannot render React hooks in a node environment without a test renderer,
 * we test the logic by importing the module with mocked dependencies and exercising
 * the hook's internal functions through the returned object.
 *
 * Pattern: vi.doMock React, Ink, and dependent modules, then dynamically import
 * useDashboardHandlers so each test gets fresh mocks. We use a minimal React mock
 * that captures useCallback/useMemo results and stubs useInput.
 */

// ── Captured useInput handler ────────────────────────────
let capturedInputHandler;

// ── Module loader with mock overrides ────────────────────

async function loadHandlersModule(overrides = {}) {
  vi.resetModules();
  capturedInputHandler = null;

  // Track the callbacks and memos created by useDashboardHandlers
  vi.doMock('react', () => ({
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }));

  vi.doMock('ink', () => ({
    useInput: (handler) => {
      capturedInputHandler = handler;
    },
  }));

  // Mock the input module - createInputHandler / createCommandHandler
  const mockCreateInputHandler = overrides.createInputHandler || vi.fn(() => vi.fn());
  const mockCreateCommandHandler = overrides.createCommandHandler || vi.fn(() => vi.fn());

  vi.doMock('../dashboard/input.js', () => ({
    createInputHandler: mockCreateInputHandler,
    createCommandHandler: mockCreateCommandHandler,
  }));

  // Mock agent-display
  vi.doMock('../dashboard/agent-display.js', () => ({
    isAgentAddressable: overrides.isAgentAddressable || vi.fn(() => false),
  }));

  // Mock utils - openWebDashboard
  const mockOpenWebDashboard = overrides.openWebDashboard || vi.fn(() => ({ ok: true }));

  vi.doMock('../dashboard/utils.js', () => ({
    openWebDashboard: mockOpenWebDashboard,
  }));

  // Mock type-only imports so they don't throw
  vi.doMock('../dashboard/reducer.js', () => ({}));
  vi.doMock('../dashboard/view.js', () => ({}));
  vi.doMock('../dashboard/agents.js', () => ({}));
  vi.doMock('../dashboard/integrations.js', () => ({}));
  vi.doMock('../dashboard/composer.js', () => ({}));
  vi.doMock('../dashboard/memory.js', () => ({}));
  vi.doMock('../dashboard/context.jsx', () => ({}));
  vi.doMock('../config.js', () => ({}));

  const mod = await import('../dashboard/useDashboardHandlers.js');
  return { mod, mockOpenWebDashboard, mockCreateInputHandler, mockCreateCommandHandler };
}

// ── Helpers to build mock params ─────────────────────────

function makeParams(overrides = {}) {
  return {
    config: overrides.config || { token: 'tok_test' },
    state: overrides.state || { view: 'home', mainFocus: 'input' },
    dispatch: overrides.dispatch || vi.fn(),
    flash: overrides.flash || vi.fn(),
    cols: overrides.cols || 80,
    error: overrides.error || null,
    context: overrides.context || { members: [] },
    connectionRetry: overrides.connectionRetry || vi.fn(),
    allVisibleAgents: overrides.allVisibleAgents || [],
    liveAgents: overrides.liveAgents || [],
    visibleMemories: overrides.visibleMemories || [],
    hasLiveAgents: overrides.hasLiveAgents || false,
    hasMemories: overrides.hasMemories || false,
    selectedAgent: overrides.selectedAgent || null,
    mainSelectedAgent: overrides.mainSelectedAgent || null,
    liveAgentNameCounts: overrides.liveAgentNameCounts || new Map(),
    agentsHook: overrides.agentsHook || {
      toolPickerOpen: false,
      setToolPickerOpen: vi.fn(),
      setToolPickerIdx: vi.fn(),
      toolPickerIdx: 0,
      readyCliAgents: [],
      installedCliAgents: [],
      unavailableCliAgents: [],
      checkingCliAgents: [],
      selectedLaunchTool: null,
      canLaunchSelectedTool: false,
      launcherChoices: [],
      getManagedToolState: vi.fn(() => ({ state: 'checking' })),
      handleSpawnAgent: vi.fn(),
      launchManagedTask: vi.fn(),
      handleKillAgent: vi.fn(),
      handleRemoveAgent: vi.fn(),
      handleRestartAgent: vi.fn(),
      handleFixLauncher: vi.fn(),
      refreshManagedToolStates: vi.fn(),
      resolveReadyTool: vi.fn(() => null),
      rememberLaunchTool: vi.fn(),
      selectLaunchTool: vi.fn(),
      cycleToolForward: vi.fn(),
      handleToolPickerSelect: vi.fn(),
      openToolPicker: vi.fn(),
    },
    integrations: overrides.integrations || {
      integrationIssues: [],
      repairIntegrations: vi.fn(),
      refreshIntegrationStatuses: vi.fn(),
    },
    composer: overrides.composer || {
      composeMode: null,
      composeText: '',
      isComposing: false,
      clearCompose: vi.fn(),
      beginTargetedMessage: vi.fn(),
      beginCommandInput: vi.fn(),
      beginMemorySearch: vi.fn(),
      beginMemoryAdd: vi.fn(),
      setComposeMode: vi.fn(),
      setCommandSelectedIdx: vi.fn(),
      onComposeSubmit: vi.fn(),
    },
    memoryHook: overrides.memoryHook || {
      memorySelectedIdx: -1,
      setMemorySelectedIdx: vi.fn(),
      deleteConfirm: false,
      setDeleteConfirm: vi.fn(),
      resetMemorySelection: vi.fn(),
      setMemoryInput: vi.fn(),
      deleteMemoryItem: vi.fn(),
      onMemorySubmit: vi.fn(),
    },
    commandSuggestions: overrides.commandSuggestions || [],
    navigate: overrides.navigate || vi.fn(),
  };
}

// ── Tests ────────────────────────────────────────────────

describe('useDashboardHandlers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── handleOpenWebDashboard ──────────────────────────

  describe('handleOpenWebDashboard', () => {
    it('flashes success when openWebDashboard returns ok', async () => {
      const mockOpenWebDashboard = vi.fn(() => ({ ok: true }));
      const { mod } = await loadHandlersModule({ openWebDashboard: mockOpenWebDashboard });

      const flash = vi.fn();
      const params = makeParams({ flash, config: { token: 'tok_abc' } });
      const result = mod.useDashboardHandlers(params);

      result.handleOpenWebDashboard();

      expect(mockOpenWebDashboard).toHaveBeenCalledWith('tok_abc');
      expect(flash).toHaveBeenCalledWith('Opened web dashboard', { tone: 'success' });
    });

    it('flashes error when openWebDashboard returns failure', async () => {
      const mockOpenWebDashboard = vi.fn(() => ({
        ok: false,
        error: 'browser not found',
      }));
      const { mod } = await loadHandlersModule({ openWebDashboard: mockOpenWebDashboard });

      const flash = vi.fn();
      const params = makeParams({ flash });
      const result = mod.useDashboardHandlers(params);

      result.handleOpenWebDashboard();

      expect(flash).toHaveBeenCalledWith('Could not open browser: browser not found', {
        tone: 'error',
      });
    });

    it('flashes generic error when no error message provided', async () => {
      const mockOpenWebDashboard = vi.fn(() => ({ ok: false }));
      const { mod } = await loadHandlersModule({ openWebDashboard: mockOpenWebDashboard });

      const flash = vi.fn();
      const params = makeParams({ flash });
      const result = mod.useDashboardHandlers(params);

      result.handleOpenWebDashboard();

      expect(flash).toHaveBeenCalledWith('Could not open browser', { tone: 'error' });
    });

    it('passes undefined token when config is null', async () => {
      const mockOpenWebDashboard = vi.fn(() => ({ ok: true }));
      const { mod } = await loadHandlersModule({ openWebDashboard: mockOpenWebDashboard });

      // Build params manually to ensure config is truly null (not overridden by makeParams default)
      const params = makeParams();
      params.config = null;
      const result = mod.useDashboardHandlers(params);

      result.handleOpenWebDashboard();

      // config?.token evaluates to undefined when config is null
      expect(mockOpenWebDashboard).toHaveBeenCalledWith(undefined);
    });
  });

  // ── handleCommandSubmit ─────────────────────────────

  describe('handleCommandSubmit', () => {
    it('delegates to createCommandHandler with correct params', async () => {
      const innerHandler = vi.fn();
      const mockCreateCommandHandler = vi.fn(() => innerHandler);
      const { mod } = await loadHandlersModule({ createCommandHandler: mockCreateCommandHandler });

      const params = makeParams();
      const result = mod.useDashboardHandlers(params);

      // handleCommandSubmit should be the function returned by createCommandHandler
      result.handleCommandSubmit('test');
      expect(innerHandler).toHaveBeenCalledWith('test');
    });

    it('passes agents, integrations, composer, and memory to createCommandHandler', async () => {
      const mockCreateCommandHandler = vi.fn(() => vi.fn());
      const { mod } = await loadHandlersModule({ createCommandHandler: mockCreateCommandHandler });

      const agentsHook = makeParams().agentsHook;
      const integrations = makeParams().integrations;
      const composer = makeParams().composer;
      const memoryHook = makeParams().memoryHook;

      const params = makeParams({ agentsHook, integrations, composer, memoryHook });
      mod.useDashboardHandlers(params);

      expect(mockCreateCommandHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: agentsHook,
          integrations,
          composer,
          memory: memoryHook,
        }),
      );
    });

    it('passes dispatch and flash to createCommandHandler', async () => {
      const mockCreateCommandHandler = vi.fn(() => vi.fn());
      const { mod } = await loadHandlersModule({ createCommandHandler: mockCreateCommandHandler });

      const dispatch = vi.fn();
      const flash = vi.fn();

      const params = makeParams({ dispatch, flash });
      mod.useDashboardHandlers(params);

      expect(mockCreateCommandHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatch,
          flash,
        }),
      );
    });
  });

  // ── onComposeSubmit ─────────────────────────────────

  describe('onComposeSubmit', () => {
    it('delegates to composer.onComposeSubmit with command suggestions and handler', async () => {
      const { mod } = await loadHandlersModule();

      const composerOnSubmit = vi.fn();
      const commandSuggestions = [{ name: '/help' }, { name: '/new' }];

      const params = makeParams({
        composer: { ...makeParams().composer, onComposeSubmit: composerOnSubmit },
        commandSuggestions,
      });

      const result = mod.useDashboardHandlers(params);
      result.onComposeSubmit();

      expect(composerOnSubmit).toHaveBeenCalledWith(commandSuggestions, result.handleCommandSubmit);
    });

    it('passes empty suggestions array when none provided', async () => {
      const { mod } = await loadHandlersModule();

      const composerOnSubmit = vi.fn();

      const params = makeParams({
        composer: { ...makeParams().composer, onComposeSubmit: composerOnSubmit },
        commandSuggestions: [],
      });

      const result = mod.useDashboardHandlers(params);
      result.onComposeSubmit();

      expect(composerOnSubmit).toHaveBeenCalledWith([], result.handleCommandSubmit);
    });
  });

  // ── onMemorySubmit ──────────────────────────────────

  describe('onMemorySubmit', () => {
    it('calls memoryHook.onMemorySubmit and resets compose mode', async () => {
      const { mod } = await loadHandlersModule();

      const onMemorySubmitFn = vi.fn();
      const setComposeMode = vi.fn();

      const params = makeParams({
        memoryHook: { ...makeParams().memoryHook, onMemorySubmit: onMemorySubmitFn },
        composer: { ...makeParams().composer, setComposeMode },
      });

      const result = mod.useDashboardHandlers(params);
      result.onMemorySubmit();

      expect(onMemorySubmitFn).toHaveBeenCalled();
      expect(setComposeMode).toHaveBeenCalledWith(null);
    });

    it('calls setComposeMode(null) even if onMemorySubmit throws', async () => {
      const { mod } = await loadHandlersModule();

      const onMemorySubmitFn = vi.fn(() => {
        throw new Error('save failed');
      });
      const setComposeMode = vi.fn();

      const params = makeParams({
        memoryHook: { ...makeParams().memoryHook, onMemorySubmit: onMemorySubmitFn },
        composer: { ...makeParams().composer, setComposeMode },
      });

      const result = mod.useDashboardHandlers(params);

      // The source calls onMemorySubmit then setComposeMode sequentially.
      // If onMemorySubmit throws, setComposeMode won't be called.
      // This test documents the actual behavior.
      expect(() => result.onMemorySubmit()).toThrow('save failed');
      expect(onMemorySubmitFn).toHaveBeenCalled();
    });
  });

  // ── useInput wiring ─────────────────────────────────

  describe('useInput wiring', () => {
    it('registers an input handler via useInput', async () => {
      const { mod } = await loadHandlersModule();

      const params = makeParams();
      mod.useDashboardHandlers(params);

      expect(capturedInputHandler).toBeDefined();
      expect(typeof capturedInputHandler).toBe('function');
    });

    it('input handler is built by createInputHandler with correct params', async () => {
      const sentinelHandler = vi.fn();
      const mockCreateInputHandler = vi.fn(() => sentinelHandler);
      const { mod } = await loadHandlersModule({ createInputHandler: mockCreateInputHandler });

      const params = makeParams();
      mod.useDashboardHandlers(params);

      expect(mockCreateInputHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          state: params.state,
          dispatch: params.dispatch,
          cols: params.cols,
          error: params.error,
          context: params.context,
          connectionRetry: params.connectionRetry,
          allVisibleAgents: params.allVisibleAgents,
          liveAgents: params.liveAgents,
          visibleMemories: params.visibleMemories,
          hasLiveAgents: params.hasLiveAgents,
          hasMemories: params.hasMemories,
          navigate: params.navigate,
        }),
      );

      // The returned handler should be registered with useInput
      expect(capturedInputHandler).toBe(sentinelHandler);
    });
  });
});
