/**
 * Process spawning, killing, cleanup, and external agent management.
 */
import { createRequire } from 'module';
import type { IPty } from 'node-pty';
import { shellQuote } from '../utils/shell.js';
import { formatError, createLogger } from '@chinwag/shared';
import { KILL_GRACE_MS, DEFAULT_COLS, DEFAULT_ROWS } from '../constants/timings.js';
import { appendOutput } from './output.js';
import { processes, allocateId, notifyUpdate, cleanupCompletedEntries } from './registry.js';
import type {
  ManagedProcess,
  SpawnAgentLaunch,
  SpawnAgentResult,
  AttachTerminalResult,
  RegisterExternalAgentParams,
} from './types.js';

const log = createLogger('process-lifecycle');

const require = createRequire(import.meta.url);

// Lazy-load node-pty (native module, can't be bundled)
type PtyModule = { spawn: (...args: unknown[]) => IPty };
let pty: PtyModule | undefined;
function loadPty(): PtyModule {
  if (!pty) pty = require('node-pty') as PtyModule;
  return pty!;
}

let exitCleanupRegistered = false;

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
          log.error(formatError(err));
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

  const id = allocateId();
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
    cleanupCompletedEntries();
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

    cleanupCompletedEntries();
    notifyUpdate();
  });

  notifyUpdate();

  return { id, toolId, toolName, task, status: 'running', startedAt: proc.startedAt, agentId };
}

/**
 * Kill a managed agent process. Sends SIGTERM first, then SIGKILL after grace period.
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
      log.error(formatError(err));
      return false;
    }
    if (!proc._killTimer) {
      proc._killTimer = setTimeout(() => {
        if (proc.status === 'running' && proc.pty) {
          try {
            proc.pty.kill('SIGKILL');
          } catch (err: unknown) {
            log.error(formatError(err));
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
      log.error(formatError(err));
      // Process already gone -- mark as exited
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
            log.error(formatError(err));
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
 * Resize a managed agent's pty.
 */
export function resizePty(id: number, cols: number, rows: number): void {
  const proc = processes.get(id);
  if (!proc || !proc.pty) return;
  try {
    proc.pty.resize(cols, rows);
  } catch (err: unknown) {
    log.error(formatError(err));
  }
}

/**
 * Attach raw terminal I/O to a managed agent's pty.
 * Pipes pty output directly to process.stdout and returns an interface for input.
 * This bypasses Ink entirely -- the agent gets full terminal control.
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

  // Raw output: pty -> stdout (no stripping, terminal renders natively)
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
  const id = allocateId();
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
      log.error(formatError(err));
      proc.status = 'exited';
      proc.exitCode = null;
      changed = true;
    }
  }
  if (changed) {
    cleanupCompletedEntries();
    notifyUpdate();
  }
  return changed;
}
