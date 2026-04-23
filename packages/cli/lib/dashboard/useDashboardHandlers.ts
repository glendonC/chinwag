import { useCallback, useMemo } from 'react';
import type { Dispatch } from 'react';
import { useInput } from 'ink';
import { createInputHandler, createCommandHandler } from './input.js';
import { isAgentAddressable } from './agent-display.js';
import { openWebDashboard } from './utils.js';
import type { DashboardState, DashboardAction, NoticeTone } from './reducer.js';
import type { CombinedAgentRow, MemoryEntry, TeamContext } from './view.js';
import type { UseAgentLifecycleReturn } from './agents.js';
import type { UseIntegrationDoctorReturn } from './integrations.js';
import type { UseComposerReturn } from './composer.js';
import type { UseMemoryManagerReturn } from './memory.js';
import type { CommandSuggestion } from './context.jsx';
import type { ChinmeisterConfig } from '../config.js';

interface DashboardHandlerParams {
  config: ChinmeisterConfig | null;
  state: DashboardState;
  dispatch: Dispatch<DashboardAction>;
  flash: (msg: string, opts?: { tone?: NoticeTone; autoClearMs?: number }) => void;
  cols: number;
  error: string | null;
  context: TeamContext | null;
  connectionRetry: () => void;
  allVisibleAgents: CombinedAgentRow[];
  liveAgents: CombinedAgentRow[];
  visibleMemories: MemoryEntry[];
  hasLiveAgents: boolean;
  hasMemories: boolean;
  selectedAgent: CombinedAgentRow | null;
  mainSelectedAgent: CombinedAgentRow | null;
  liveAgentNameCounts: Map<string, number>;
  agentsHook: UseAgentLifecycleReturn;
  integrations: UseIntegrationDoctorReturn;
  composer: UseComposerReturn;
  memoryHook: UseMemoryManagerReturn;
  commandSuggestions: CommandSuggestion[];
  navigate: (target: string) => void;
}

interface DashboardHandlers {
  handleOpenWebDashboard: () => void;
  handleCommandSubmit: (text: string) => void;
  onComposeSubmit: () => void;
  onMemorySubmit: () => void;
}

/**
 * Encapsulates all handler memoization for the dashboard view:
 * command submit, input handler, compose/memory submit, and useInput wiring.
 */
export function useDashboardHandlers({
  config,
  state,
  dispatch,
  flash,
  cols,
  error,
  context,
  connectionRetry,
  allVisibleAgents,
  liveAgents,
  visibleMemories,
  hasLiveAgents,
  hasMemories,
  selectedAgent,
  mainSelectedAgent,
  liveAgentNameCounts,
  agentsHook,
  integrations,
  composer,
  memoryHook,
  commandSuggestions,
  navigate,
}: DashboardHandlerParams): DashboardHandlers {
  const handleOpenWebDashboard = useCallback(() => {
    const result = openWebDashboard(config?.token);
    flash(
      result.ok
        ? 'Opened web dashboard'
        : `Could not open browser${result.error ? `: ${result.error}` : ''}`,
      result.ok ? { tone: 'success' } : { tone: 'error' },
    );
  }, [config?.token, flash]);

  const handleCommandSubmit = useMemo(
    () =>
      createCommandHandler({
        agents: agentsHook,
        integrations,
        composer,
        memory: memoryHook,
        flash,
        dispatch,
        handleOpenWebDashboard,
        liveAgents,
        selectedAgent,
        isAgentAddressable,
      }),
    [
      agentsHook,
      integrations,
      composer,
      memoryHook,
      flash,
      dispatch,
      handleOpenWebDashboard,
      liveAgents,
      selectedAgent,
    ],
  );

  const inputHandler = useMemo(
    () =>
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
        agents: agentsHook,
        integrations,
        composer,
        memory: memoryHook,
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
      liveAgentNameCounts,
      agentsHook,
      integrations,
      composer,
      memoryHook,
      commandSuggestions,
      handleCommandSubmit,
      handleOpenWebDashboard,
      navigate,
    ],
  );

  const onComposeSubmit = useCallback(() => {
    composer.onComposeSubmit(commandSuggestions, handleCommandSubmit);
  }, [composer, commandSuggestions, handleCommandSubmit]);

  const onMemorySubmit = useCallback(() => {
    memoryHook.onMemorySubmit();
    composer.setComposeMode(null);
  }, [memoryHook, composer]);

  useInput(inputHandler);

  return { handleOpenWebDashboard, handleCommandSubmit, onComposeSubmit, onMemorySubmit };
}
