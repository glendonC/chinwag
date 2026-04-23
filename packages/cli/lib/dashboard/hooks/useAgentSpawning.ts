/**
 * Agent spawning logic: starting agents in terminal tabs or background,
 * and launching managed tasks with tool preference tracking.
 */
import { spawnAgent, registerExternalAgent } from '../../process-manager.js';
import { spawnInTerminal, detectTerminalEnvironment } from '../../terminal-spawner.js';
import { createManagedAgentLaunch, createTerminalAgentLaunch } from '../../managed-agents.js';
import type { ManagedTool } from '../../managed-agents.js';
import type { ChinmeisterConfig } from '../../config.js';
import type { NoticeTone } from '../reducer.js';
import type { UseToolAvailabilityReturn } from './useToolAvailability.js';

interface SpawnOptions {
  flashSuccess?: boolean;
}

interface UseAgentSpawningParams {
  config: ChinmeisterConfig | null;
  projectRoot: string;
  stdout: { columns?: number; rows?: number } | null;
  flash: (text: string, options?: { tone?: NoticeTone }) => void;
  tools: UseToolAvailabilityReturn;
  rememberLaunchTool: (toolId: string) => void;
}

export interface UseAgentSpawningReturn {
  handleSpawnAgent: (toolInfo: ManagedTool, task?: string, options?: SpawnOptions) => boolean;
  launchManagedTask: (toolInfo: ManagedTool, task: string, options?: SpawnOptions) => boolean;
}

export function useAgentSpawning({
  config,
  projectRoot,
  stdout,
  flash,
  tools,
  rememberLaunchTool,
}: UseAgentSpawningParams): UseAgentSpawningReturn {
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

  return {
    handleSpawnAgent,
    launchManagedTask,
  };
}
