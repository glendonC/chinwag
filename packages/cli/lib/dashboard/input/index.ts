/**
 * Dashboard input handler orchestrator.
 * Delegates to the right handler based on current view/state,
 * then falls through to global shortcuts.
 *
 * Re-exports all public types so consumers can import from './input/index.js'.
 */
import { MIN_WIDTH } from '../utils.js';
import {
  navigateToView,
  setSelectedIdx,
  setHeroInput,
  setHeroInputActive,
  setMainFocus,
} from '../reducer.js';
import type { ManagedTool } from '../../managed-agents.js';
import { handleAgentFocusInput } from './agent-focus.js';
import {
  handleComposeModeInput,
  handleToolPickerInput,
  handleHomeViewInput,
  handleSessionsViewInput,
} from './main-view.js';
import { handleMemoryViewInput, handleGlobalShortcuts } from './memory-view.js';

import type {
  InkKey,
  InputHandlerContext,
  CreateInputHandlerParams,
  CreateCommandHandlerParams,
} from './common.js';

// Re-export types for consumers
export type {
  InkKey,
  InputHandlerContext,
  CommandSuggestion,
  CreateInputHandlerParams,
  CreateCommandHandlerParams,
} from './common.js';

/**
 * Creates the input handler for the dashboard.
 * Dispatches to mode-specific handlers based on current view/mode,
 * then falls through to global shortcuts.
 */
export function createInputHandler(
  params: CreateInputHandlerParams,
): (input: string, key: InkKey) => void {
  const {
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
  } = params;

  // Shared context object passed to all handlers
  const ctx: InputHandlerContext = {
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

  return function handleInput(input: string, key: InkKey): void {
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
}: CreateCommandHandlerParams): (rawText: string) => void {
  return function handleCommandSubmit(rawText: string): void {
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
        (tool: ManagedTool) => agents.getManagedToolState(tool.id).recoveryCommand,
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
