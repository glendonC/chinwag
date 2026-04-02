import { isAgentAddressable } from './agent-display.js';
import { MIN_WIDTH } from './utils.js';
import {
  navigateToView,
  setSelectedIdx,
  setMainFocus,
  setHeroInput,
  setHeroInputActive,
  toggleDiagnostics,
  enterAgentFocus,
  exitAgentFocus,
} from './reducer.js';

// ── Constants ───────────────────────────────────────
const COMMAND_SUGGESTION_LIMIT = 5;

// ── Mode-specific input handlers ────────────────────

/**
 * Handle input when in the agent-focus view.
 * @returns {boolean} Whether the input was consumed.
 */
function handleAgentFocusInput(input, key, ctx) {
  const { dispatch, agents, liveAgentNameCounts, composer } = ctx;
  const { focusedAgent } = ctx.state;

  if (key.escape) {
    dispatch(exitAgentFocus());
    return true;
  }
  if (input === 'x' && focusedAgent?._managed) {
    if (focusedAgent._dead) {
      const removed = agents.handleRemoveAgent(focusedAgent, liveAgentNameCounts);
      if (removed) {
        dispatch(exitAgentFocus());
      }
    } else {
      agents.handleKillAgent(focusedAgent, liveAgentNameCounts);
      dispatch(exitAgentFocus());
    }
    return true;
  }
  if (input === 'r' && focusedAgent?._managed && focusedAgent._dead) {
    const restarted = agents.handleRestartAgent(focusedAgent);
    if (restarted) {
      dispatch(exitAgentFocus());
    }
    return true;
  }
  if (input === 'l' && focusedAgent?._managed) {
    dispatch(toggleDiagnostics());
    return true;
  }
  if (input === 'm' && isAgentAddressable(focusedAgent)) {
    dispatch(exitAgentFocus());
    composer.beginTargetedMessage(focusedAgent);
    return true;
  }
  return true; // Consume all input when in agent-focus view
}

/**
 * Handle input when compose mode is active (command, targeted message, memory-search, memory-add).
 * @returns {boolean} Whether the input was consumed.
 */
function handleComposeModeInput(input, key, ctx) {
  const { composer, commandSuggestions } = ctx;

  if (key.escape) {
    composer.clearCompose();
    return true;
  }
  if (composer.composeMode === 'command') {
    const maxIdx = Math.min(commandSuggestions.length - 1, COMMAND_SUGGESTION_LIMIT);
    if (key.downArrow) {
      composer.setCommandSelectedIdx((i) => Math.min(i + 1, maxIdx));
      return true;
    }
    if (key.upArrow) {
      composer.setCommandSelectedIdx((i) => Math.max(i - 1, 0));
      return true;
    }
  }
  return true; // Consume all input when composing
}

/**
 * Handle input when the tool picker overlay is open.
 * @returns {boolean} Whether the input was consumed.
 */
function handleToolPickerInput(input, key, ctx) {
  const { agents } = ctx;
  const tools =
    agents.readyCliAgents.length > 0 ? agents.readyCliAgents : agents.installedCliAgents;

  if (key.escape) {
    agents.setToolPickerOpen(false);
    return true;
  }
  if (key.downArrow) {
    agents.setToolPickerIdx((i) => Math.min(i + 1, tools.length - 1));
    return true;
  }
  if (key.upArrow) {
    agents.setToolPickerIdx((i) => Math.max(i - 1, 0));
    return true;
  }
  if (key.return) {
    agents.handleToolPickerSelect(agents.toolPickerIdx);
    return true;
  }
  return true; // Consume all input when tool picker is open
}

/**
 * Handle home-view-specific input (agent list navigation, spawn, message, kill).
 * @returns {boolean} Whether the input was consumed.
 */
function handleHomeViewInput(input, key, ctx) {
  const {
    state,
    dispatch,
    allVisibleAgents,
    mainSelectedAgent,
    liveAgentNameCounts,
    agents,
    composer,
  } = ctx;
  const { mainFocus, selectedIdx } = state;

  if (input === 'n') {
    agents.openToolPicker();
    return true;
  }
  if (key.downArrow) {
    if (mainFocus === 'input' && allVisibleAgents.length > 0) {
      dispatch(setMainFocus('agents'));
      if (selectedIdx < 0) dispatch(setSelectedIdx(0));
      return true;
    }
    if (mainFocus === 'agents' && allVisibleAgents.length > 0) {
      dispatch(setSelectedIdx((i) => Math.min(i + 1, allVisibleAgents.length - 1)));
      return true;
    }
  }
  if (key.upArrow) {
    if (mainFocus === 'agents' && selectedIdx > 0) {
      dispatch(setSelectedIdx((i) => Math.max(i - 1, 0)));
      return true;
    }
    if (mainFocus === 'agents') {
      dispatch(setMainFocus('input'));
      return true;
    }
  }
  if (key.return && mainSelectedAgent) {
    dispatch(enterAgentFocus(mainSelectedAgent));
    return true;
  }
  if (input === 'm' && mainSelectedAgent && isAgentAddressable(mainSelectedAgent)) {
    composer.beginTargetedMessage(mainSelectedAgent);
    return true;
  }
  if (input === 'x' && mainSelectedAgent?._managed && !mainSelectedAgent._dead) {
    agents.handleKillAgent(mainSelectedAgent, liveAgentNameCounts);
    return true;
  }
  return false; // Not consumed — fall through to global shortcuts
}

/**
 * Handle sessions-view-specific input (list navigation, inspect, kill, restart).
 * @returns {boolean} Whether the input was consumed.
 */
function handleSessionsViewInput(input, key, ctx) {
  const { state, dispatch, liveAgents, allVisibleAgents, liveAgentNameCounts, agents } = ctx;
  const { selectedIdx } = state;

  if (key.downArrow && liveAgents.length > 0) {
    dispatch(setSelectedIdx((i) => Math.min(i + 1, liveAgents.length - 1)));
    return true;
  }
  if (key.upArrow) {
    if (selectedIdx <= 0) {
      dispatch(setSelectedIdx(-1));
    } else {
      dispatch(setSelectedIdx((i) => Math.max(i - 1, 0)));
    }
    return true;
  }
  if (key.escape) {
    dispatch(navigateToView('home'));
    return true;
  }
  if (key.return) {
    if (selectedIdx >= 0 && selectedIdx < allVisibleAgents.length) {
      dispatch(enterAgentFocus(liveAgents[selectedIdx]));
    }
    return true;
  }
  if (input === 'x' && selectedIdx >= 0) {
    const agent = liveAgents[selectedIdx];
    if (agent?._managed) {
      if (agent._dead) {
        agents.handleRemoveAgent(agent, liveAgentNameCounts);
      } else {
        agents.handleKillAgent(agent, liveAgentNameCounts);
      }
      return true;
    }
  }
  if (input === 'r' && selectedIdx >= 0) {
    const agent = liveAgents[selectedIdx];
    if (agent?._managed && agent._dead) {
      agents.handleRestartAgent(agent);
      return true;
    }
  }
  return false; // Not consumed — fall through to global shortcuts
}

/**
 * Handle memory-view-specific input (list navigation, delete confirm/cancel).
 * @returns {boolean} Whether the input was consumed.
 */
function handleMemoryViewInput(input, key, ctx) {
  const { dispatch, visibleMemories, memory } = ctx;

  if (key.downArrow && visibleMemories.length > 0) {
    memory.setMemorySelectedIdx((i) => Math.min(i + 1, visibleMemories.length - 1));
    return true;
  }
  if (key.upArrow) {
    memory.setMemorySelectedIdx((i) => Math.max(i - 1, 0));
    return true;
  }
  if (key.escape) {
    if (memory.deleteConfirm) {
      memory.setDeleteConfirm(false);
      return true;
    }
    dispatch(navigateToView('home'));
    return true;
  }
  return false; // Not consumed — fall through to global shortcuts
}

/**
 * Handle global shortcuts available across all non-modal views.
 * @returns {boolean} Whether the input was consumed.
 */
function handleGlobalShortcuts(input, key, ctx) {
  const {
    state,
    dispatch,
    hasLiveAgents,
    hasMemories,
    visibleMemories,
    agents,
    integrations,
    composer,
    memory,
    handleOpenWebDashboard,
    navigate,
  } = ctx;

  const { view } = state;
  const isHomeView = view === 'home';
  const isSessionsView = view === 'sessions';
  const isMemoryView = view === 'memory';

  if (input === 's' && hasLiveAgents) {
    dispatch(navigateToView('sessions'));
    dispatch(setSelectedIdx(state.selectedIdx >= 0 ? state.selectedIdx : 0));
    return true;
  }

  if (input === 'w') {
    handleOpenWebDashboard();
    return true;
  }

  if (input === 'k' && hasMemories) {
    if (view === 'memory') {
      dispatch(navigateToView('home'));
    } else {
      dispatch(navigateToView('memory'));
    }
    memory.resetMemorySelection();
    return true;
  }

  if (input === 'f') {
    const fixableTool = agents.unavailableCliAgents.find(
      (tool) => agents.getManagedToolState(tool.id).recoveryCommand,
    );
    if (fixableTool) {
      agents.handleFixLauncher(fixableTool);
      return true;
    }
    if (integrations.integrationIssues.length > 0) {
      integrations.repairIntegrations();
      return true;
    }
    return true;
  }

  if (input === '/') {
    if (isHomeView || isSessionsView) {
      composer.beginCommandInput('');
      return true;
    }
    if (isMemoryView) {
      composer.beginMemorySearch();
      return true;
    }
  }

  if (input === 'a' && isMemoryView) {
    composer.beginMemoryAdd();
    memory.setMemoryInput('');
    return true;
  }

  if (input === 'd' && isMemoryView && memory.memorySelectedIdx >= 0) {
    if (!memory.deleteConfirm) {
      memory.setDeleteConfirm(true);
      return true;
    }
    memory.deleteMemoryItem(visibleMemories[memory.memorySelectedIdx]);
    return true;
  }

  if (input === 'q') {
    navigate('quit');
    return true;
  }

  return false;
}

// ── Main dispatcher ─────────────────────────────────

/**
 * Creates the input handler for the dashboard.
 * Dispatches to mode-specific handlers based on current view/mode,
 * then falls through to global shortcuts.
 */
export function createInputHandler({
  // Reducer state + dispatch
  state,
  dispatch,
  // Connection
  cols,
  error,
  context,
  connectionRetry,
  // Data
  allVisibleAgents,
  liveAgents,
  visibleMemories,
  hasLiveAgents,
  hasMemories,
  mainSelectedAgent,
  liveAgentNameCounts,
  // Hooks
  agents,
  integrations,
  composer,
  memory,
  // Commands
  commandSuggestions,
  handleCommandSubmit,
  handleOpenWebDashboard,
  // Navigation
  navigate,
}) {
  // Shared context object passed to all handlers
  const ctx = {
    state,
    dispatch,
    cols,
    error,
    context,
    connectionRetry,
    allVisibleAgents,
    liveAgents,
    visibleMemories,
    hasLiveAgents,
    hasMemories,
    mainSelectedAgent,
    liveAgentNameCounts,
    agents,
    integrations,
    composer,
    memory,
    commandSuggestions,
    handleCommandSubmit,
    handleOpenWebDashboard,
    navigate,
  };

  return function handleInput(input, key) {
    // ── Narrow terminal guard ──────────────────
    if (cols < MIN_WIDTH) {
      if (input === 'q') navigate('quit');
      return;
    }

    // ── Connection retry (error / loading states) ──
    if (input === 'r' && (error || !context)) {
      connectionRetry();
      return;
    }

    const { view } = state;
    const isHomeView = view === 'home';
    const isSessionsView = view === 'sessions';
    const isMemoryView = view === 'memory';
    const isAgentFocusView = view === 'agent-focus';

    // ── Modal views (consume all input) ────────
    if (isAgentFocusView) {
      handleAgentFocusInput(input, key, ctx);
      return;
    }
    if (composer.composeMode !== null) {
      handleComposeModeInput(input, key, ctx);
      return;
    }
    if (agents.toolPickerOpen) {
      handleToolPickerInput(input, key, ctx);
      return;
    }

    // ── View-specific input (may fall through) ─
    if (isHomeView && handleHomeViewInput(input, key, ctx)) return;
    if (isSessionsView && handleSessionsViewInput(input, key, ctx)) return;
    if (isMemoryView && handleMemoryViewInput(input, key, ctx)) return;

    // ── Global shortcuts ───────────────────────
    handleGlobalShortcuts(input, key, ctx);
  };
}

/**
 * Creates the command submit handler.
 */
export function createCommandHandler({
  agents,
  integrations,
  composer,
  memory,
  flash,
  dispatch,
  handleOpenWebDashboard,
  liveAgents,
  selectedAgent,
  isAgentAddressable: checkAddressable,
}) {
  return function handleCommandSubmit(rawText) {
    const text = rawText.trim().replace(/^\//, '').trim();
    if (!text) {
      composer.clearCompose();
      return;
    }

    const [verbRaw, ...restParts] = text.split(/\s+/);
    const verb = verbRaw.toLowerCase();
    const rest = restParts.join(' ').trim();

    if (verb === 'new' || verb === 'start') {
      const explicitTool = rest ? agents.resolveReadyTool(rest) : null;
      const tool = explicitTool || agents.selectedLaunchTool || agents.readyCliAgents[0];
      if (tool) {
        agents.launchManagedTask(tool, '');
      } else {
        flash('No tools ready. Run /recheck.', { tone: 'warning' });
      }
      composer.clearCompose();
      return;
    }

    if (verb === 'fix') {
      const hasLauncherFix = agents.unavailableCliAgents.some(
        (tool) => agents.getManagedToolState(tool.id).recoveryCommand,
      );
      if (hasLauncherFix) {
        agents.handleFixLauncher();
      } else {
        integrations.repairIntegrations();
      }
      composer.clearCompose();
      return;
    }

    if (verb === 'repair') {
      integrations.repairIntegrations();
      composer.clearCompose();
      return;
    }

    if (verb === 'recheck' || verb === 'refresh') {
      agents.refreshManagedToolStates({ clearRuntimeFailures: true });
      integrations.refreshIntegrationStatuses({ showFlash: true });
      composer.clearCompose();
      return;
    }

    if (verb === 'doctor') {
      integrations.refreshIntegrationStatuses({ showFlash: true });
      composer.clearCompose();
      return;
    }

    if (verb === 'knowledge' || verb === 'memory') {
      dispatch(navigateToView('memory'));
      memory.resetMemorySelection();
      composer.clearCompose();
      return;
    }

    if (verb === 'sessions' || verb === 'agents' || verb === 'history') {
      dispatch(navigateToView('sessions'));
      dispatch(setSelectedIdx(liveAgents.length > 0 ? 0 : -1));
      composer.clearCompose();
      return;
    }

    if (verb === 'web' || verb === 'dashboard') {
      handleOpenWebDashboard();
      composer.clearCompose();
      return;
    }

    if (verb === 'message') {
      if (selectedAgent && checkAddressable(selectedAgent)) {
        composer.beginTargetedMessage(selectedAgent);
      } else {
        flash('Select a live agent to message.', { tone: 'warning' });
        composer.clearCompose();
      }
      return;
    }

    if (verb === 'help') {
      flash('Try /new, /doctor, /recheck, /memory, /web, or /sessions.', { tone: 'info' });
      composer.clearCompose();
      return;
    }

    if (agents.selectedLaunchTool && agents.canLaunchSelectedTool) {
      agents.launchManagedTask(agents.selectedLaunchTool, text);
      composer.clearCompose();
      return;
    }

    dispatch(setHeroInput(text));
    dispatch(setHeroInputActive(true));
    dispatch(setMainFocus('input'));
    composer.clearCompose();
  };
}
