import { describe, it, expect, vi } from 'vitest';
import { createInputHandler, createCommandHandler } from '../dashboard/input.js';

// ── Helpers to build mock context objects ──────────────

function makeBaseContext(overrides = {}) {
  const { state: stateOverrides, ...rest } = overrides;
  const state = {
    view: 'home',
    mainFocus: 'input',
    selectedIdx: -1,
    focusedAgent: null,
    showDiagnostics: false,
    heroInput: '',
    heroInputActive: false,
    ...stateOverrides,
  };
  return {
    state,
    dispatch: vi.fn(),
    cols: 80,
    error: null,
    context: { members: [] },
    connectionRetry: vi.fn(),
    allVisibleAgents: [],
    liveAgents: [],
    visibleMemories: [],
    hasLiveAgents: false,
    hasMemories: false,
    mainSelectedAgent: null,
    liveAgentNameCounts: new Map(),
    agents: {
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
    integrations: {
      integrationIssues: [],
      repairIntegrations: vi.fn(),
      refreshIntegrationStatuses: vi.fn(),
    },
    composer: {
      composeMode: null,
      composeText: '',
      isComposing: false,
      clearCompose: vi.fn(),
      beginTargetedMessage: vi.fn(),
      beginCommandInput: vi.fn(),
      beginMemorySearch: vi.fn(),
      beginMemoryAdd: vi.fn(),
      setCommandSelectedIdx: vi.fn(),
    },
    memory: {
      memorySelectedIdx: -1,
      setMemorySelectedIdx: vi.fn(),
      deleteConfirm: false,
      setDeleteConfirm: vi.fn(),
      resetMemorySelection: vi.fn(),
      setMemoryInput: vi.fn(),
      deleteMemoryItem: vi.fn(),
    },
    commandSuggestions: [],
    handleCommandSubmit: vi.fn(),
    handleOpenWebDashboard: vi.fn(),
    navigate: vi.fn(),
    ...rest,
  };
}

function key(overrides = {}) {
  return {
    escape: false,
    return: false,
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    tab: false,
    ...overrides,
  };
}

/** Helper: check if dispatch was called with an action matching the given type */
function expectDispatch(ctx, actionType) {
  const calls = ctx.dispatch.mock.calls.map(([action]) => action?.type);
  expect(calls).toContain(actionType);
}

/** Helper: check if dispatch was called with an action matching type and payload */
function expectDispatchWith(ctx, matcher) {
  expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining(matcher));
}

describe('createInputHandler', () => {
  it('handles quit in narrow terminal mode', () => {
    const ctx = makeBaseContext({ cols: 30 });
    const handler = createInputHandler(ctx);
    handler('q', key());
    expect(ctx.navigate).toHaveBeenCalledWith('quit');
  });

  it('ignores non-quit input in narrow terminal mode', () => {
    const ctx = makeBaseContext({ cols: 30 });
    const handler = createInputHandler(ctx);
    handler('r', key());
    expect(ctx.connectionRetry).not.toHaveBeenCalled();
  });

  it('retries connection when error exists and r is pressed', () => {
    const ctx = makeBaseContext({ error: 'connection failed', context: null });
    const handler = createInputHandler(ctx);
    handler('r', key());
    expect(ctx.connectionRetry).toHaveBeenCalled();
  });

  it('retries connection when no context loaded', () => {
    const ctx = makeBaseContext({ context: null });
    const handler = createInputHandler(ctx);
    handler('r', key());
    expect(ctx.connectionRetry).toHaveBeenCalled();
  });

  it('navigates to quit on q key in home view', () => {
    const ctx = makeBaseContext();
    const handler = createInputHandler(ctx);
    handler('q', key());
    expect(ctx.navigate).toHaveBeenCalledWith('quit');
  });

  it('opens tool picker on n key in home view', () => {
    const ctx = makeBaseContext();
    const handler = createInputHandler(ctx);
    handler('n', key());
    expect(ctx.agents.openToolPicker).toHaveBeenCalled();
  });

  it('opens web dashboard on w key', () => {
    const ctx = makeBaseContext();
    const handler = createInputHandler(ctx);
    handler('w', key());
    expect(ctx.handleOpenWebDashboard).toHaveBeenCalled();
  });

  it('begins command input on / key in home view', () => {
    const ctx = makeBaseContext();
    const handler = createInputHandler(ctx);
    handler('/', key());
    expect(ctx.composer.beginCommandInput).toHaveBeenCalledWith('');
  });

  it('navigates down to agents list with down arrow', () => {
    const ctx = makeBaseContext({
      allVisibleAgents: [{ id: 1, _display: 'Test', status: 'running' }],
    });
    const handler = createInputHandler(ctx);
    handler('', key({ downArrow: true }));
    expectDispatch(ctx, 'SET_MAIN_FOCUS');
  });

  it('switches to sessions view when s pressed and agents exist', () => {
    const ctx = makeBaseContext({ hasLiveAgents: true });
    const handler = createInputHandler(ctx);
    handler('s', key());
    expectDispatchWith(ctx, { type: 'NAVIGATE_TO_VIEW', view: 'sessions' });
  });

  it('does not switch to sessions when no agents', () => {
    const ctx = makeBaseContext({ hasLiveAgents: false });
    const handler = createInputHandler(ctx);
    handler('s', key());
    const navCalls = ctx.dispatch.mock.calls.filter(
      ([a]) => a?.type === 'NAVIGATE_TO_VIEW' && a?.view === 'sessions',
    );
    expect(navCalls).toHaveLength(0);
  });

  it('switches to memory view on k key when memories exist', () => {
    const ctx = makeBaseContext({ hasMemories: true });
    const handler = createInputHandler(ctx);
    handler('k', key());
    expectDispatch(ctx, 'NAVIGATE_TO_VIEW');
  });
});

describe('createInputHandler - compose mode', () => {
  it('clears compose on escape', () => {
    const ctx = makeBaseContext({
      composer: {
        ...makeBaseContext().composer,
        isComposing: true,
        composeMode: 'command',
      },
    });
    const handler = createInputHandler(ctx);
    handler('', key({ escape: true }));
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('navigates command suggestions with up/down arrows', () => {
    const ctx = makeBaseContext({
      composer: {
        ...makeBaseContext().composer,
        isComposing: true,
        composeMode: 'command',
      },
      commandSuggestions: [{ name: '/new' }, { name: '/fix' }],
    });
    const handler = createInputHandler(ctx);

    handler('', key({ downArrow: true }));
    expect(ctx.composer.setCommandSelectedIdx).toHaveBeenCalled();

    handler('', key({ upArrow: true }));
    expect(ctx.composer.setCommandSelectedIdx).toHaveBeenCalledTimes(2);
  });
});

describe('createInputHandler - tool picker', () => {
  it('closes tool picker on escape', () => {
    const ctx = makeBaseContext({
      agents: { ...makeBaseContext().agents, toolPickerOpen: true },
    });
    const handler = createInputHandler(ctx);
    handler('', key({ escape: true }));
    expect(ctx.agents.setToolPickerOpen).toHaveBeenCalledWith(false);
  });

  it('selects tool on enter', () => {
    const ctx = makeBaseContext({
      agents: {
        ...makeBaseContext().agents,
        toolPickerOpen: true,
        readyCliAgents: [{ id: 'claude-code', name: 'Claude Code' }],
      },
    });
    const handler = createInputHandler(ctx);
    handler('', key({ return: true }));
    expect(ctx.agents.handleToolPickerSelect).toHaveBeenCalled();
  });
});

describe('createInputHandler - agent focus', () => {
  it('returns to home on escape', () => {
    const ctx = makeBaseContext({ state: { view: 'agent-focus' } });
    const handler = createInputHandler(ctx);
    handler('', key({ escape: true }));
    expectDispatch(ctx, 'EXIT_AGENT_FOCUS');
  });
});

describe('createInputHandler - memory view', () => {
  it('navigates with up/down arrows', () => {
    const ctx = makeBaseContext({
      state: { view: 'memory' },
      visibleMemories: [{ id: '1' }, { id: '2' }],
    });
    const handler = createInputHandler(ctx);
    handler('', key({ downArrow: true }));
    expect(ctx.memory.setMemorySelectedIdx).toHaveBeenCalled();
  });

  it('begins memory search on / key', () => {
    const ctx = makeBaseContext({
      state: { view: 'memory' },
      hasMemories: true,
    });
    const handler = createInputHandler(ctx);
    handler('/', key());
    expect(ctx.composer.beginMemorySearch).toHaveBeenCalled();
  });

  it('begins memory add on a key', () => {
    const ctx = makeBaseContext({ state: { view: 'memory' } });
    const handler = createInputHandler(ctx);
    handler('a', key());
    expect(ctx.composer.beginMemoryAdd).toHaveBeenCalled();
  });

  it('escapes from memory view to home', () => {
    const ctx = makeBaseContext({ state: { view: 'memory' } });
    const handler = createInputHandler(ctx);
    handler('', key({ escape: true }));
    expectDispatchWith(ctx, { type: 'NAVIGATE_TO_VIEW', view: 'home' });
  });

  it('cancels delete confirm on escape', () => {
    const ctx = makeBaseContext({
      state: { view: 'memory' },
      memory: { ...makeBaseContext().memory, deleteConfirm: true },
    });
    const handler = createInputHandler(ctx);
    handler('', key({ escape: true }));
    expect(ctx.memory.setDeleteConfirm).toHaveBeenCalledWith(false);
  });
});

describe('createCommandHandler', () => {
  function makeCommandCtx(overrides = {}) {
    return {
      agents: {
        resolveReadyTool: vi.fn(() => null),
        selectedLaunchTool: null,
        readyCliAgents: [],
        canLaunchSelectedTool: false,
        launchManagedTask: vi.fn(),
        unavailableCliAgents: [],
        getManagedToolState: vi.fn(() => ({})),
        handleFixLauncher: vi.fn(),
        refreshManagedToolStates: vi.fn(),
      },
      integrations: {
        repairIntegrations: vi.fn(),
        refreshIntegrationStatuses: vi.fn(),
        integrationIssues: [],
      },
      composer: {
        clearCompose: vi.fn(),
        beginTargetedMessage: vi.fn(),
      },
      memory: {
        setMemorySelectedIdx: vi.fn(),
        setMemoryInput: vi.fn(),
        onMemorySubmit: vi.fn(),
        resetMemorySelection: vi.fn(),
      },
      flash: vi.fn(),
      dispatch: vi.fn(),
      handleOpenWebDashboard: vi.fn(),
      liveAgents: [],
      selectedAgent: null,
      isAgentAddressable: vi.fn(() => false),
      ...overrides,
    };
  }

  it('handles empty input', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('');
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /help command', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/help');
    expect(ctx.flash).toHaveBeenCalledWith(expect.stringContaining('/new'), expect.any(Object));
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /web command', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/web');
    expect(ctx.handleOpenWebDashboard).toHaveBeenCalled();
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /dashboard command', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/dashboard');
    expect(ctx.handleOpenWebDashboard).toHaveBeenCalled();
  });

  it('handles /knowledge command', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/knowledge');
    expectDispatchWith(ctx, { type: 'NAVIGATE_TO_VIEW', view: 'memory' });
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /memory command (alias)', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/memory');
    expectDispatchWith(ctx, { type: 'NAVIGATE_TO_VIEW', view: 'memory' });
  });

  it('handles /sessions command', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/sessions');
    expectDispatchWith(ctx, { type: 'NAVIGATE_TO_VIEW', view: 'sessions' });
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /agents command (alias for sessions)', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/agents');
    expectDispatchWith(ctx, { type: 'NAVIGATE_TO_VIEW', view: 'sessions' });
  });

  it('handles /history command (alias for sessions)', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/history');
    expectDispatchWith(ctx, { type: 'NAVIGATE_TO_VIEW', view: 'sessions' });
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
  });

  it('handles /refresh command (alias for recheck)', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/refresh');
    expect(ctx.agents.refreshManagedToolStates).toHaveBeenCalled();
  });

  it('handles /repair command', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/repair');
    expect(ctx.integrations.repairIntegrations).toHaveBeenCalled();
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /new command without tool', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('/new');
    expect(ctx.flash).toHaveBeenCalledWith(
      expect.stringContaining('No tools ready'),
      expect.any(Object),
    );
  });

  it('handles /new with a specific tool', () => {
    const tool = { id: 'claude-code', name: 'Claude Code' };
    const ctx = makeCommandCtx({
      agents: {
        ...makeCommandCtx().agents,
        resolveReadyTool: vi.fn(() => tool),
        launchManagedTask: vi.fn(),
      },
    });
    const handler = createCommandHandler(ctx);
    handler('/new claude-code');
    expect(ctx.agents.resolveReadyTool).toHaveBeenCalledWith('claude-code');
    expect(ctx.agents.launchManagedTask).toHaveBeenCalledWith(tool, '');
  });

  it('handles /fix command with launcher fix available', () => {
    const ctx = makeCommandCtx({
      agents: {
        ...makeCommandCtx().agents,
        unavailableCliAgents: [{ id: 'codex', name: 'Codex' }],
        getManagedToolState: vi.fn(() => ({ recoveryCommand: 'codex login' })),
      },
    });
    const handler = createCommandHandler(ctx);
    handler('/fix');
    expect(ctx.agents.handleFixLauncher).toHaveBeenCalled();
  });

  it('handles /fix command without launcher fix - falls back to repair', () => {
    const ctx = makeCommandCtx({
      agents: {
        ...makeCommandCtx().agents,
        unavailableCliAgents: [],
      },
    });
    const handler = createCommandHandler(ctx);
    handler('/fix');
    expect(ctx.integrations.repairIntegrations).toHaveBeenCalled();
  });

  it('handles /message command when agent is addressable', () => {
    const agent = { agent_id: 'test:abc:def', _display: 'Claude Code' };
    const ctx = makeCommandCtx({
      selectedAgent: agent,
      isAgentAddressable: vi.fn(() => true),
    });
    const handler = createCommandHandler(ctx);
    handler('/message');
    expect(ctx.composer.beginTargetedMessage).toHaveBeenCalledWith(agent);
  });

  it('handles /message command when no addressable agent', () => {
    const ctx = makeCommandCtx({
      selectedAgent: null,
      isAgentAddressable: vi.fn(() => false),
    });
    const handler = createCommandHandler(ctx);
    handler('/message');
    expect(ctx.flash).toHaveBeenCalledWith('Select a live agent to message.', expect.any(Object));
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('delegates unrecognized text to launch tool when available', () => {
    const tool = { id: 'claude-code', name: 'Claude Code' };
    const ctx = makeCommandCtx({
      agents: {
        ...makeCommandCtx().agents,
        selectedLaunchTool: tool,
        canLaunchSelectedTool: true,
        launchManagedTask: vi.fn(),
      },
    });
    const handler = createCommandHandler(ctx);
    handler('refactor the auth module');
    expect(ctx.agents.launchManagedTask).toHaveBeenCalledWith(tool, 'refactor the auth module');
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('falls back to hero input when no launch tool available', () => {
    const ctx = makeCommandCtx();
    const handler = createCommandHandler(ctx);
    handler('some text');
    expectDispatchWith(ctx, { type: 'SET_HERO_INPUT' });
    expectDispatchWith(ctx, { type: 'SET_HERO_INPUT_ACTIVE' });
    expectDispatchWith(ctx, { type: 'SET_MAIN_FOCUS' });
  });
});
