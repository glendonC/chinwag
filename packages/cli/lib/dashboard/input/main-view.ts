/**
 * Input handling for the main dashboard views (home, sessions)
 * and modal overlays (compose mode, tool picker).
 */
import { isAgentAddressable } from '../agent-display.js';
import { navigateToView, setSelectedIdx, setMainFocus, enterAgentFocus } from '../reducer.js';
import { COMMAND_SUGGESTION_LIMIT } from '../constants.js';
import type { InkKey, InputHandlerContext } from './common.js';

/**
 * Handle input when compose mode is active (command, targeted message, memory-search, memory-add).
 * @returns Whether the input was consumed.
 */
export function handleComposeModeInput(
  input: string,
  key: InkKey,
  ctx: InputHandlerContext,
): boolean {
  const { composer, commandSuggestions } = ctx;

  if (key.escape) {
    composer.clearCompose();
    return true;
  }
  if (composer.composeMode === 'command') {
    const maxIdx = Math.min(commandSuggestions.length - 1, COMMAND_SUGGESTION_LIMIT);
    if (key.downArrow) {
      composer.setCommandSelectedIdx((i: number) => Math.min(i + 1, maxIdx));
      return true;
    }
    if (key.upArrow) {
      composer.setCommandSelectedIdx((i: number) => Math.max(i - 1, 0));
      return true;
    }
  }
  return true; // Consume all input when composing
}

/**
 * Handle input when the tool picker overlay is open.
 * @returns Whether the input was consumed.
 */
export function handleToolPickerInput(
  input: string,
  key: InkKey,
  ctx: InputHandlerContext,
): boolean {
  const { agents } = ctx;
  const tools =
    agents.readyCliAgents.length > 0 ? agents.readyCliAgents : agents.installedCliAgents;

  if (key.escape) {
    agents.setToolPickerOpen(false);
    return true;
  }
  if (key.downArrow) {
    agents.setToolPickerIdx((i: number) => Math.min(i + 1, tools.length - 1));
    return true;
  }
  if (key.upArrow) {
    agents.setToolPickerIdx((i: number) => Math.max(i - 1, 0));
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
 * @returns Whether the input was consumed.
 */
export function handleHomeViewInput(input: string, key: InkKey, ctx: InputHandlerContext): boolean {
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
      dispatch(setSelectedIdx((i: number) => Math.min(i + 1, allVisibleAgents.length - 1)));
      return true;
    }
  }
  if (key.upArrow) {
    if (mainFocus === 'agents' && selectedIdx > 0) {
      dispatch(setSelectedIdx((i: number) => Math.max(i - 1, 0)));
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
  return false; // Not consumed -- fall through to global shortcuts
}

/**
 * Handle sessions-view-specific input (list navigation, inspect, kill, restart).
 * @returns Whether the input was consumed.
 */
export function handleSessionsViewInput(
  input: string,
  key: InkKey,
  ctx: InputHandlerContext,
): boolean {
  const { state, dispatch, liveAgents, allVisibleAgents, liveAgentNameCounts, agents } = ctx;
  const { selectedIdx } = state;

  if (key.downArrow && liveAgents.length > 0) {
    dispatch(setSelectedIdx((i: number) => Math.min(i + 1, liveAgents.length - 1)));
    return true;
  }
  if (key.upArrow) {
    if (selectedIdx <= 0) {
      dispatch(setSelectedIdx(-1));
    } else {
      dispatch(setSelectedIdx((i: number) => Math.max(i - 1, 0)));
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
  return false; // Not consumed -- fall through to global shortcuts
}
