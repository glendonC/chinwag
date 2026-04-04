/**
 * Input handling for the memory view (knowledge base browsing, search, add, delete).
 */
import { navigateToView, setSelectedIdx } from '../reducer.js';
import type { ManagedTool } from '../../managed-agents.js';
import type { InkKey, InputHandlerContext } from './common.js';

/**
 * Handle memory-view-specific input (list navigation, delete confirm/cancel).
 * @returns Whether the input was consumed.
 */
export function handleMemoryViewInput(
  input: string,
  key: InkKey,
  ctx: InputHandlerContext,
): boolean {
  const { dispatch, visibleMemories, memory } = ctx;

  if (key.downArrow && visibleMemories.length > 0) {
    memory.setMemorySelectedIdx((i: number) => Math.min(i + 1, visibleMemories.length - 1));
    return true;
  }
  if (key.upArrow) {
    memory.setMemorySelectedIdx((i: number) => Math.max(i - 1, 0));
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
  return false; // Not consumed -- fall through to global shortcuts
}

/**
 * Handle global shortcuts available across all non-modal views.
 * @returns Whether the input was consumed.
 */
export function handleGlobalShortcuts(
  input: string,
  key: InkKey,
  ctx: InputHandlerContext,
): boolean {
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
      (tool: ManagedTool) => agents.getManagedToolState(tool.id).recoveryCommand,
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
