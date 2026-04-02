import { api } from '../api.js';
import { isAgentAddressable, getAgentTargetLabel } from './agent-display.js';

/**
 * Custom hook for message composition and command palette.
 * Reads compose state from the dashboard reducer; dispatches to change it.
 */
export function useComposer({ config, teamId, bumpRefreshKey, flash, clearMemorySearch, clearMemoryInput }, state, dispatch) {
  // Read compose state from reducer
  const { composeMode, composeText, composeTarget, composeTargetLabel, commandSelectedIdx } = state;
  const isComposing = composeMode !== null;

  function clearCompose() {
    const previousMode = composeMode;
    dispatch({ type: 'CLEAR_COMPOSE' });
    if (previousMode === 'memory-search') {
      clearMemorySearch();
    }
    if (previousMode === 'memory-add') {
      clearMemoryInput();
    }
  }

  function beginTargetedMessage(agent) {
    if (!isAgentAddressable(agent)) {
      flash('Select a running agent to message directly', { tone: 'warning' });
      return;
    }
    dispatch({
      type: 'BEGIN_TARGETED_MESSAGE',
      target: agent.agent_id,
      targetLabel: getAgentTargetLabel(agent),
    });
  }

  function beginCommandInput(initialText = '') {
    dispatch({ type: 'BEGIN_COMMAND', initialText });
  }

  function beginMemorySearch() {
    dispatch({ type: 'BEGIN_MEMORY_SEARCH' });
  }

  function beginMemoryAdd() {
    dispatch({ type: 'BEGIN_MEMORY_ADD' });
  }

  function setComposeText(text) {
    dispatch({ type: 'SET_COMPOSE_TEXT', text });
  }

  function setCommandSelectedIdx() {
    dispatch({ type: 'RESET_COMMAND_SELECTION' });
  }

  function sendMessage(text, target, targetLabel = null) {
    if (!config?.token) { flash('Not authenticated'); return; }
    if (!teamId || !text.trim()) return;
    api(config).post(`/teams/${teamId}/messages`, { text: text.trim(), target: target || undefined })
      .then(() => {
        flash(targetLabel ? `Sent to ${targetLabel}` : 'Sent to team', { tone: 'success' });
        bumpRefreshKey();
      })
      .catch(() => flash('Message not sent. Check connection.', { tone: 'error' }));
  }

  function onComposeSubmit(commandSuggestions, handleCommandSubmit) {
    if (composeMode === 'command') {
      const selected = commandSuggestions[commandSelectedIdx] || commandSuggestions[0];
      if (selected) {
        handleCommandSubmit(selected.name);
      } else {
        handleCommandSubmit(composeText);
      }
      return;
    }
    sendMessage(composeText, composeTarget, composeTargetLabel);
    clearCompose();
  }

  return {
    composeMode,
    setComposeText,
    composeText,
    composeTarget,
    composeTargetLabel,
    commandSelectedIdx,
    setCommandSelectedIdx,
    isComposing,
    clearCompose,
    beginTargetedMessage,
    beginCommandInput,
    beginMemorySearch,
    beginMemoryAdd,
    sendMessage,
    onComposeSubmit,
  };
}
