// Command executor for the MCP server.
// Spawns/stops agents via child_process (built-in Node.js, no native deps).
// The spawned tool starts its own MCP server and joins the team automatically.
// CRITICAL: Never console.log - stdio transport.

import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { MCP_TOOLS } from '@chinmeister/shared/tool-registry.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('command-executor');

const KILL_GRACE_MS = 5000;

interface SpawnedProcess {
  pid: number;
  toolId: string;
  startedAt: number;
  exitCode?: number | null;
  exitedAt?: number;
  child?: ChildProcess;
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
 * Spawn a tool as a detached child process.
 * The spawned process survives MCP server exit. Exit code is captured
 * while the parent is alive; on parent shutdown all children are unref'd.
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
      env: { ...process.env, CHINMEISTER_TOOL: toolId },
    });

    if (child.pid) {
      const entry: SpawnedProcess = {
        pid: child.pid,
        toolId,
        startedAt: Date.now(),
        child,
      };
      spawnedProcesses.set(child.pid, entry);

      // Capture exit code while parent is alive, then clean up map entry
      child.on('exit', (code) => {
        log.info(`Spawned ${toolId} (PID ${child.pid}) exited with code ${code}`);
        spawnedProcesses.delete(child.pid!);
      });

      child.on('error', (err) => {
        log.warn(`Spawned ${toolId} (PID ${child.pid}) error: ${err.message}`);
        spawnedProcesses.delete(child.pid!);
      });

      log.info(`Spawned ${toolId} (PID ${child.pid})`);
      return { ok: true, pid: child.pid, tool_id: toolId };
    }

    return { error: 'Failed to spawn - no PID returned' };
  } catch (err) {
    return { error: String((err as Error).message || err) };
  }
}

/**
 * Stop a spawned process by PID with graceful shutdown.
 * Sends SIGTERM first, then SIGKILL after grace period.
 */
export function executeStopCommand(payload: Record<string, unknown>): Record<string, unknown> {
  const pid = payload.pid as number;

  if (pid) {
    const entry = spawnedProcesses.get(pid);
    try {
      process.kill(pid, 'SIGTERM');
      // Force kill after grace period if still running
      setTimeout(() => {
        try {
          process.kill(pid, 0); // Check if still alive
          process.kill(pid, 'SIGKILL');
          log.info(`Force-killed PID ${pid} after grace period`);
        } catch {
          // Already dead - expected
        }
      }, KILL_GRACE_MS);
      if (entry) {
        entry.exitCode = null;
        entry.exitedAt = Date.now();
        delete entry.child;
      }
      spawnedProcesses.delete(pid);
      return { ok: true };
    } catch {
      spawnedProcesses.delete(pid);
      return { error: `Failed to stop process ${pid}` };
    }
  }

  return { error: 'pid is required' };
}

/**
 * Release all spawned child references so the parent can exit cleanly.
 * Called during MCP server shutdown.
 */
export function cleanupSpawnedProcesses(): void {
  for (const [, entry] of spawnedProcesses) {
    if (entry.child) {
      entry.child.unref();
      delete entry.child;
    }
  }
}
