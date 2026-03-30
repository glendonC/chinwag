import { useState } from 'react';
import { api } from './api.js';

/**
 * Custom hook for message/command composition in the dashboard.
 *
 * Manages the compose overlay (command palette, targeted messages, memory search/add,
 * launch mode) and the slash-command dispatch.
 */
export function useComposer({
  config,
  teamId,
  onFlash,
  onRefresh,
  memoryManager,
}) {
  // Composer: null | 'command' | 'targeted' | 'launch' | 'memory-search' | 'memory-add'
  const [composeMode, setComposeMode] = useState(null);
  const [composeText, setComposeText] = useState('');
  const [composeTarget, setComposeTarget] = useState(null);
  const [composeTargetLabel, setComposeTargetLabel] = useState(null);

  const isComposing = Boolean(composeMode && composeMode !== 'launch');

  function clearCompose() {
    const previousMode = composeMode;
    setComposeMode(null);
    setComposeText('');
    setComposeTarget(null);
    setComposeTargetLabel(null);
    if (previousMode === 'memory-search') {
      memoryManager.setMemorySearch('');
    }
    if (previousMode === 'memory-add') {
      memoryManager.setMemoryInput('');
    }
  }

  function beginTargetedMessage(agent, { isAgentAddressable, getAgentTargetLabel }) {
    if (!isAgentAddressable(agent)) {
      onFlash('Select a running agent to message directly', { tone: 'warning' });
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
  }

  function closeLaunchComposer() {
    setComposeMode(null);
    setComposeText('');
  }

  function openLaunchComposer({
    preselectedTool = null,
    installedCliAgents,
    selectedLaunchTool,
    canLaunchSelectedTool,
    preferredLaunchTool,
    readyCliAgents,
    setView,
    setMainFocus,
    setLaunchToolId,
    initialTaskText = '',
  } = {}) {
    if (!installedCliAgents.length) {
      onFlash('No managed launchers are configured yet.', { tone: 'warning' });
      return;
    }

    clearCompose();
    setView('home');
    setMainFocus('launcher');

    const initialTool = preselectedTool
      || (selectedLaunchTool && canLaunchSelectedTool ? selectedLaunchTool : null)
      || preferredLaunchTool
      || readyCliAgents[0]
      || selectedLaunchTool
      || installedCliAgents[0]
      || null;
    if (initialTool) {
      setLaunchToolId(initialTool.id);
    }
    setComposeMode('launch');
    setComposeText(initialTaskText);
  }

  function sendMessage(text, target, targetLabel = null) {
    if (!teamId || !text.trim()) return;
    api(config).post(`/teams/${teamId}/messages`, { text: text.trim(), target: target || undefined })
      .then(() => {
        onFlash(targetLabel ? `Sent to ${targetLabel}` : 'Sent to team', { tone: 'success', autoClearMs: 4000 });
        onRefresh();
      })
      .catch(() => onFlash('Could not send message', { tone: 'error' }));
  }

  function onComposeSubmit(handleCommandSubmit) {
    if (composeMode === 'command') {
      handleCommandSubmit(composeText);
      return;
    }
    sendMessage(composeText, composeTarget, composeTargetLabel);
    clearCompose();
  }

  function onTaskLaunchSubmit({ selectedLaunchTool, canLaunchSelectedTool, launchManagedTask }) {
    if (!selectedLaunchTool || !canLaunchSelectedTool) return;
    const didStart = launchManagedTask(selectedLaunchTool, composeText, { flashSuccess: false });
    if (didStart) {
      setComposeText('');
      onFlash(`Started ${selectedLaunchTool.name}. Enter another task or press [esc].`, { tone: 'success', autoClearMs: 5000 });
    }
  }

  /**
   * Handle a slash command.
   * Returns true if the command was handled and the compose should be cleared.
   */
  function handleCommandSubmit(rawText, {
    readyCliAgents,
    selectedLaunchTool,
    canLaunchSelectedTool,
    launchManagedTask,
    openLauncherFn,
    refreshManagedToolStates,
    handleFixLauncher,
    liveAgents,
    selectedAgent,
    isAgentAddressable,
    setView,
    setSelectedIdx,
    setMemorySelectedIdx,
    beginTargetedMessageFn,
    hasMemories,
  }) {
    const text = rawText.trim().replace(/^\//, '').trim();
    if (!text) {
      clearCompose();
      return;
    }

    const [verbRaw, ...restParts] = text.split(/\s+/);
    const verb = verbRaw.toLowerCase();
    const rest = restParts.join(' ').trim();

    if (verb === 'new' || verb === 'start') {
      if (!rest) {
        openLauncherFn();
        return;
      }

      const [toolToken, ...taskParts] = rest.split(/\s+/);
      const explicitTool = resolveReadyTool(toolToken, readyCliAgents);
      if (explicitTool) {
        const taskText = taskParts.join(' ').trim();
        if (taskText) {
          launchManagedTask(explicitTool, taskText);
        } else {
          openLauncherFn(explicitTool);
          return;
        }
        clearCompose();
        return;
      }

      if (selectedLaunchTool && canLaunchSelectedTool) {
        launchManagedTask(selectedLaunchTool, rest);
        clearCompose();
        return;
      }

      openLauncherFn(null, rest);
      return;
    }

    if (verb === 'fix') {
      handleFixLauncher();
      clearCompose();
      return;
    }

    if (verb === 'recheck' || verb === 'refresh') {
      refreshManagedToolStates({ clearRuntimeFailures: true });
      clearCompose();
      return;
    }

    if (verb === 'knowledge' || verb === 'memory') {
      setView('memory');
      setMemorySelectedIdx(-1);
      clearCompose();
      return;
    }

    if (verb === 'sessions' || verb === 'agents') {
      setView('sessions');
      setSelectedIdx(liveAgents.length > 0 ? 0 : -1);
      clearCompose();
      return;
    }

    if (verb === 'message') {
      if (selectedAgent && isAgentAddressable(selectedAgent)) {
        beginTargetedMessageFn(selectedAgent);
      } else {
        onFlash('Select a live agent to message.', { tone: 'warning' });
        clearCompose();
      }
      return;
    }

    if (verb === 'help') {
      onFlash('Try /new, /fix, /recheck, or /memory.', { tone: 'info', autoClearMs: 5000 });
      clearCompose();
      return;
    }

    if (selectedLaunchTool && canLaunchSelectedTool) {
      launchManagedTask(selectedLaunchTool, text);
      clearCompose();
      return;
    }

    openLauncherFn(null, text);
  }

  return {
    composeMode,
    setComposeMode,
    composeText,
    setComposeText,
    composeTarget,
    composeTargetLabel,
    isComposing,
    clearCompose,
    beginTargetedMessage,
    beginCommandInput,
    closeLaunchComposer,
    openLaunchComposer,
    sendMessage,
    onComposeSubmit,
    onTaskLaunchSubmit,
    handleCommandSubmit,
  };
}

function resolveReadyTool(query, readyCliAgents) {
  if (!query) return null;
  const normalized = query.toLowerCase();
  return readyCliAgents.find((tool) => (
    tool.id === normalized
    || tool.name.toLowerCase() === normalized
    || tool.name.toLowerCase().startsWith(normalized)
    || tool.id.startsWith(normalized)
  )) || null;
}
