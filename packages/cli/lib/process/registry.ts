/**
 * Process registry: the central Map of managed processes, lookup functions,
 * status tracking, update notifications, and cleanup of completed entries.
 */
import { formatError, createLogger } from '@chinwag/shared';
import { summarizeOutput } from './output.js';
import type { ManagedProcess, AgentInfo } from './types.js';

const log = createLogger('process-registry');

// ── Registry state ───────────────────────────────────
export const processes = new Map<number, ManagedProcess>();
let updateCallbacks: Array<(agents: AgentInfo[]) => void> = [];
export let nextId = 1;

/**
 * Maximum number of completed (exited/failed) process entries to retain.
 * When exceeded, the oldest completed entries are pruned to prevent memory leaks.
 */
const MAX_COMPLETED_ENTRIES = 100;

/**
 * Increment and return the next process ID.
 */
export function allocateId(): number {
  return nextId++;
}

/**
 * Notify all registered listeners of a state change.
 */
export function notifyUpdate(): void {
  const agents = getAgents();
  for (const cb of updateCallbacks) {
    try {
      cb(agents);
    } catch (err: unknown) {
      // Swallow callback errors -- never let a listener break the manager
      log.error(formatError(err));
    }
  }
}

/**
 * Get all managed agents with their current status.
 */
export function getAgents(): AgentInfo[] {
  return Array.from(processes.values()).map((proc) => ({
    id: proc.id,
    toolId: proc.toolId,
    toolName: proc.toolName,
    cmd: proc.cmd,
    args: proc.args,
    taskArg: proc.taskArg,
    task: proc.task,
    cwd: proc.cwd,
    agentId: proc.agentId,
    status: proc.status,
    startedAt: proc.startedAt,
    exitCode: proc.exitCode,
    spawnType: proc.spawnType || 'pty',
    outputPreview: summarizeOutput(proc.outputBuffer, proc.task),
  }));
}

/**
 * Get the last N lines of output for an agent.
 */
export function getOutput(id: number, lines = 20): string[] {
  const proc = processes.get(id);
  if (!proc) return [];

  const buf = proc.outputBuffer;
  if (lines >= buf.length) return [...buf];
  return buf.slice(-lines);
}

/**
 * Register a callback that fires when agent state changes (output, exit, spawn).
 */
export function onUpdate(callback: (agents: AgentInfo[]) => void): () => void {
  updateCallbacks.push(callback);
  return () => {
    updateCallbacks = updateCallbacks.filter((cb) => cb !== callback);
  };
}

/**
 * Wait for a managed agent to exit.
 */
export function waitForExit(id: number): Promise<number | null> {
  const existing = processes.get(id);
  if (!existing || existing.status !== 'running') {
    return Promise.resolve(existing?.exitCode ?? null);
  }

  return new Promise((resolve) => {
    const unsubscribe = onUpdate(() => {
      const proc = processes.get(id);
      if (!proc || proc.status !== 'running') {
        unsubscribe();
        resolve(proc?.exitCode ?? null);
      }
    });
  });
}

/**
 * Remove a dead agent from the list. Only removes agents that are no longer running.
 */
export function removeAgent(id: number): boolean {
  const proc = processes.get(id);
  if (!proc) return false;

  // Don't remove running processes -- kill them first
  if (proc.status === 'running') return false;

  processes.delete(id);
  notifyUpdate();
  return true;
}

/**
 * Clean up completed process entries when the count exceeds MAX_COMPLETED_ENTRIES.
 * Removes the oldest completed entries first. Only cleans up processes
 * that have fully exited (not running ones).
 */
export function cleanupCompletedEntries(): void {
  const completed: Array<{ id: number; startedAt: number }> = [];
  for (const proc of processes.values()) {
    if (proc.status !== 'running') {
      completed.push({ id: proc.id, startedAt: proc.startedAt });
    }
  }

  if (completed.length <= MAX_COMPLETED_ENTRIES) return;

  // Sort oldest first
  completed.sort((a, b) => a.startedAt - b.startedAt);

  const toRemove = completed.length - MAX_COMPLETED_ENTRIES;
  for (let i = 0; i < toRemove; i++) {
    processes.delete(completed[i].id);
  }
}
