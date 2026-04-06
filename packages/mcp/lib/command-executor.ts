// Command executor for the MCP server.
// Spawns/stops agents via child_process (built-in Node.js, no native deps).
// The spawned tool starts its own MCP server and joins the team automatically.
// CRITICAL: Never console.log — stdio transport.

import { spawn, execFileSync } from 'node:child_process';
import { MCP_TOOLS } from '@chinwag/shared/tool-registry.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('command-executor');

interface SpawnedProcess {
  pid: number;
  toolId: string;
  startedAt: number;
}

const spawnedProcesses = new Map<number, SpawnedProcess>();

/**
 * Detect which spawnable tools are installed on this machine.
 * Checks each tool's spawn.cmd against PATH via `which`.
 */
export function detectSpawnableTools(): string[] {
  return MCP_TOOLS.filter((t) => t.spawn)
    .filter((t) => {
      try {
        execFileSync('which', [t.spawn!.cmd], { stdio: 'ignore', timeout: 3000 });
        return true;
      } catch {
        return false;
      }
    })
    .map((t) => t.id);
}

/**
 * Spawn a tool as a fully detached child process.
 * The spawned process survives MCP server exit via child.unref().
 */
export function executeSpawnCommand(
  payload: Record<string, unknown>,
  cwd: string,
): Record<string, unknown> {
  const toolId = (payload.tool_id as string) || 'claude-code';
  const task = payload.task as string | undefined;

  const tool = MCP_TOOLS.find((t) => t.id === toolId && t.spawn);
  if (!tool?.spawn) return { error: `Tool not available: ${toolId}` };

  try {
    const args = [...(tool.spawn.args || [])];
    if (task) args.push(task);

    const child = spawn(tool.spawn.cmd, args, {
      cwd: (payload.cwd as string) || cwd,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, CHINWAG_TOOL: toolId },
    });

    child.unref();

    if (child.pid) {
      spawnedProcesses.set(child.pid, { pid: child.pid, toolId, startedAt: Date.now() });
      log.info(`Spawned ${toolId} (PID ${child.pid})`);
      return { ok: true, pid: child.pid, tool_id: toolId };
    }

    return { error: 'Failed to spawn — no PID returned' };
  } catch (err) {
    return { error: String((err as Error).message || err) };
  }
}

/**
 * Stop a spawned process by PID.
 */
export function executeStopCommand(payload: Record<string, unknown>): Record<string, unknown> {
  const pid = payload.pid as number;

  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
      spawnedProcesses.delete(pid);
      return { ok: true };
    } catch {
      spawnedProcesses.delete(pid);
      return { error: `Failed to stop process ${pid}` };
    }
  }

  return { error: 'pid is required' };
}
