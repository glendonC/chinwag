import { useState, useRef } from 'react';
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
  const [isSending, setIsSending] = useState(false);
  const pendingSendRef = useRef(Promise.resolve());

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
      flash('Not signed in.', { tone: 'error' });
      return Promise.reject();
    }
    if (!teamId || !text.trim()) return Promise.reject();

    const doSend = async () => {
      setIsSending(true);
      try {
        await api(config).post(`/teams/${teamId}/messages`, {
          text: text.trim(),
          target: target || undefined,
        });
        flash(targetLabel ? `Sent to ${targetLabel}` : 'Sent to team', { tone: 'success' });
        bumpRefreshKey();
      } catch (err) {
        console.error('[chinwag] Could not send message:', err?.message || err);
        flash('Send failed \u2014 message preserved, try again', {
          tone: 'error',
          autoClearMs: 5000,
        });
        throw err; // re-throw so caller can restore compose state
      } finally {
        setIsSending(false);
      }
    };

    pendingSendRef.current = pendingSendRef.current.then(doSend, doSend);
    return pendingSendRef.current;
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
    const savedText = composeText;
    const savedTarget = composeTarget;
    const savedTargetLabel = composeTargetLabel;
    const savedMode = composeMode;
    clearCompose();
    sendMessage(savedText, savedTarget, savedTargetLabel).catch(() => {
      // Restore compose state so user can retry without retyping
      setComposeMode(savedMode);
      setComposeText(savedText);
      setComposeTarget(savedTarget);
      setComposeTargetLabel(savedTargetLabel);
    });
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
    isSending,
    onComposeSubmit,
  };
}
