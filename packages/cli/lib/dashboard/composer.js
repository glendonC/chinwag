import { useState } from 'react';
import { api } from '../api.js';
import { isAgentAddressable, getAgentTargetLabel } from './agent-display.js';

/**
 * Custom hook for message composition and command palette.
 * Handles compose modes: command, targeted message, memory-search, memory-add.
 */
export function useComposer({
  config,
  teamId,
  bumpRefreshKey,
  flash,
  clearMemorySearch,
  clearMemoryInput,
}) {
  // Composer: null | 'command' | 'targeted' | 'memory-search' | 'memory-add'
  const [composeMode, setComposeMode] = useState(null);
  const [composeText, setComposeText] = useState('');
  const [composeTarget, setComposeTarget] = useState(null);
  const [composeTargetLabel, setComposeTargetLabel] = useState(null);
  const [commandSelectedIdx, setCommandSelectedIdx] = useState(0);

  const isComposing = Boolean(composeMode);

  function clearCompose() {
    const previousMode = composeMode;
    setComposeMode(null);
    setComposeText('');
    setComposeTarget(null);
    setComposeTargetLabel(null);
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
    setComposeTarget(agent.agent_id);
    setComposeTargetLabel(getAgentTargetLabel(agent));
    setComposeMode('targeted');
    setComposeText('');
  }

  function beginCommandInput(initialText = '') {
    setComposeMode('command');
    setComposeText(initialText);
    setCommandSelectedIdx(0);
  }

  function beginMemorySearch() {
    setComposeMode('memory-search');
  }

  function beginMemoryAdd() {
    setComposeMode('memory-add');
  }

  function sendMessage(text, target, targetLabel = null) {
    if (!config?.token) {
      flash('Not authenticated');
      return;
    }
    if (!teamId || !text.trim()) return;
    api(config)
      .post(`/teams/${teamId}/messages`, { text: text.trim(), target: target || undefined })
      .then(() => {
        flash(targetLabel ? `Sent to ${targetLabel}` : 'Sent to team', { tone: 'success' });
        bumpRefreshKey();
      })
      .catch((err) => {
        const status = err?.status ? ` (${err.status})` : '';
        console.error(`[chinwag] Failed to send message${status}:`, err?.message || err);
        flash(`Message not sent${status}. Check connection.`, { tone: 'error' });
      });
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
    setComposeMode,
    composeText,
    setComposeText,
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
