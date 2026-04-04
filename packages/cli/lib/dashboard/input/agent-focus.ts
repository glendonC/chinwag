/**
 * Input handling for the agent-focus view (when an agent is selected/inspected).
 */
import { isAgentAddressable } from '../agent-display.js';
import { exitAgentFocus, toggleDiagnostics } from '../reducer.js';
import type { InkKey, InputHandlerContext } from './common.js';

/**
 * Handle input when in the agent-focus view.
 * @returns Whether the input was consumed.
 */
export function handleAgentFocusInput(
  input: string,
  key: InkKey,
  ctx: InputHandlerContext,
): boolean {
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
    composer.beginTargetedMessage(focusedAgent!);
    return true;
  }
  return true; // Consume all input when in agent-focus view
}
