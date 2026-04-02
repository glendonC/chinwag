import { describe, expect, it, vi } from 'vitest';
import { createInputHandler, createCommandHandler } from '../dashboard/input.js';

function makeKey(overrides = {}) {
  return {
    escape: false,
    return: false,
    upArrow: false,
    downArrow: false,
    ...overrides,
  };
}

function makeComposer(overrides = {}) {
  return {
    isComposing: false,
    composeMode: null,
    composeText: '',
    clearCompose: vi.fn(),
    beginCommandInput: vi.fn(),
    beginTargetedMessage: vi.fn(),
    beginMemorySearch: vi.fn(),
    beginMemoryAdd: vi.fn(),
    setCommandSelectedIdx: vi.fn(),
    setComposeText: vi.fn(),
    ...overrides,
  };
}

function makeAgents(overrides = {}) {
  return {
    toolPickerOpen: false,
    setToolPickerOpen: vi.fn(),
    toolPickerIdx: 0,
    setToolPickerIdx: vi.fn(),
    handleToolPickerSelect: vi.fn(),
    openToolPicker: vi.fn(),
    handleKillAgent: vi.fn(),
    handleRemoveAgent: vi.fn(),
    handleRestartAgent: vi.fn(),
    handleFixLauncher: vi.fn(),
    refreshManagedToolStates: vi.fn(),
    readyCliAgents: [],
    installedCliAgents: [],
    unavailableCliAgents: [],
    getManagedToolState: vi.fn(() => ({})),
    selectedLaunchTool: null,
    canLaunchSelectedTool: false,
    resolveReadyTool: vi.fn(),
    launchManagedTask: vi.fn(),
    ...overrides,
  };
}

function makeMemory(overrides = {}) {
  return {
    resetMemorySelection: vi.fn(),
    setMemoryInput: vi.fn(),
    deleteMemoryItem: vi.fn(),
    ...overrides,
  };
}

function makeIntegrations(overrides = {}) {
  return {
    integrationIssues: [],
    repairIntegrations: vi.fn(),
    refreshIntegrationStatuses: vi.fn(),
    ...overrides,
  };
}

/**
 * Build context matching the createInputHandler signature.
 * State properties (view, mainFocus, selectedIdx, etc.) go into the `state` object.
 * A `dispatch` spy is provided for asserting dispatched actions.
 */
function makeCtx(overrides = {}) {
  const {
    // Pull state-level fields out of overrides
    view = 'home',
    mainFocus = 'input',
    selectedIdx = -1,
    focusedAgent = null,
    composeMode = null,
    deleteConfirm = false,
    memorySelectedIdx = -1,
    ...rest
  } = overrides;

  const state = {
    view,
    mainFocus,
    selectedIdx,
    focusedAgent,
    composeMode,
    deleteConfirm,
    memorySelectedIdx,
  };

  const base = {
    state,
    dispatch: vi.fn(),
    cols: 120,
    error: null,
    context: {},
    connectionRetry: vi.fn(),
    allVisibleAgents: [],
    liveAgents: [],
    visibleMemories: [],
    hasLiveAgents: false,
    hasMemories: false,
    mainSelectedAgent: null,
    liveAgentNameCounts: new Map(),
    agents: makeAgents(),
    integrations: makeIntegrations(),
    composer: makeComposer(),
    memory: makeMemory(),
    commandSuggestions: [],
    handleCommandSubmit: vi.fn(),
    handleOpenWebDashboard: vi.fn(),
    navigate: vi.fn(),
    ...rest,
  };
  return base;
}

describe('createInputHandler', () => {
  // ── Narrow terminal guard ─────────────────────────

  describe('narrow terminal guard', () => {
    it('only allows q when terminal too narrow', () => {
      const ctx = makeCtx({ cols: 30 });
      const handler = createInputHandler(ctx);
      handler('q', makeKey());
      expect(ctx.navigate).toHaveBeenCalledWith('quit');
    });

    it('ignores non-q input when terminal too narrow', () => {
      const ctx = makeCtx({ cols: 30 });
      const handler = createInputHandler(ctx);
      handler('n', makeKey());
      expect(ctx.navigate).not.toHaveBeenCalled();
    });
  });

  // ── Connection retry ──────────────────────────────

  describe('connection retry', () => {
    it('retries on r when error is set', () => {
      const ctx = makeCtx({ error: 'Some error', context: null });
      const handler = createInputHandler(ctx);
      handler('r', makeKey());
      expect(ctx.connectionRetry).toHaveBeenCalled();
    });

    it('retries on r when context is null', () => {
      const ctx = makeCtx({ error: null, context: null });
      const handler = createInputHandler(ctx);
      handler('r', makeKey());
      expect(ctx.connectionRetry).toHaveBeenCalled();
    });
  });

  // ── Agent focus view ──────────────────────────────

  describe('agent-focus view', () => {
    it('exits on escape', () => {
      const ctx = makeCtx({ view: 'agent-focus' });
      const handler = createInputHandler(ctx);
      handler('', makeKey({ escape: true }));
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'NAVIGATE_BACK' });
    });

    it('kills managed agent on x', () => {
      const focusedAgent = { _managed: true, _dead: false, id: 1 };
      const ctx = makeCtx({ view: 'agent-focus', focusedAgent });
      const handler = createInputHandler(ctx);
      handler('x', makeKey());
      expect(ctx.agents.handleKillAgent).toHaveBeenCalledWith(
        focusedAgent,
        ctx.liveAgentNameCounts,
      );
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'NAVIGATE_BACK' });
    });

    it('removes dead managed agent on x', () => {
      const focusedAgent = { _managed: true, _dead: true, id: 1 };
      const agents = makeAgents({ handleRemoveAgent: vi.fn(() => true) });
      const ctx = makeCtx({ view: 'agent-focus', focusedAgent, agents });
      const handler = createInputHandler(ctx);
      handler('x', makeKey());
      expect(agents.handleRemoveAgent).toHaveBeenCalledWith(focusedAgent, ctx.liveAgentNameCounts);
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'NAVIGATE_BACK' });
    });

    it('restarts dead agent on r', () => {
      const focusedAgent = { _managed: true, _dead: true, id: 1 };
      const agents = makeAgents({ handleRestartAgent: vi.fn(() => true) });
      const ctx = makeCtx({ view: 'agent-focus', focusedAgent, agents });
      const handler = createInputHandler(ctx);
      handler('r', makeKey());
      expect(agents.handleRestartAgent).toHaveBeenCalledWith(focusedAgent);
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'NAVIGATE_BACK' });
    });

    it('toggles diagnostics on l for managed agent', () => {
      const focusedAgent = { _managed: true, _dead: false, id: 1 };
      const ctx = makeCtx({ view: 'agent-focus', focusedAgent });
      const handler = createInputHandler(ctx);
      handler('l', makeKey());
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_DIAGNOSTICS' });
    });
  });

  // ── Compose mode ──────────────────────────────────

  describe('compose mode', () => {
    it('clears compose on escape', () => {
      const composer = makeComposer({ isComposing: true, composeMode: 'command' });
      const ctx = makeCtx({ composeMode: 'command', composer });
      const handler = createInputHandler(ctx);
      handler('', makeKey({ escape: true }));
      expect(composer.clearCompose).toHaveBeenCalled();
    });

    it('navigates suggestions with arrows in command mode', () => {
      const composer = makeComposer({ isComposing: true, composeMode: 'command' });
      const ctx = makeCtx({ composeMode: 'command', composer });
      const handler = createInputHandler(ctx);
      handler('', makeKey({ downArrow: true }));
      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'COMMAND_SELECT_DOWN' }),
      );
    });
  });

  // ── Tool picker ───────────────────────────────────

  describe('tool picker', () => {
    it('closes on escape', () => {
      const agents = makeAgents({ toolPickerOpen: true });
      const ctx = makeCtx({ agents });
      const handler = createInputHandler(ctx);
      handler('', makeKey({ escape: true }));
      expect(agents.setToolPickerOpen).toHaveBeenCalledWith(false);
    });

    it('selects on return', () => {
      const agents = makeAgents({
        toolPickerOpen: true,
        toolPickerIdx: 0,
        readyCliAgents: [{ id: 'tool1' }],
      });
      const ctx = makeCtx({ agents });
      const handler = createInputHandler(ctx);
      handler('', makeKey({ return: true }));
      expect(agents.handleToolPickerSelect).toHaveBeenCalledWith(0);
    });
  });

  // ── Home view ─────────────────────────────────────

  describe('home view', () => {
    it('opens tool picker on n', () => {
      const ctx = makeCtx({ view: 'home' });
      const handler = createInputHandler(ctx);
      handler('n', makeKey());
      expect(ctx.agents.openToolPicker).toHaveBeenCalled();
    });

    it('navigates down to agents list', () => {
      const agent = { _display: 'Claude Code', agent_id: 'test' };
      const ctx = makeCtx({
        view: 'home',
        mainFocus: 'input',
        allVisibleAgents: [agent],
      });
      const handler = createInputHandler(ctx);
      handler('', makeKey({ downArrow: true }));
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'SET_MAIN_FOCUS', focus: 'agents' });
    });

    it('navigates up from agents to input', () => {
      const ctx = makeCtx({
        view: 'home',
        mainFocus: 'agents',
        selectedIdx: 0,
        allVisibleAgents: [{ _display: 'test' }],
      });
      const handler = createInputHandler(ctx);
      handler('', makeKey({ upArrow: true }));
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'SET_MAIN_FOCUS', focus: 'input' });
    });

    it('enters agent focus on return when agent selected', () => {
      const agent = { _display: 'Claude Code', _managed: true };
      const ctx = makeCtx({
        view: 'home',
        mainSelectedAgent: agent,
      });
      const handler = createInputHandler(ctx);
      handler('', makeKey({ return: true }));
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'FOCUS_AGENT', agent });
    });
  });

  // ── Global shortcuts ──────────────────────────────

  describe('global shortcuts', () => {
    it('quits on q', () => {
      const ctx = makeCtx();
      const handler = createInputHandler(ctx);
      handler('q', makeKey());
      expect(ctx.navigate).toHaveBeenCalledWith('quit');
    });

    it('opens web dashboard on w', () => {
      const ctx = makeCtx();
      const handler = createInputHandler(ctx);
      handler('w', makeKey());
      expect(ctx.handleOpenWebDashboard).toHaveBeenCalled();
    });

    it('opens command palette on /', () => {
      const ctx = makeCtx({ view: 'home' });
      const handler = createInputHandler(ctx);
      handler('/', makeKey());
      expect(ctx.composer.beginCommandInput).toHaveBeenCalledWith('');
    });

    it('opens memory search on / in memory view', () => {
      const ctx = makeCtx({ view: 'memory' });
      const handler = createInputHandler(ctx);
      handler('/', makeKey());
      expect(ctx.composer.beginMemorySearch).toHaveBeenCalled();
    });

    it('toggles memory view on k when memories exist', () => {
      const ctx = makeCtx({ view: 'home', hasMemories: true });
      const handler = createInputHandler(ctx);
      handler('k', makeKey());
      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'NAVIGATE_TO_VIEW', view: 'memory' }),
      );
    });

    it('navigates to sessions on s when live agents exist', () => {
      const ctx = makeCtx({ view: 'home', hasLiveAgents: true });
      const handler = createInputHandler(ctx);
      handler('s', makeKey());
      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'NAVIGATE_TO_VIEW', view: 'sessions' }),
      );
    });
  });

  // ── Memory view ───────────────────────────────────

  describe('memory view', () => {
    it('navigates list with arrows', () => {
      const memory = makeMemory();
      const ctx = makeCtx({
        view: 'memory',
        visibleMemories: [{ id: 1 }, { id: 2 }],
        memory,
      });
      const handler = createInputHandler(ctx);
      handler('', makeKey({ downArrow: true }));
      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'MEMORY_SELECT_DOWN' }),
      );
    });

    it('goes back on escape', () => {
      const ctx = makeCtx({ view: 'memory' });
      const handler = createInputHandler(ctx);
      handler('', makeKey({ escape: true }));
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'NAVIGATE_TO_VIEW', view: 'home' });
    });

    it('cancels delete confirm on escape before back', () => {
      const ctx = makeCtx({ view: 'memory', deleteConfirm: true });
      const handler = createInputHandler(ctx);
      handler('', makeKey({ escape: true }));
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'SET_DELETE_CONFIRM', confirm: false });
      // Should NOT navigate away
      expect(ctx.dispatch).not.toHaveBeenCalledWith({ type: 'NAVIGATE_TO_VIEW', view: 'home' });
    });

    it('begins memory add on a', () => {
      const ctx = makeCtx({ view: 'memory' });
      const handler = createInputHandler(ctx);
      handler('a', makeKey());
      expect(ctx.composer.beginMemoryAdd).toHaveBeenCalled();
    });

    it('initiates delete on d with selected memory', () => {
      const ctx = makeCtx({ view: 'memory', memorySelectedIdx: 0 });
      const handler = createInputHandler(ctx);
      handler('d', makeKey());
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'SET_DELETE_CONFIRM', confirm: true });
    });
  });

  // ── Sessions view ─────────────────────────────────

  describe('sessions view', () => {
    it('goes back on escape', () => {
      const ctx = makeCtx({ view: 'sessions' });
      const handler = createInputHandler(ctx);
      handler('', makeKey({ escape: true }));
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'NAVIGATE_TO_VIEW', view: 'home' });
    });
  });
});

// ── createCommandHandler tests ──────────────────────

describe('createCommandHandler', () => {
  function makeCommandCtx(overrides = {}) {
    return {
      agents: makeAgents(),
      integrations: makeIntegrations(),
      composer: makeComposer(),
      memory: makeMemory(),
      flash: vi.fn(),
      dispatch: vi.fn(),
      handleOpenWebDashboard: vi.fn(),
      liveAgents: [],
      selectedAgent: null,
      isAgentAddressable: vi.fn(() => false),
      ...overrides,
    };
  }

  it('clears compose on empty input', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('');
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /new command', () => {
    const tool = { id: 'claude-code', name: 'Claude Code' };
    const agents = makeAgents({
      selectedLaunchTool: tool,
      readyCliAgents: [tool],
      launchManagedTask: vi.fn(),
    });
    const ctx = makeCommandCtx({ agents });
    const handler = createCommandHandler(ctx);
    handler('/new');
    expect(agents.launchManagedTask).toHaveBeenCalled();
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /knowledge command', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/knowledge');
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'NAVIGATE_TO_VIEW', view: 'memory' });
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'RESET_MEMORY_SELECTION' });
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /sessions command', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/sessions');
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NAVIGATE_TO_VIEW', view: 'sessions' }),
    );
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /web command', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/web');
    expect(ctx.handleOpenWebDashboard).toHaveBeenCalled();
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /help command', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/help');
    expect(ctx.flash).toHaveBeenCalled();
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /doctor command', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/doctor');
    expect(ctx.integrations.refreshIntegrationStatuses).toHaveBeenCalledWith({ showFlash: true });
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /recheck command', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/recheck');
    expect(ctx.agents.refreshManagedToolStates).toHaveBeenCalledWith({
      clearRuntimeFailures: true,
    });
    expect(ctx.integrations.refreshIntegrationStatuses).toHaveBeenCalledWith({ showFlash: true });
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('falls through to task launch for unknown commands when tool ready', () => {
    const tool = { id: 'claude-code', name: 'Claude Code' };
    const agents = makeAgents({
      selectedLaunchTool: tool,
      canLaunchSelectedTool: true,
      launchManagedTask: vi.fn(),
    });
    const ctx = makeCommandCtx({ agents });
    const handler = createCommandHandler(ctx);
    handler('build the auth flow');
    expect(agents.launchManagedTask).toHaveBeenCalledWith(tool, 'build the auth flow');
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('sets hero input when no tool available for unknown text', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('some text');
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: 'SET_HERO_INPUT',
      text: 'some text',
      active: true,
    });
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'SET_MAIN_FOCUS', focus: 'input' });
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });
});
