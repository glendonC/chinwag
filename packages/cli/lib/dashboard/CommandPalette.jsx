import { useMemo, useCallback } from 'react';
import { isAgentAddressable } from './agent-display.js';
import { createCommandHandler } from './input.js';
import {
  setHeroInput,
  setHeroInputActive,
  setMainFocus,
  navigateToView,
  setSelectedIdx,
} from './reducer.js';
import { useDashboard } from './DashboardProvider.jsx';

// ── Constants ───────────────────────────────────────
const COMMAND_SUGGESTION_LIMIT = 5;

/**
 * Hook that provides command palette state and handlers.
 * Extracted from the Dashboard component for independent testability.
 */
export function useCommandPalette() {
  const {
    agents,
    integrations,
    composer,
    memory,
    flash,
    dispatch,
    _state,
    hasMemories,
    hasLiveAgents,
    selectedAgent,
    liveAgents,
    _config,
    handleOpenWebDashboard,
  } = useDashboard();

  // ── Command entries ────────────────────────────────
  const commandEntries = useMemo(
    () => [
      { name: '/new', description: 'Open a tool in a new terminal tab' },
      ...(agents.unavailableCliAgents.some(
        (tool) => agents.getManagedToolState(tool.id).recoveryCommand,
      ) || integrations.integrationIssues.length > 0
        ? [{ name: '/fix', description: 'Open the main setup fix flow' }]
        : []),
      { name: '/recheck', description: 'Refresh available tools and integration health' },
      { name: '/doctor', description: 'Scan local Chinwag integration health' },
      ...(integrations.integrationIssues.length > 0
        ? [{ name: '/repair', description: 'Repair detected integration issues' }]
        : []),
      ...(hasMemories ? [{ name: '/knowledge', description: 'View shared knowledge' }] : []),
      ...(hasLiveAgents ? [{ name: '/history', description: 'View past agent activity' }] : []),
      { name: '/web', description: 'Open chinwag in browser' },
      ...(selectedAgent && isAgentAddressable(selectedAgent)
        ? [{ name: '/message', description: `Message ${selectedAgent._display}` }]
        : []),
      { name: '/help', description: 'Show command help' },
    ],
    [agents, integrations.integrationIssues, hasMemories, hasLiveAgents, selectedAgent],
  );

  // ── Filtered suggestions ───────────────────────────
  const commandQuery =
    composer.composeMode === 'command'
      ? composer.composeText.trim().replace(/^\//, '').toLowerCase()
      : '';
  const commandSuggestions = useMemo(
    () =>
      composer.composeMode === 'command'
        ? commandEntries
            .filter((entry) => {
              if (!commandQuery) return true;
              const normalized = entry.name.slice(1).toLowerCase();
              return (
                normalized.startsWith(commandQuery) ||
                entry.description.toLowerCase().includes(commandQuery)
              );
            })
            .slice(0, COMMAND_SUGGESTION_LIMIT + 1)
        : [],
    [composer.composeMode, commandQuery, commandEntries],
  );

  // ── Command submit handler ─────────────────────────
  const handleCommandSubmit = useMemo(
    () =>
      createCommandHandler({
        agents,
        integrations,
        composer,
        memory,
        flash,
        setView: (v) => dispatch(navigateToView(v)),
        setSelectedIdx: (v) => dispatch(setSelectedIdx(v)),
        setHeroInput: (v) => dispatch(setHeroInput(v)),
        setHeroInputActive: (v) => dispatch(setHeroInputActive(v)),
        setMainFocus: (v) => dispatch(setMainFocus(v)),
        handleOpenWebDashboard,
        liveAgents,
        selectedAgent,
        isAgentAddressable,
      }),
    [
      agents,
      integrations,
      composer,
      memory,
      flash,
      dispatch,
      handleOpenWebDashboard,
      liveAgents,
      selectedAgent,
    ],
  );

  // ── Compose submit (delegates to command or message) ─
  const onComposeSubmit = useCallback(() => {
    composer.onComposeSubmit(commandSuggestions, handleCommandSubmit);
  }, [composer, commandSuggestions, handleCommandSubmit]);

  // ── Memory submit ──────────────────────────────────
  const onMemorySubmit = useCallback(() => {
    memory.onMemorySubmit();
    composer.setComposeMode(null);
  }, [memory, composer]);

  return {
    commandEntries,
    commandSuggestions,
    handleCommandSubmit,
    onComposeSubmit,
    onMemorySubmit,
  };
}
