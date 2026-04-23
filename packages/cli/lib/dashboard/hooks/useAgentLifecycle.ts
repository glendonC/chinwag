/**
 * Orchestrator hook that composes sub-hooks for agent lifecycle management.
 * This is what components import. The return interface is unchanged.
 */
import type { Dispatch, SetStateAction } from 'react';
import type { AgentInfo } from '../../process-manager.js';
import type { ManagedTool, ManagedToolState } from '../../managed-agents.js';
import type { CombinedAgentRow } from '../view.js';
import type { ChinmeisterConfig } from '../../config.js';
import type { NoticeTone } from '../reducer.js';

import { useManagedAgents } from './useManagedAgents.js';
import { useToolAvailability } from './useToolAvailability.js';
import { useToolSelector } from './useToolSelector.js';
import { useAgentSpawning } from './useAgentSpawning.js';
import { useAgentActions } from './useAgentActions.js';

interface UseAgentLifecycleParams {
  config: ChinmeisterConfig | null;
  teamId: string | null;
  projectRoot: string;
  stdout: { columns?: number; rows?: number } | null;
  flash: (text: string, options?: { tone?: NoticeTone }) => void;
}

interface SpawnOptions {
  flashSuccess?: boolean;
}

export interface UseAgentLifecycleReturn {
  managedAgents: AgentInfo[];
  managedToolStates: Record<string, ManagedToolState>;
  installedCliAgents: ManagedTool[];
  toolPickerOpen: boolean;
  setToolPickerOpen: Dispatch<SetStateAction<boolean>>;
  toolPickerIdx: number;
  setToolPickerIdx: Dispatch<SetStateAction<number>>;
  launchToolId: string | null;
  readyCliAgents: ManagedTool[];
  unavailableCliAgents: ManagedTool[];
  checkingCliAgents: ManagedTool[];
  selectedLaunchTool: ManagedTool | null;
  canLaunchSelectedTool: boolean;
  launcherChoices: ManagedTool[];
  getManagedToolState: (toolId: string) => ManagedToolState;
  handleSpawnAgent: (toolInfo: ManagedTool, task?: string, options?: SpawnOptions) => boolean;
  launchManagedTask: (toolInfo: ManagedTool, task: string, options?: SpawnOptions) => boolean;
  handleKillAgent: (agent: CombinedAgentRow, liveAgentNameCounts: Map<string, number>) => void;
  handleRemoveAgent: (
    agent: CombinedAgentRow,
    liveAgentNameCounts: Map<string, number>,
  ) => boolean | undefined;
  handleRestartAgent: (agent: CombinedAgentRow) => boolean;
  handleFixLauncher: (tool?: ManagedTool) => void;
  refreshManagedToolStates: (options?: { clearRuntimeFailures?: boolean }) => void;
  resolveReadyTool: (query: string) => ManagedTool | null;
  rememberLaunchTool: (toolId: string) => void;
  selectLaunchTool: (tool: ManagedTool) => void;
  cycleToolForward: () => void;
  handleToolPickerSelect: (idx: number) => void;
  openToolPicker: () => void;
}

/**
 * Custom hook for agent lifecycle management.
 * Composes useToolSelector, useAgentSpawning, and useAgentActions
 * on top of useManagedAgents and useToolAvailability.
 */
export function useAgentLifecycle({
  config,
  teamId,
  projectRoot,
  stdout,
  flash,
}: UseAgentLifecycleParams): UseAgentLifecycleReturn {
  const managed = useManagedAgents({ flash });

  const tools = useToolAvailability({
    installedCliAgents: managed.installedCliAgents,
    managedToolStates: managed.managedToolStates,
    setManagedToolStates: managed.setManagedToolStates,
    managedToolStatusTick: managed.managedToolStatusTick,
    setManagedToolStatusTick: managed.setManagedToolStatusTick,
    teamId,
    projectRoot,
    flash,
  });

  const selector = useToolSelector({ teamId, tools, managed, flash });

  const spawning = useAgentSpawning({
    config,
    projectRoot,
    stdout,
    flash,
    tools,
    rememberLaunchTool: selector.rememberLaunchTool,
  });

  const actions = useAgentActions({
    tools,
    managed,
    flash,
    projectRoot,
    handleSpawnAgent: spawning.handleSpawnAgent,
    launchManagedTask: spawning.launchManagedTask,
  });

  return {
    managedAgents: managed.managedAgents,
    managedToolStates: managed.managedToolStates,
    installedCliAgents: managed.installedCliAgents,
    toolPickerOpen: tools.toolPickerOpen,
    setToolPickerOpen: tools.setToolPickerOpen,
    toolPickerIdx: tools.toolPickerIdx,
    setToolPickerIdx: tools.setToolPickerIdx,
    launchToolId: tools.launchToolId,
    readyCliAgents: tools.readyCliAgents,
    unavailableCliAgents: tools.unavailableCliAgents,
    checkingCliAgents: tools.checkingCliAgents,
    selectedLaunchTool: tools.selectedLaunchTool,
    canLaunchSelectedTool: tools.canLaunchSelectedTool,
    launcherChoices: tools.launcherChoices,
    getManagedToolState: tools.getManagedToolState,
    handleSpawnAgent: spawning.handleSpawnAgent,
    launchManagedTask: spawning.launchManagedTask,
    handleKillAgent: actions.handleKillAgent,
    handleRemoveAgent: actions.handleRemoveAgent,
    handleRestartAgent: actions.handleRestartAgent,
    handleFixLauncher: actions.handleFixLauncher,
    refreshManagedToolStates: selector.refreshManagedToolStates,
    resolveReadyTool: selector.resolveReadyTool,
    rememberLaunchTool: selector.rememberLaunchTool,
    selectLaunchTool: selector.selectLaunchTool,
    cycleToolForward: selector.cycleToolForward,
    handleToolPickerSelect: actions.handleToolPickerSelect,
    openToolPicker: actions.openToolPicker,
  };
}
