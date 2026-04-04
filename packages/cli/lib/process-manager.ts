/**
 * Process manager for spawning and managing AI agent processes via node-pty.
 *
 * Native module (node-pty) is lazy-loaded via createRequire to avoid esbuild
 * bundling issues. This module is imported by the dashboard.
 */

import { createRequire } from 'module';
import type { IPty } from 'node-pty';
import { shellQuote } from './utils/shell.js';
import { stripAnsi } from './utils/ansi.js';
import { formatError } from '@chinwag/shared';

const require = createRequire(import.meta.url);

// Lazy-load node-pty (native module, can't be bundled)
type PtyModule = { spawn: (...args: unknown[]) => IPty };
let pty: PtyModule | undefined;
function loadPty(): PtyModule {
  if (!pty) pty = require('node-pty') as PtyModule;
  return pty!;
}

export interface ManagedProcess {
  id: number;
  toolId: string;
  toolName: string;
  cmd: string;
  args: string[];
  taskArg: string;
  task: string;
  cwd: string;
  agentId: string | null;
  pty: IPty | null;
  pid?: number | null;
  spawnType?: string;
  status: 'running' | 'exited' | 'failed';
  outputBuffer: string[];
  startedAt: number;
  exitCode: number | null;
  _lastNewline: boolean;
  _killTimer: ReturnType<typeof setTimeout> | null;
}

export interface AgentInfo {
  id: number;
  toolId: string;
  toolName: string;
  cmd: string;
  args: string[];
  taskArg: string;
  task: string;
  cwd: string;
  agentId: string | null;
  status: string;
  startedAt: number;
  exitCode: number | null;
  spawnType: string;
  outputPreview: string | null;
}

export interface SpawnAgentResult {
  id: number;
  toolId: string;
  toolName: string;
  task: string;
  status: string;
  startedAt: number;
  agentId: string | null;
}

export interface SpawnAgentLaunch {
  toolId: string;
  toolName?: string;
  cmd: string;
  args?: string[];
  taskArg?: string;
  task: string;
  cwd: string;
  agentId?: string | null;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

export interface AttachTerminalResult {
  dispose: () => void;
  write: (data: string) => void;
}

export interface RegisterExternalAgentParams {
  toolId: string;
  toolName?: string;
  cmd: string;
  args?: string[];
  taskArg?: string;
  task: string;
  cwd: string;
  agentId?: string | null;
  pid?: number | null;
}

const processes = new Map<number, ManagedProcess>();

let updateCallbacks: Array<(agents: AgentInfo[]) => void> = [];

let nextId = 1;
let exitCleanupRegistered = false;

const MAX_OUTPUT_LINES = 200;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const KILL_GRACE_MS = 5000;

function looksLikeTerminalNoise(line: string): boolean {
  return /^(\[[0-9;?<>A-Za-z]+)+$/.test(line);
}

function summarizeOutput(outputBuffer: string[], task = ''): string | null {
  const taskText = task.trim();
  const lines = outputBuffer
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean)
    .filter((line) => line !== taskText);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^(Done in \d+ms|Live|Running|Completed|failed \(|exited \()/i.test(line)) continue;
    if (/^(No files reported yet|No current work summary|No captured output yet)$/i.test(line))
      continue;
    if (looksLikeTerminalNoise(line)) continue;
    return line.slice(0, 200);
  }

  return null;
}

interface BuildCommandParams {
  cmd: string;
  args?: string[];
  taskArg?: string;
  task: string;
}

function buildCommand({
  cmd,
  args = [],
  taskArg = 'positional',
  task,
}: BuildCommandParams): string {
  const commandArgs = [cmd];
  if (args.length > 0) {
    commandArgs.push(...args);
    commandArgs.push(task);
  } else if (taskArg === '--message') {
    commandArgs.push('--message', task);
  } else {
    commandArgs.push(task);
  }

  return commandArgs.map(shellQuote).join(' ');
}

function notifyUpdate(): void {
  const agents = getAgents();
  for (const cb of updateCallbacks) {
    try {
      cb(agents);
    } catch (err: unknown) {
      // Swallow callback errors — never let a listener break the manager
      console.error('[chinwag]', formatError(err));
    }
  }
}

/**
 * Append a line to the circular output buffer, maintaining the max size.
 */
function appendOutput(proc: ManagedProcess, data: string): void {
  // Split incoming data on newlines, merge with any partial last line
  const lines = data.split('\n');

  if (lines.length === 0) return;

  // If buffer has content, the last entry might be a partial line — append to it
  if (proc.outputBuffer.length > 0 && !proc._lastNewline) {
    proc.outputBuffer[proc.outputBuffer.length - 1] += lines[0];
    lines.shift();
  }

  for (const line of lines) {
    proc.outputBuffer.push(line);
  }

  // Track whether last chunk ended with a newline
  proc._lastNewline = data.endsWith('\n');

  // Trim to max buffer size
  if (proc.outputBuffer.length > MAX_OUTPUT_LINES) {
    proc.outputBuffer = proc.outputBuffer.slice(-MAX_OUTPUT_LINES);
  }
}

/**
 * Spawn a new agent process.
 *
 * Runs the configured CLI agent command in the given working directory.
 */
export function spawnAgent(launch: SpawnAgentLaunch): SpawnAgentResult {
  const nodePty = loadPty();

  const {
    toolId,
    toolName = toolId,
    cmd,
    args = [],
    taskArg = 'positional',
    task,
    cwd,
    agentId = null,
    env = process.env,
    cols = DEFAULT_COLS,
    rows = DEFAULT_ROWS,
  } = launch || {};

  if (!toolId || !cmd || !task || !cwd) {
    throw new Error('spawnAgent requires toolId, cmd, task, and cwd');
  }

  // Register one-time exit handler to kill child processes on parent exit
  if (!exitCleanupRegistered) {
    exitCleanupRegistered = true;
    const cleanup = () => {
      for (const proc of processes.values()) {
        if (proc.status !== 'running') continue;
        try {
          if (proc.pty) proc.pty.kill('SIGTERM');
          else if (proc.pid) process.kill(proc.pid, 'SIGTERM');
        } catch (err: unknown) {
          console.error('[chinwag]', formatError(err));
        }
      }
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => {
      cleanup();
      process.exit(130);
    });
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(143);
    });
  }

  const id = nextId++;
  const shell = process.env.SHELL || 'bash';
  const command = buildCommand({ cmd, args, taskArg, task });

  let ptyProcess: IPty;
  try {
    ptyProcess = nodePty.spawn(shell, ['-c', command], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });
  } catch (err: unknown) {
    // If pty spawn itself fails, record as failed immediately
    const failedProc: ManagedProcess = {
      id,
      toolId,
      toolName,
      cmd,
      args,
      taskArg,
      task,
      cwd,
      agentId,
      pty: null,
      status: 'failed',
      outputBuffer: [formatError(err)],
      startedAt: Date.now(),
      exitCode: null,
      _lastNewline: true,
      _killTimer: null,
    };
    processes.set(id, failedProc);
    notifyUpdate();
    return {
      id,
      toolId,
      toolName,
      task,
      status: 'failed',
      startedAt: failedProc.startedAt,
      agentId,
    };
  }

  const proc: ManagedProcess = {
    id,
    toolId,
    toolName,
    cmd,
    args,
    taskArg,
    task,
    cwd,
    agentId,
    pty: ptyProcess,
    status: 'running',
    outputBuffer: [],
    startedAt: Date.now(),
    exitCode: null,
    _lastNewline: true,
    _killTimer: null,
  };

  processes.set(id, proc);

  // Collect output
  ptyProcess.onData((data: string) => {
    appendOutput(proc, data);
    notifyUpdate();
  });

  // Handle exit
  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    proc.exitCode = exitCode;
    proc.status = exitCode === 0 ? 'exited' : 'failed';
    proc.pty = null;

    // Clear any pending kill timer
    if (proc._killTimer) {
      clearTimeout(proc._killTimer);
      proc._killTimer = null;
    }

    notifyUpdate();
  });

  notifyUpdate();

  return { id, toolId, toolName, task, status: 'running', startedAt: proc.startedAt, agentId };
}

/**
 * Kill a managed agent process. Sends SIGTERM first, then SIGKILL after 5 seconds.
 */
export function killAgent(id: number): boolean {
  const proc = processes.get(id);
  if (!proc) return false;
  if (proc.status !== 'running') return false;

  // PTY-based agent (spawned via node-pty)
  if (proc.pty) {
    try {
      proc.pty.kill('SIGTERM');
    } catch (err: unknown) {
      console.error('[chinwag]', formatError(err));
      return false;
    }
    if (!proc._killTimer) {
      proc._killTimer = setTimeout(() => {
        if (proc.status === 'running' && proc.pty) {
          try {
            proc.pty.kill('SIGKILL');
          } catch (err: unknown) {
            console.error('[chinwag]', formatError(err));
          }
        }
        proc._killTimer = null;
      }, KILL_GRACE_MS);
    }
    return true;
  }

  // External agent (spawned in terminal tab, tracked by PID)
  if (proc.pid) {
    try {
      process.kill(proc.pid, 'SIGTERM');
    } catch (err: unknown) {
      console.error('[chinwag]', formatError(err));
      // Process already gone — mark as exited
      proc.status = 'exited';
      proc.exitCode = null;
      notifyUpdate();
      return true;
    }
    if (!proc._killTimer) {
      proc._killTimer = setTimeout(() => {
        if (proc.status === 'running') {
          try {
            process.kill(proc.pid!, 'SIGKILL');
          } catch (err: unknown) {
            console.error('[chinwag]', formatError(err));
          }
        }
        proc._killTimer = null;
      }, KILL_GRACE_MS);
    }
    return true;
  }

  return false;
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
 * Resize a managed agent's pty.
 */
export function resizePty(id: number, cols: number, rows: number): void {
  const proc = processes.get(id);
  if (!proc || !proc.pty) return;
  try {
    proc.pty.resize(cols, rows);
  } catch (err: unknown) {
    console.error('[chinwag]', formatError(err));
  }
}

/**
 * Attach raw terminal I/O to a managed agent's pty.
 * Pipes pty output directly to process.stdout and returns an interface for input.
 * This bypasses Ink entirely — the agent gets full terminal control.
 */
export function attachTerminal(
  id: number,
  options: { replayBuffer?: boolean } = {},
): AttachTerminalResult | null {
  const proc = processes.get(id);
  if (!proc || !proc.pty || proc.status !== 'running') return null;

  if (options.replayBuffer && proc.outputBuffer.length > 0) {
    const text = proc.outputBuffer.join('\n');
    process.stdout.write(text);
    if (!text.endsWith('\n')) process.stdout.write('\n');
  }

  // Raw output: pty → stdout (no stripping, terminal renders natively)
  const disposable = proc.pty.onData((data: string) => {
    process.stdout.write(data);
  });

  return {
    dispose: () => disposable.dispose(),
    write: (data: string) => {
      if (proc.pty) proc.pty.write(data);
    },
  };
}

/**
 * Remove a dead agent from the list. Only removes agents that are no longer running.
 */
export function removeAgent(id: number): boolean {
  const proc = processes.get(id);
  if (!proc) return false;

  // Don't remove running processes — kill them first
  if (proc.status === 'running') return false;

  processes.delete(id);
  notifyUpdate();
  return true;
}

/**
 * Register an externally-spawned agent (terminal tab).
 * No pty, no output buffer. Tracked by PID for lifecycle management.
 */
export function registerExternalAgent({
  toolId,
  toolName,
  cmd,
  args = [],
  taskArg,
  task,
  cwd,
  agentId = null,
  pid = null,
}: RegisterExternalAgentParams): SpawnAgentResult {
  const id = nextId++;
  const proc: ManagedProcess = {
    id,
    toolId,
    toolName: toolName || toolId,
    cmd,
    args,
    taskArg: taskArg || 'positional',
    task,
    cwd,
    agentId: agentId ?? null,
    pty: null,
    pid,
    spawnType: 'external',
    status: 'running',
    startedAt: Date.now(),
    exitCode: null,
    outputBuffer: [],
    _lastNewline: true,
    _killTimer: null,
  };
  processes.set(id, proc);
  notifyUpdate();
  return {
    id,
    toolId,
    toolName: proc.toolName,
    task,
    status: 'running',
    startedAt: proc.startedAt,
    agentId: proc.agentId,
  };
}

/**
 * Update the PID of an external agent (resolved from pidfile after spawn).
 */
export function setExternalAgentPid(id: number, pid: number): void {
  const proc = processes.get(id);
  if (!proc || proc.pty) return;
  proc.pid = pid;
}

/**
 * Check liveness of external agents. Mark dead ones as exited.
 * Returns true if any state changed.
 */
export function checkExternalAgentLiveness(): boolean {
  let changed = false;
  for (const proc of processes.values()) {
    if (proc.spawnType !== 'external' || proc.status !== 'running') continue;
    if (!proc.pid) continue;
    try {
      process.kill(proc.pid, 0);
    } catch (err: unknown) {
      console.error('[chinwag]', formatError(err));
      proc.status = 'exited';
      proc.exitCode = null;
      changed = true;
    }
  }
  if (changed) notifyUpdate();
  return changed;
}
