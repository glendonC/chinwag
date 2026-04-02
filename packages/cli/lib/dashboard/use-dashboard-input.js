import { useEffect, useCallback } from 'react';
import { useInput } from 'ink';
import { createInputHandler } from './input.js';
import { useDashboard } from './DashboardProvider.jsx';
import { clampSelection } from './reducer.js';

/**
 * Hook that wires up all dashboard input handling: footer hints, selection clamping,
 * and keyboard dispatch. Extracted from DashboardShell for clarity and line-count reduction.
 *
 * @param {object} params
 * @param {object} params.commandPalette - Return value from useCommandPalette()
 */
export function useDashboardInput({ commandPalette }) {
  const {
    state,
    dispatch,
    navigate,
    context,
    error,
    cols,
    connectionRetry,
    memory,
    agents,
    integrations,
    composer,
    liveAgents,
    allVisibleAgents,
    visibleMemories,
    mainSelectedAgent,
    hasLiveAgents,
    hasMemories,
    liveAgentNameCounts,
    setFooterHints,
    handleOpenWebDashboard,
  } = useDashboard();

  const { view, selectedIdx: stateSelectedIdx, mainFocus } = state;
  const { commandSuggestions, handleCommandSubmit } = commandPalette;

  // ── Footer hints (pushed to shell) ─────────────────
  useEffect(() => {
    if (!setFooterHints) return;
    if (composer.isComposing) {
      setFooterHints([
        { key: 'esc', label: 'back' },
        { key: 'q', label: 'quit', color: 'gray' },
      ]);
    } else {
      const ready = agents.readyCliAgents;
      const primary = ready[0] || agents.installedCliAgents[0];
      const nLabel = primary
        ? ready.length > 1
          ? 'new agent'
          : `new ${primary.name}`
        : 'new agent';
      setFooterHints([
        { key: 'n', label: nLabel, color: 'green' },
        { key: 'w', label: 'web' },
        { key: '/', label: 'more' },
        { key: 'q', label: 'quit', color: 'gray' },
      ]);
    }
  }, [composer.isComposing, agents.installedCliAgents, agents.managedToolStates]);

  // ── Clamp selection indices ────────────────────────
  useEffect(() => {
    dispatch(clampSelection(allVisibleAgents.length));
  }, [stateSelectedIdx, allVisibleAgents.length, mainFocus]);

  useEffect(() => {
    if (memory.memorySelectedIdx >= visibleMemories.length) {
      memory.setMemorySelectedIdx(visibleMemories.length > 0 ? visibleMemories.length - 1 : -1);
    }
  }, [memory.memorySelectedIdx, visibleMemories.length]);

  // ── Input handler ──────────────────────────────────
  const inputHandler = useCallback(
    createInputHandler({
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
    }),
    [
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
      agents,
      integrations,
      composer,
      memory,
      commandSuggestions,
      handleCommandSubmit,
      handleOpenWebDashboard,
      navigate,
    ],
  );

  useInput(inputHandler);
}
