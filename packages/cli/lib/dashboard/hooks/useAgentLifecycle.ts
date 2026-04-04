/**
 * Orchestrator hook that combines useManagedAgents and useToolAvailability.
 * This is what components import. Keeps the same return interface as the
 * original useAgentLifecycle hook.
 */
import type { Dispatch, SetStateAction } from 'react';
import {
  spawnAgent,
  killAgent,
  removeAgent,
  registerExternalAgent,
} from '../../process-manager.js';
import type { AgentInfo } from '../../process-manager.js';
import { spawnInTerminal, detectTerminalEnvironment } from '../../terminal-spawner.js';
import { openCommandInTerminal } from '../../open-command-in-terminal.js';
import { createManagedAgentLaunch, createTerminalAgentLaunch } from '../../managed-agents.js';
import type { ManagedTool, ManagedToolState } from '../../managed-agents.js';
import { saveLauncherPreference } from '../../launcher-preferences.js';
import { getAgentDisplayLabel } from '../agent-display.js';
import type { CombinedAgentRow } from '../view.js';
import type { ChinwagConfig } from '../../config.js';
import type { NoticeTone } from '../reducer.js';

import { useManagedAgents } from './useManagedAgents.js';
import { useToolAvailability } from './useToolAvailability.js';

interface UseAgentLifecycleParams {
  config: ChinwagConfig | null;
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
 * Handles spawning, killing, restarting agents, tool availability checking,
 * and managed tool state tracking.
 */
export function useAgentLifecycle({
  config,
  teamId,
  projectRoot,
  stdout,
  flash,
}: UseAgentLifecycleParams): UseAgentLifecycleReturn {
  // ── Sub-hooks ──────────────────────────────────────
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

  // ── Actions ──────────────────────────────────────────

  function rememberLaunchTool(toolId: string): void {
    if (!teamId || !toolId) return;
    if (saveLauncherPreference(teamId, toolId)) {
      tools.setPreferredLaunchToolId(toolId);
    }
  }

  function selectLaunchTool(tool: ManagedTool): void {
    if (!tool) return;
    tools.setLaunchToolId(tool.id);
  }

  function cycleToolForward(): void {
    if (tools.launcherChoices.length <= 1) return;
    const currentIdx = tools.launcherChoices.findIndex((t) => t.id === tools.launchToolId);
    const nextIdx = (currentIdx + 1) % tools.launcherChoices.length;
    tools.setLaunchToolId(tools.launcherChoices[nextIdx].id);
  }

  function resolveReadyTool(query: string): ManagedTool | null {
    if (!query) return null;
    const normalized = query.toLowerCase();
    return (
      tools.readyCliAgents.find(
        (tool) =>
          tool.id === normalized ||
          tool.name.toLowerCase() === normalized ||
          tool.name.toLowerCase().startsWith(normalized) ||
          tool.id.startsWith(normalized),
      ) || null
    );
  }

  function refreshManagedToolStates({ clearRuntimeFailures = false } = {}): void {
    managed.setManagedToolStates((prev) => {
      if (!clearRuntimeFailures) return prev;
      const next: Record<string, ManagedToolState> = {};
      for (const [toolId, status] of Object.entries(prev)) {
        if (status?.source !== 'runtime') next[toolId] = status;
      }
      return next;
    });
    managed.setManagedToolStatusTick((tick) => tick + 1);
    flash('Rechecking tools...', { tone: 'info' });
  }

  function handleSpawnAgent(toolInfo: ManagedTool, task = '', options: SpawnOptions = {}): boolean {
    if (!toolInfo) return false;
    const { flashSuccess = true } = options;
    const toolState = tools.getManagedToolState(toolInfo.id);
    if (toolState.state !== 'ready') {
      const detail = toolState.detail || `${toolInfo.name} is not ready`;
      const hint = toolState.recoveryCommand ? ' Press [f] to fix.' : '';
      flash(`${detail}.${hint}`, { tone: 'warning' });
      return false;
    }

    try {
      // Try spawning in a real terminal tab first (full interactive UX)
      const termLaunch = createTerminalAgentLaunch({
        tool: toolInfo,
        task,
        cwd: projectRoot,
        token: config?.token || '',
      });
      const termResult = spawnInTerminal(termLaunch);
      if (termResult.ok) {
        registerExternalAgent({
          ...termLaunch,
          task: termLaunch.task || '',
          cwd: termLaunch.cwd || projectRoot,
        });
        if (flashSuccess) {
          const env = detectTerminalEnvironment();
          flash(`Opened ${toolInfo.name} in ${env.name}`, { tone: 'success' });
        }
        return true;
      }

      // Fallback: spawn via node-pty (captured output, no interactivity)
      const launch = createManagedAgentLaunch({
        tool: toolInfo,
        task,
        cwd: projectRoot,
        token: config?.token || '',
        cols: stdout?.columns,
        rows: stdout?.rows,
      });
      const result = spawnAgent(launch);
      if (result.status === 'failed') {
        flash(`Could not start ${toolInfo.name}.`, { tone: 'error' });
        return false;
      }
      if (flashSuccess) {
        flash(`Started ${toolInfo.name} in background.`, { tone: 'success' });
      }
      return true;
    } catch {
      flash(`Could not start ${toolInfo.name}.`, { tone: 'error' });
      return false;
    }
  }

  function launchManagedTask(
    toolInfo: ManagedTool,
    task: string,
    options: SpawnOptions = {},
  ): boolean {
    const didStart = handleSpawnAgent(toolInfo, task, options);
    if (didStart) {
      rememberLaunchTool(toolInfo.id);
    }
    return didStart;
  }

  function handleKillAgent(
    agent: CombinedAgentRow,
    liveAgentNameCounts: Map<string, number>,
  ): void {
    if (!agent?._managed) return;
    const didKill = killAgent(agent.id);
    if (!didKill) {
      flash(agent._dead ? 'Already stopped.' : 'Could not stop agent.', { tone: 'error' });
      return;
    }
    flash(`Stopping ${getAgentDisplayLabel(agent, liveAgentNameCounts)}`, { tone: 'info' });
  }

  function handleRemoveAgent(
    agent: CombinedAgentRow,
    liveAgentNameCounts: Map<string, number>,
  ): boolean | undefined {
    if (!agent?._managed) return;
    const removed = removeAgent(agent.id);
    if (removed) {
      flash(`Removed ${getAgentDisplayLabel(agent, liveAgentNameCounts)}`, { tone: 'success' });
    } else {
      flash('Could not remove agent.', { tone: 'error' });
    }
    return removed;
  }

  function handleRestartAgent(agent: CombinedAgentRow): boolean {
    if (!agent?._managed || !agent._dead) return false;
    const removed = removeAgent(agent.id);
    if (!removed) {
      flash('Could not restart. Try launching a new agent.', { tone: 'error' });
      return false;
    }
    launchManagedTask(
      {
        id: agent.tool || agent.toolId,
        name: agent.toolName || agent._display,
        cmd: agent.cmd,
        args: agent.args,
        taskArg: agent.taskArg,
        availabilityCheck: null,
        failurePatterns: [],
      },
      agent.task,
    );
    return true;
  }

  function handleFixLauncher(tool?: ManagedTool): void {
    const fixTool = tool || tools.unavailableCliAgents[0];
    if (!fixTool) {
      flash('No fix available.', { tone: 'warning' });
      return;
    }

    const status = tools.getManagedToolState(fixTool.id);
    if (!status.recoveryCommand) {
      flash(`No automatic fix for ${fixTool.name}.`, { tone: 'warning' });
      return;
    }

    const result = openCommandInTerminal(status.recoveryCommand, projectRoot);
    if (result.ok) {
      flash(`Opened ${fixTool.name} fix flow. Run /recheck when done.`, { tone: 'info' });
    } else {
      flash(`Run \`${status.recoveryCommand}\` manually, then /recheck.`, { tone: 'warning' });
    }
  }

  function handleToolPickerSelect(idx: number): void {
    const pickerTools =
      tools.readyCliAgents.length > 0 ? tools.readyCliAgents : managed.installedCliAgents;
    const tool = pickerTools[idx];
    if (tool) handleSpawnAgent(tool, '', { flashSuccess: true });
    tools.setToolPickerOpen(false);
  }

  function openToolPicker(): void {
    const pickerTools =
      tools.readyCliAgents.length > 0 ? tools.readyCliAgents : managed.installedCliAgents;
    if (pickerTools.length === 0) {
      flash('No tools configured. Run chinwag add <tool>.', { tone: 'warning' });
    } else if (pickerTools.length === 1) {
      handleSpawnAgent(pickerTools[0], '', { flashSuccess: true });
    } else {
      tools.setToolPickerIdx(0);
      tools.setToolPickerOpen(true);
    }
  }

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
    handleSpawnAgent,
    launchManagedTask,
    handleKillAgent,
    handleRemoveAgent,
    handleRestartAgent,
    handleFixLauncher,
    refreshManagedToolStates,
    resolveReadyTool,
    rememberLaunchTool,
    selectLaunchTool,
    cycleToolForward,
    handleToolPickerSelect,
    openToolPicker,
  };
}
