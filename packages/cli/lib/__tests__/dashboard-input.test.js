import { describe, expect, it, vi, beforeEach } from 'vitest';
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

function createMockContext(overrides = {}) {
  const {
    view = 'home',
    mainFocus = 'input',
    selectedIdx = -1,
    focusedAgent = null,
    showDiagnostics = false,
    ...rest
  } = overrides;

  return {
    state: {
      view,
      mainFocus,
      selectedIdx,
      focusedAgent,
      showDiagnostics,
    },
    dispatch: vi.fn(),
    cols: 80,
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
    agents: {
      toolPickerOpen: false,
      setToolPickerOpen: vi.fn(),
      toolPickerIdx: 0,
      setToolPickerIdx: vi.fn(),
      readyCliAgents: [],
      installedCliAgents: [],
      unavailableCliAgents: [],
      openToolPicker: vi.fn(),
      handleKillAgent: vi.fn(),
      handleRemoveAgent: vi.fn(),
      handleRestartAgent: vi.fn(),
      handleFixLauncher: vi.fn(),
      getManagedToolState: vi.fn(() => ({})),
      selectedLaunchTool: null,
      canLaunchSelectedTool: false,
      launchManagedTask: vi.fn(),
      resolveReadyTool: vi.fn(),
      refreshManagedToolStates: vi.fn(),
      handleToolPickerSelect: vi.fn(),
      handleSpawnAgent: vi.fn(),
    },
    integrations: {
      integrationIssues: [],
      repairIntegrations: vi.fn(),
      refreshIntegrationStatuses: vi.fn(),
    },
    composer: {
      isComposing: false,
      composeMode: null,
      composeText: '',
      clearCompose: vi.fn(),
      beginTargetedMessage: vi.fn(),
      beginCommandInput: vi.fn(),
      beginMemorySearch: vi.fn(),
      beginMemoryAdd: vi.fn(),
      setCommandSelectedIdx: vi.fn(),
      onComposeSubmit: vi.fn(),
    },
    memory: {
      memorySelectedIdx: -1,
      setMemorySelectedIdx: vi.fn(),
      deleteConfirm: false,
      setDeleteConfirm: vi.fn(),
      deleteMemoryItem: vi.fn(),
      resetMemorySelection: vi.fn(),
      setMemoryInput: vi.fn(),
    },
    commandSuggestions: [],
    handleCommandSubmit: vi.fn(),
    handleOpenWebDashboard: vi.fn(),
    navigate: vi.fn(),
    ...rest,
  };
}

// ── createInputHandler ─────────────────────────────────

describe('createInputHandler', () => {
  it('exits on "q" key', () => {
    const ctx = createMockContext();
    const handleInput = createInputHandler(ctx);
    handleInput('q', makeKey());
    expect(ctx.navigate).toHaveBeenCalledWith('quit');
  });

  it('does nothing except quit when terminal is too narrow', () => {
    const ctx = createMockContext({ cols: 30 });
    const handleInput = createInputHandler(ctx);
    handleInput('s', makeKey());
    expect(ctx.dispatch).not.toHaveBeenCalled();

    handleInput('q', makeKey());
    expect(ctx.navigate).toHaveBeenCalledWith('quit');
  });

  it('retries connection on "r" when error is present', () => {
    const ctx = createMockContext({ error: 'Connection failed' });
    const handleInput = createInputHandler(ctx);
    handleInput('r', makeKey());
    expect(ctx.connectionRetry).toHaveBeenCalled();
  });

  it('retries connection on "r" when context is null', () => {
    const ctx = createMockContext({ context: null });
    const handleInput = createInputHandler(ctx);
    handleInput('r', makeKey());
    expect(ctx.connectionRetry).toHaveBeenCalled();
  });

  it('opens web dashboard on "w"', () => {
    const ctx = createMockContext();
    const handleInput = createInputHandler(ctx);
    handleInput('w', makeKey());
    expect(ctx.handleOpenWebDashboard).toHaveBeenCalled();
  });

  it('opens tool picker on "n"', () => {
    const ctx = createMockContext();
    const handleInput = createInputHandler(ctx);
    handleInput('n', makeKey());
    expect(ctx.agents.openToolPicker).toHaveBeenCalled();
  });

  it('opens command input on "/" in home view', () => {
    const ctx = createMockContext({ view: 'home' });
    const handleInput = createInputHandler(ctx);
    handleInput('/', makeKey());
    expect(ctx.composer.beginCommandInput).toHaveBeenCalledWith('');
  });

  it('opens memory search on "/" in memory view', () => {
    const ctx = createMockContext({ view: 'memory' });
    const handleInput = createInputHandler(ctx);
    handleInput('/', makeKey());
    expect(ctx.composer.beginMemorySearch).toHaveBeenCalled();
  });

  it('toggles memory view on "k" when memories exist', () => {
    const ctx = createMockContext({ hasMemories: true });
    const handleInput = createInputHandler(ctx);
    handleInput('k', makeKey());
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NAVIGATE_TO_VIEW', view: 'memory' }),
    );
    expect(ctx.memory.resetMemorySelection).toHaveBeenCalled();
  });

  it('switches to sessions view on "s" when agents exist', () => {
    const ctx = createMockContext({ hasLiveAgents: true });
    const handleInput = createInputHandler(ctx);
    handleInput('s', makeKey());
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NAVIGATE_TO_VIEW', view: 'sessions' }),
    );
  });

  it('does not switch to sessions view when no agents', () => {
    const ctx = createMockContext({ hasLiveAgents: false });
    const handleInput = createInputHandler(ctx);
    handleInput('s', makeKey());
    const navCalls = ctx.dispatch.mock.calls.filter(
      ([action]) => action.type === 'NAVIGATE_TO_VIEW' && action.view === 'sessions',
    );
    expect(navCalls).toHaveLength(0);
  });

  it('begins memory add on "a" in memory view', () => {
    const ctx = createMockContext({ view: 'memory' });
    const handleInput = createInputHandler(ctx);
    handleInput('a', makeKey());
    expect(ctx.composer.beginMemoryAdd).toHaveBeenCalled();
    expect(ctx.memory.setMemoryInput).toHaveBeenCalledWith('');
  });

  it('starts delete confirm on "d" when memory is selected', () => {
    const ctx = createMockContext({
      view: 'memory',
      hasMemories: true,
    });
    ctx.memory.memorySelectedIdx = 0;
    const handleInput = createInputHandler(ctx);
    handleInput('d', makeKey());
    expect(ctx.memory.setDeleteConfirm).toHaveBeenCalledWith(true);
  });

  it('deletes memory on second "d" when confirm is active', () => {
    const mem = { id: 'm1', text: 'test' };
    const ctx = createMockContext({
      view: 'memory',
      hasMemories: true,
      visibleMemories: [mem],
    });
    ctx.memory.memorySelectedIdx = 0;
    ctx.memory.deleteConfirm = true;
    const handleInput = createInputHandler(ctx);
    handleInput('d', makeKey());
    expect(ctx.memory.deleteMemoryItem).toHaveBeenCalledWith(mem);
  });

  // ── Agent focus view ────────────────────────────────

  it('returns to home on Escape in agent-focus view', () => {
    const ctx = createMockContext({ view: 'agent-focus' });
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ escape: true }));
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'EXIT_AGENT_FOCUS' }),
    );
  });

  it('kills running agent on "x" in agent-focus view', () => {
    const agent = { _managed: true, _dead: false };
    const ctx = createMockContext({ view: 'agent-focus', focusedAgent: agent });
    const handleInput = createInputHandler(ctx);
    handleInput('x', makeKey());
    expect(ctx.agents.handleKillAgent).toHaveBeenCalled();
  });

  it('removes dead agent on "x" in agent-focus view', () => {
    const agent = { _managed: true, _dead: true };
    const ctx = createMockContext({ view: 'agent-focus', focusedAgent: agent });
    ctx.agents.handleRemoveAgent = vi.fn(() => true);
    const handleInput = createInputHandler(ctx);
    handleInput('x', makeKey());
    expect(ctx.agents.handleRemoveAgent).toHaveBeenCalled();
  });

  it('restarts dead agent on "r" in agent-focus view', () => {
    const agent = { _managed: true, _dead: true };
    const ctx = createMockContext({ view: 'agent-focus', focusedAgent: agent });
    ctx.agents.handleRestartAgent = vi.fn(() => true);
    const handleInput = createInputHandler(ctx);
    handleInput('r', makeKey());
    expect(ctx.agents.handleRestartAgent).toHaveBeenCalled();
  });

  it('toggles diagnostics on "l" in agent-focus view for managed agent', () => {
    const agent = { _managed: true };
    const ctx = createMockContext({ view: 'agent-focus', focusedAgent: agent });
    const handleInput = createInputHandler(ctx);
    handleInput('l', makeKey());
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TOGGLE_DIAGNOSTICS' }),
    );
  });

  // ── Compose mode ────────────────────────────────────

  it('clears compose on Escape when composing', () => {
    const ctx = createMockContext();
    ctx.composer.composeMode = 'command';
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ escape: true }));
    expect(ctx.composer.clearCompose).toHaveBeenCalled();
  });

  it('navigates command suggestions with arrows', () => {
    const ctx = createMockContext({
      commandSuggestions: [{ name: 'new' }, { name: 'doctor' }],
    });
    ctx.composer.composeMode = 'command';
    const handleInput = createInputHandler(ctx);

    handleInput('', makeKey({ downArrow: true }));
    expect(ctx.composer.setCommandSelectedIdx).toHaveBeenCalled();

    handleInput('', makeKey({ upArrow: true }));
    expect(ctx.composer.setCommandSelectedIdx).toHaveBeenCalledTimes(2);
  });

  // ── Tool picker ─────────────────────────────────────

  it('closes tool picker on Escape', () => {
    const ctx = createMockContext();
    ctx.agents.toolPickerOpen = true;
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ escape: true }));
    expect(ctx.agents.setToolPickerOpen).toHaveBeenCalledWith(false);
  });

  it('selects tool on Enter in tool picker', () => {
    const ctx = createMockContext();
    ctx.agents.toolPickerOpen = true;
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ return: true }));
    expect(ctx.agents.handleToolPickerSelect).toHaveBeenCalled();
  });

  // ── Home view navigation ────────────────────────────

  it('moves focus from input to agents on down arrow', () => {
    const agents = [{ agent_id: 'a', _display: 'Claude' }];
    const ctx = createMockContext({
      mainFocus: 'input',
      allVisibleAgents: agents,
    });
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ downArrow: true }));
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_MAIN_FOCUS', focus: 'agents' }),
    );
  });

  it('moves focus from agents to input on up arrow when at top', () => {
    const agents = [{ agent_id: 'a', _display: 'Claude' }];
    const ctx = createMockContext({
      mainFocus: 'agents',
      selectedIdx: 0,
      allVisibleAgents: agents,
    });
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ upArrow: true }));
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_MAIN_FOCUS', focus: 'input' }),
    );
  });

  it('opens agent-focus on Enter when agent is selected', () => {
    const agent = { agent_id: 'a', _display: 'Claude' };
    const ctx = createMockContext({ mainSelectedAgent: agent });
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ return: true }));
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ENTER_AGENT_FOCUS', agent }),
    );
  });

  // ── Fix launcher ────────────────────────────────────

  it('fixes launcher on "f" when fixable tool exists', () => {
    const fixableTool = { id: 'codex', name: 'Codex' };
    const ctx = createMockContext();
    ctx.agents.unavailableCliAgents = [fixableTool];
    ctx.agents.getManagedToolState = vi.fn(() => ({ recoveryCommand: 'codex login' }));
    const handleInput = createInputHandler(ctx);
    handleInput('f', makeKey());
    expect(ctx.agents.handleFixLauncher).toHaveBeenCalledWith(fixableTool);
  });

  it('repairs integrations on "f" when no launcher fix but integration issues exist', () => {
    const ctx = createMockContext();
    ctx.agents.unavailableCliAgents = [];
    ctx.integrations.integrationIssues = [{ id: 'claude-code' }];
    const handleInput = createInputHandler(ctx);
    handleInput('f', makeKey());
    expect(ctx.integrations.repairIntegrations).toHaveBeenCalled();
  });

  // ── Sessions view navigation ─────────────────────────

  it('navigates down in sessions view', () => {
    const liveAgents = [
      { agent_id: 'a', _managed: true, status: 'running' },
      { agent_id: 'b', _managed: true, status: 'running' },
    ];
    const ctx = createMockContext({
      view: 'sessions',
      liveAgents,
      allVisibleAgents: liveAgents,
      selectedIdx: 0,
    });
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ downArrow: true }));
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_SELECTED_IDX' }),
    );
  });

  it('navigates up in sessions view', () => {
    const ctx = createMockContext({ view: 'sessions', selectedIdx: 1 });
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ upArrow: true }));
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_SELECTED_IDX' }),
    );
  });

  it('goes home on Escape in sessions view', () => {
    const ctx = createMockContext({ view: 'sessions' });
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ escape: true }));
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NAVIGATE_TO_VIEW', view: 'home' }),
    );
  });

  it('opens agent-focus on Enter in sessions view', () => {
    const liveAgents = [{ agent_id: 'a', _managed: true }];
    const ctx = createMockContext({
      view: 'sessions',
      selectedIdx: 0,
      liveAgents,
      allVisibleAgents: liveAgents,
    });
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ return: true }));
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ENTER_AGENT_FOCUS', agent: liveAgents[0] }),
    );
  });

  it('kills running agent on "x" in sessions view', () => {
    const agent = { agent_id: 'a', _managed: true, _dead: false };
    const ctx = createMockContext({
      view: 'sessions',
      selectedIdx: 0,
      liveAgents: [agent],
    });
    const handleInput = createInputHandler(ctx);
    handleInput('x', makeKey());
    expect(ctx.agents.handleKillAgent).toHaveBeenCalled();
  });

  it('removes dead agent on "x" in sessions view', () => {
    const agent = { agent_id: 'a', _managed: true, _dead: true };
    const ctx = createMockContext({
      view: 'sessions',
      selectedIdx: 0,
      liveAgents: [agent],
    });
    const handleInput = createInputHandler(ctx);
    handleInput('x', makeKey());
    expect(ctx.agents.handleRemoveAgent).toHaveBeenCalled();
  });

  it('restarts dead agent on "r" in sessions view', () => {
    const agent = { agent_id: 'a', _managed: true, _dead: true };
    const ctx = createMockContext({
      view: 'sessions',
      selectedIdx: 0,
      liveAgents: [agent],
    });
    const handleInput = createInputHandler(ctx);
    handleInput('r', makeKey());
    expect(ctx.agents.handleRestartAgent).toHaveBeenCalled();
  });

  // ── Memory view navigation ───────────────────────────

  it('navigates down in memory view', () => {
    const ctx = createMockContext({
      view: 'memory',
      visibleMemories: [
        { id: '1', text: 'A' },
        { id: '2', text: 'B' },
      ],
    });
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ downArrow: true }));
    expect(ctx.memory.setMemorySelectedIdx).toHaveBeenCalled();
  });

  it('navigates up in memory view', () => {
    const ctx = createMockContext({ view: 'memory' });
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ upArrow: true }));
    expect(ctx.memory.setMemorySelectedIdx).toHaveBeenCalled();
  });

  it('cancels delete confirm on Escape in memory view', () => {
    const ctx = createMockContext({ view: 'memory' });
    ctx.memory.deleteConfirm = true;
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ escape: true }));
    expect(ctx.memory.setDeleteConfirm).toHaveBeenCalledWith(false);
    // Should not navigate away
    const navCalls = ctx.dispatch.mock.calls.filter(
      ([action]) => action.type === 'NAVIGATE_TO_VIEW',
    );
    expect(navCalls).toHaveLength(0);
  });

  it('goes home on Escape in memory view when not confirming delete', () => {
    const ctx = createMockContext({ view: 'memory' });
    ctx.memory.deleteConfirm = false;
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ escape: true }));
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NAVIGATE_TO_VIEW', view: 'home' }),
    );
  });

  // ── Home view edge cases ─────────────────────────────

  it('increments selectedIdx in agent list on down arrow', () => {
    const agents = [
      { agent_id: 'a', _display: 'A' },
      { agent_id: 'b', _display: 'B' },
    ];
    const ctx = createMockContext({
      mainFocus: 'agents',
      allVisibleAgents: agents,
      selectedIdx: 0,
    });
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ downArrow: true }));
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_SELECTED_IDX' }),
    );
  });

  it('decrements selectedIdx in agent list on up arrow', () => {
    const agents = [
      { agent_id: 'a', _display: 'A' },
      { agent_id: 'b', _display: 'B' },
    ];
    const ctx = createMockContext({
      mainFocus: 'agents',
      allVisibleAgents: agents,
      selectedIdx: 1,
    });
    const handleInput = createInputHandler(ctx);
    handleInput('', makeKey({ upArrow: true }));
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_SELECTED_IDX' }),
    );
  });

  it('kills agent on "x" in home view with selected running agent', () => {
    const agent = { agent_id: 'a', _managed: true, _dead: false };
    const ctx = createMockContext({ mainSelectedAgent: agent });
    const handleInput = createInputHandler(ctx);
    handleInput('x', makeKey());
    expect(ctx.agents.handleKillAgent).toHaveBeenCalled();
  });

  it('begins targeted message on "m" with addressable agent in home view', () => {
    const agent = { agent_id: 'a:b:c', _managed: true, status: 'running' };
    const ctx = createMockContext({ mainSelectedAgent: agent });
    const handleInput = createInputHandler(ctx);
    handleInput('m', makeKey());
    expect(ctx.composer.beginTargetedMessage).toHaveBeenCalledWith(agent);
  });

  it('begins targeted message on "m" in agent focus view', () => {
    const agent = { agent_id: 'a:b:c', _managed: true, status: 'running' };
    const ctx = createMockContext({ view: 'agent-focus', focusedAgent: agent });
    const handleInput = createInputHandler(ctx);
    handleInput('m', makeKey());
    expect(ctx.composer.beginTargetedMessage).toHaveBeenCalledWith(agent);
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'EXIT_AGENT_FOCUS' }),
    );
  });
});

// ── createCommandHandler ───────────────────────────────

describe('createCommandHandler', () => {
  let mockCtx;

  beforeEach(() => {
    mockCtx = {
      agents: {
        resolveReadyTool: vi.fn(),
        selectedLaunchTool: null,
        canLaunchSelectedTool: false,
        readyCliAgents: [],
        unavailableCliAgents: [],
        launchManagedTask: vi.fn(),
        handleFixLauncher: vi.fn(),
        refreshManagedToolStates: vi.fn(),
        getManagedToolState: vi.fn(() => ({})),
      },
      integrations: {
        repairIntegrations: vi.fn(),
        refreshIntegrationStatuses: vi.fn(),
      },
      composer: {
        clearCompose: vi.fn(),
        beginTargetedMessage: vi.fn(),
      },
      memory: {
        resetMemorySelection: vi.fn(),
        setMemoryInput: vi.fn(),
      },
      flash: vi.fn(),
      dispatch: vi.fn(),
      handleOpenWebDashboard: vi.fn(),
      liveAgents: [],
      selectedAgent: null,
      isAgentAddressable: vi.fn(() => false),
    };
  });

  it('clears compose on empty command', () => {
    const handler = createCommandHandler(mockCtx);
    handler('');
    expect(mockCtx.composer.clearCompose).toHaveBeenCalled();
  });

  it('clears compose on whitespace-only command', () => {
    const handler = createCommandHandler(mockCtx);
    handler('   ');
    expect(mockCtx.composer.clearCompose).toHaveBeenCalled();
  });

  it('handles /new command', () => {
    mockCtx.agents.selectedLaunchTool = { id: 'claude-code', name: 'Claude Code' };
    mockCtx.agents.readyCliAgents = [{ id: 'claude-code' }];
    const handler = createCommandHandler(mockCtx);
    handler('/new');
    expect(mockCtx.agents.launchManagedTask).toHaveBeenCalled();
  });

  it('handles /start command (alias for /new)', () => {
    mockCtx.agents.selectedLaunchTool = { id: 'claude-code', name: 'Claude Code' };
    const handler = createCommandHandler(mockCtx);
    handler('/start');
    expect(mockCtx.agents.launchManagedTask).toHaveBeenCalled();
  });

  it('handles /new with explicit tool name', () => {
    const tool = { id: 'codex', name: 'Codex' };
    mockCtx.agents.resolveReadyTool = vi.fn(() => tool);
    const handler = createCommandHandler(mockCtx);
    handler('/new codex');
    expect(mockCtx.agents.resolveReadyTool).toHaveBeenCalledWith('codex');
    expect(mockCtx.agents.launchManagedTask).toHaveBeenCalledWith(tool, '');
  });

  it('flashes warning when no tools ready for /new', () => {
    mockCtx.agents.resolveReadyTool = vi.fn(() => null);
    mockCtx.agents.selectedLaunchTool = null;
    mockCtx.agents.readyCliAgents = [];
    const handler = createCommandHandler(mockCtx);
    handler('/new');
    expect(mockCtx.flash).toHaveBeenCalledWith(
      expect.stringContaining('No tools ready'),
      expect.any(Object),
    );
  });

  it('handles /fix command', () => {
    mockCtx.agents.unavailableCliAgents = [{ id: 'codex' }];
    mockCtx.agents.getManagedToolState = vi.fn(() => ({ recoveryCommand: 'codex login' }));
    const handler = createCommandHandler(mockCtx);
    handler('/fix');
    expect(mockCtx.agents.handleFixLauncher).toHaveBeenCalled();
  });

  it('handles /fix falling back to integration repair', () => {
    mockCtx.agents.unavailableCliAgents = [];
    const handler = createCommandHandler(mockCtx);
    handler('/fix');
    expect(mockCtx.integrations.repairIntegrations).toHaveBeenCalled();
  });

  it('handles /repair command', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/repair');
    expect(mockCtx.integrations.repairIntegrations).toHaveBeenCalled();
  });

  it('handles /recheck command', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/recheck');
    expect(mockCtx.agents.refreshManagedToolStates).toHaveBeenCalledWith({
      clearRuntimeFailures: true,
    });
    expect(mockCtx.integrations.refreshIntegrationStatuses).toHaveBeenCalledWith({
      showFlash: true,
    });
  });

  it('handles /refresh command (alias for /recheck)', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/refresh');
    expect(mockCtx.agents.refreshManagedToolStates).toHaveBeenCalled();
  });

  it('handles /doctor command', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/doctor');
    expect(mockCtx.integrations.refreshIntegrationStatuses).toHaveBeenCalledWith({
      showFlash: true,
    });
  });

  it('handles /knowledge command', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/knowledge');
    expect(mockCtx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NAVIGATE_TO_VIEW', view: 'memory' }),
    );
    expect(mockCtx.memory.resetMemorySelection).toHaveBeenCalled();
  });

  it('handles /memory command (alias for /knowledge)', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/memory');
    expect(mockCtx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NAVIGATE_TO_VIEW', view: 'memory' }),
    );
  });

  it('handles /sessions command', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/sessions');
    expect(mockCtx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NAVIGATE_TO_VIEW', view: 'sessions' }),
    );
  });

  it('handles /agents command (alias for /sessions)', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/agents');
    expect(mockCtx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NAVIGATE_TO_VIEW', view: 'sessions' }),
    );
  });

  it('handles /history command (alias for /sessions)', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/history');
    expect(mockCtx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NAVIGATE_TO_VIEW', view: 'sessions' }),
    );
  });

  it('handles /web command', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/web');
    expect(mockCtx.handleOpenWebDashboard).toHaveBeenCalled();
  });

  it('handles /dashboard command (alias for /web)', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/dashboard');
    expect(mockCtx.handleOpenWebDashboard).toHaveBeenCalled();
  });

  it('handles /help command', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/help');
    expect(mockCtx.flash).toHaveBeenCalledWith(expect.stringContaining('/new'), expect.any(Object));
  });

  it('handles /message command with addressable agent', () => {
    const agent = { agent_id: 'a:b:c', status: 'active' };
    mockCtx.selectedAgent = agent;
    mockCtx.isAgentAddressable = vi.fn(() => true);
    const handler = createCommandHandler(mockCtx);
    handler('/message');
    expect(mockCtx.composer.beginTargetedMessage).toHaveBeenCalledWith(agent);
  });

  it('handles /message command without addressable agent', () => {
    mockCtx.selectedAgent = null;
    const handler = createCommandHandler(mockCtx);
    handler('/message');
    expect(mockCtx.flash).toHaveBeenCalledWith(
      expect.stringContaining('Select a live agent'),
      expect.any(Object),
    );
  });

  it('falls through to launch managed task with text as task', () => {
    const tool = { id: 'claude-code', name: 'Claude Code' };
    mockCtx.agents.selectedLaunchTool = tool;
    mockCtx.agents.canLaunchSelectedTool = true;
    const handler = createCommandHandler(mockCtx);
    handler('refactor the auth module');
    expect(mockCtx.agents.launchManagedTask).toHaveBeenCalledWith(tool, 'refactor the auth module');
  });

  it('falls through to hero input when no tool can launch', () => {
    mockCtx.agents.selectedLaunchTool = null;
    mockCtx.agents.canLaunchSelectedTool = false;
    const handler = createCommandHandler(mockCtx);
    handler('some arbitrary text');
    expect(mockCtx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_HERO_INPUT', text: 'some arbitrary text' }),
    );
    expect(mockCtx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_HERO_INPUT_ACTIVE', active: true }),
    );
  });

  it('strips leading slash from commands', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/help');
    // Should work as help, not fail as unknown command
    expect(mockCtx.flash).toHaveBeenCalledWith(expect.stringContaining('Try'), expect.any(Object));
  });

  it('is case-insensitive for command verbs', () => {
    const handler = createCommandHandler(mockCtx);
    handler('/HELP');
    expect(mockCtx.flash).toHaveBeenCalledWith(expect.stringContaining('Try'), expect.any(Object));
  });
});
