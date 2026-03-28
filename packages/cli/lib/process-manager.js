/**
 * Process manager for spawning and managing AI agent processes via node-pty.
 *
 * Native module (node-pty) is lazy-loaded via createRequire to avoid esbuild
 * bundling issues. This module is imported by the dashboard.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Lazy-load node-pty (native module, can't be bundled)
let pty;
function loadPty() {
  if (!pty) pty = require('node-pty');
  return pty;
}

/** @type {Map<number, ManagedProcess>} */
const processes = new Map();

/** @type {Array<(agents: ManagedProcess[]) => void>} */
let updateCallbacks = [];

let nextId = 1;

const MAX_OUTPUT_LINES = 200;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const KILL_GRACE_MS = 5000;

function shellQuote(value) {
  return JSON.stringify(String(value));
}

function stripAnsi(str) {
  return str
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[P^_][\s\S]*?\x1b\\/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/\r/g, '');
}

function looksLikeTerminalNoise(line) {
  return /^(\[[0-9;?<>A-Za-z]+)+$/.test(line);
}

function summarizeOutput(outputBuffer, task = '') {
  const taskText = task.trim();
  const lines = outputBuffer
    .map(line => stripAnsi(line).trim())
    .filter(Boolean)
    .filter(line => line !== taskText);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^(Done in \d+ms|Live|Running|Completed|failed \(|exited \()/i.test(line)) continue;
    if (/^(No files reported yet|No current work summary|No captured output yet)$/i.test(line)) continue;
    if (looksLikeTerminalNoise(line)) continue;
    return line.slice(0, 200);
  }

  return null;
}

function buildCommand({ cmd, args = [], taskArg = 'positional', task }) {
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
 * @typedef {Object} ManagedProcess
 * @property {number} id
 * @property {string} toolId
 * @property {string} toolName
 * @property {string} cmd
 * @property {string[]} args
 * @property {'positional'|'--message'} taskArg
 * @property {string} task
 * @property {string} cwd
 * @property {string|null} agentId
 * @property {import('node-pty').IPty} pty
 * @property {'running'|'exited'|'failed'} status
 * @property {string[]} outputBuffer
 * @property {number} startedAt
 * @property {number|null} exitCode
 */

function notifyUpdate() {
  const agents = getAgents();
  for (const cb of updateCallbacks) {
    try {
      cb(agents);
    } catch {
      // Swallow callback errors — never let a listener break the manager
    }
  }
}

/**
 * Append a line to the circular output buffer, maintaining the max size.
 */
function appendOutput(proc, data) {
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
 *
 * @param {{
 *   toolId: string,
 *   toolName?: string,
 *   cmd: string,
 *   args?: string[],
 *   taskArg?: 'positional'|'--message',
 *   task: string,
 *   cwd: string,
 *   agentId?: string|null,
 *   env?: NodeJS.ProcessEnv,
 *   cols?: number,
 *   rows?: number,
 * }} launch
 * @returns {{ id: number, toolId: string, toolName: string, task: string, status: string, startedAt: number, agentId: string|null }}
 */
export function spawnAgent(launch) {
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

  const id = nextId++;
  const shell = process.env.SHELL || 'bash';
  const command = buildCommand({ cmd, args, taskArg, task });

  let ptyProcess;
  try {
    ptyProcess = nodePty.spawn(shell, ['-c', command], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });
  } catch (err) {
    // If pty spawn itself fails, record as failed immediately
    const failedProc = {
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
      outputBuffer: [err.message || 'Failed to spawn process'],
      startedAt: Date.now(),
      exitCode: null,
      _lastNewline: true,
      _killTimer: null,
    };
    processes.set(id, failedProc);
    notifyUpdate();
    return { id, toolId, toolName, task, status: 'failed', startedAt: failedProc.startedAt, agentId };
  }

  /** @type {ManagedProcess} */
  const proc = {
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
  ptyProcess.onData((data) => {
    appendOutput(proc, data);
    notifyUpdate();
  });

  // Handle exit
  ptyProcess.onExit(({ exitCode }) => {
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
 *
 * @param {number} id - Process ID
 * @returns {boolean} Whether the process was found and a kill signal was sent
 */
export function killAgent(id) {
  const proc = processes.get(id);
  if (!proc) return false;

  // Already dead
  if (proc.status !== 'running' || !proc.pty) return false;

  try {
    proc.pty.kill('SIGTERM');
  } catch {
    // Process may already be gone
    return false;
  }

  // Schedule SIGKILL if it doesn't exit gracefully
  if (!proc._killTimer) {
    proc._killTimer = setTimeout(() => {
      if (proc.status === 'running' && proc.pty) {
        try {
          proc.pty.kill('SIGKILL');
        } catch {
          // Already gone
        }
      }
      proc._killTimer = null;
    }, KILL_GRACE_MS);
  }

  return true;
}

/**
 * Get all managed agents with their current status.
 *
 * @returns {Array<{ id: number, toolId: string, toolName: string, cmd: string, args: string[], taskArg: 'positional'|'--message', task: string, cwd: string, agentId: string|null, status: string, startedAt: number, exitCode: number|null, outputPreview: string|null }>}
 */
export function getAgents() {
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
    outputPreview: summarizeOutput(proc.outputBuffer, proc.task),
  }));
}

/**
 * Get the last N lines of output for an agent.
 *
 * @param {number} id - Process ID
 * @param {number} [lines=20] - Number of lines to return
 * @returns {string[]} Array of output lines, or empty array if not found
 */
export function getOutput(id, lines = 20) {
  const proc = processes.get(id);
  if (!proc) return [];

  const buf = proc.outputBuffer;
  if (lines >= buf.length) return [...buf];
  return buf.slice(-lines);
}

/**
 * Register a callback that fires when agent state changes (output, exit, spawn).
 *
 * @param {(agents: Array<{ id: number, toolId: string, toolName: string, cmd: string, args: string[], taskArg: 'positional'|'--message', task: string, cwd: string, agentId: string|null, status: string, startedAt: number, exitCode: number|null, outputPreview: string|null }>) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export function onUpdate(callback) {
  updateCallbacks.push(callback);
  return () => {
    updateCallbacks = updateCallbacks.filter((cb) => cb !== callback);
  };
}

/**
 * Wait for a managed agent to exit.
 *
 * @param {number} id - Process ID
 * @returns {Promise<number|null>} Resolves with the exit code once the process stops
 */
export function waitForExit(id) {
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
 * Write input data to a managed agent's pty (forward keyboard input).
 *
 * @param {number} id - Process ID
 * @param {string} data - Data to write (keystrokes, text)
 * @returns {boolean} Whether the write succeeded
 */
export function writeInput(id, data) {
  const proc = processes.get(id);
  if (!proc || proc.status !== 'running' || !proc.pty) return false;
  try {
    proc.pty.write(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resize a managed agent's pty.
 *
 * @param {number} id - Process ID
 * @param {number} cols - New column count
 * @param {number} rows - New row count
 */
export function resizePty(id, cols, rows) {
  const proc = processes.get(id);
  if (!proc || !proc.pty) return;
  try {
    proc.pty.resize(cols, rows);
  } catch {}
}

/**
 * Attach raw terminal I/O to a managed agent's pty.
 * Pipes pty output directly to process.stdout and returns an interface for input.
 * This bypasses Ink entirely — the agent gets full terminal control.
 *
 * @param {number} id - Process ID
 * @param {{ replayBuffer?: boolean }} [options]
 * @returns {{ dispose: () => void, write: (data: string) => void } | null}
 */
export function attachTerminal(id, options = {}) {
  const proc = processes.get(id);
  if (!proc || !proc.pty || proc.status !== 'running') return null;

  if (options.replayBuffer && proc.outputBuffer.length > 0) {
    const text = proc.outputBuffer.join('\n');
    process.stdout.write(text);
    if (!text.endsWith('\n')) process.stdout.write('\n');
  }

  // Raw output: pty → stdout (no stripping, terminal renders natively)
  const disposable = proc.pty.onData((data) => {
    process.stdout.write(data);
  });

  return {
    dispose: () => disposable.dispose(),
    write: (data) => {
      if (proc.pty) proc.pty.write(data);
    },
  };
}

/**
 * Remove a dead agent from the list. Only removes agents that are no longer running.
 *
 * @param {number} id - Process ID
 * @returns {boolean} Whether the agent was removed
 */
export function removeAgent(id) {
  const proc = processes.get(id);
  if (!proc) return false;

  // Don't remove running processes — kill them first
  if (proc.status === 'running') return false;

  processes.delete(id);
  notifyUpdate();
  return true;
}
