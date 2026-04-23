/**
 * Agent lifecycle actions and tool picker UI logic: kill, remove, restart,
 * fix launcher, tool picker selection, and opening the tool picker.
 */
import { killAgent, removeAgent } from '../../process-manager.js';
import { openCommandInTerminal } from '../../open-command-in-terminal.js';
import type { ManagedTool } from '../../managed-agents.js';
import { getAgentDisplayLabel } from '../agent-display.js';
import type { CombinedAgentRow } from '../view.js';
import type { NoticeTone } from '../reducer.js';
import type { UseToolAvailabilityReturn } from './useToolAvailability.js';
import type { UseManagedAgentsReturn } from './useManagedAgents.js';

interface UseAgentActionsParams {
  tools: UseToolAvailabilityReturn;
  managed: UseManagedAgentsReturn;
  flash: (text: string, options?: { tone?: NoticeTone }) => void;
  projectRoot: string;
  handleSpawnAgent: (
    toolInfo: ManagedTool,
    task?: string,
    options?: { flashSuccess?: boolean },
  ) => boolean;
  launchManagedTask: (
    toolInfo: ManagedTool,
    task: string,
    options?: { flashSuccess?: boolean },
  ) => boolean;
}

export interface UseAgentActionsReturn {
  handleKillAgent: (agent: CombinedAgentRow, liveAgentNameCounts: Map<string, number>) => void;
  handleRemoveAgent: (
    agent: CombinedAgentRow,
    liveAgentNameCounts: Map<string, number>,
  ) => boolean | undefined;
  handleRestartAgent: (agent: CombinedAgentRow) => boolean;
  handleFixLauncher: (tool?: ManagedTool) => void;
  handleToolPickerSelect: (idx: number) => void;
  openToolPicker: () => void;
}

export function useAgentActions({
  tools,
  managed,
  flash,
  projectRoot,
  handleSpawnAgent,
  launchManagedTask,
}: UseAgentActionsParams): UseAgentActionsReturn {
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
      flash('No tools configured. Run chinmeister add <tool>.', { tone: 'warning' });
    } else if (pickerTools.length === 1 && pickerTools[0]) {
      handleSpawnAgent(pickerTools[0], '', { flashSuccess: true });
    } else {
      tools.setToolPickerIdx(0);
      tools.setToolPickerOpen(true);
    }
  }

  return {
    handleKillAgent,
    handleRemoveAgent,
    handleRestartAgent,
    handleFixLauncher,
    handleToolPickerSelect,
    openToolPicker,
  };
}
