import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { execFile, execFileSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

/**
 * @typedef {Object} SessionRecord
 * @property {string} agentId
 * @property {number} pid - Process ID
 * @property {string} tool - Tool ID
 * @property {string} cwd - Working directory
 * @property {string|null} tty - TTY device path or null
 * @property {number} [createdAt] - Unix timestamp (ms)
 * @property {string} [commandMarker] - String to verify in process command
 */

/**
 * @typedef {Object} ResolveSessionOptions
 * @property {string} [tool] - Tool ID to match
 * @property {string} [cwd] - Working directory to match
 * @property {string|null} [tty] - TTY path to match
 * @property {string|null} [fallbackAgentId] - Returned when no match found
 * @property {string} [homeDir] - Override home directory
 * @property {(record: SessionRecord) => boolean} [recordAlive] - Custom liveness checker
 */

const EXEC_TIMEOUT_MS = 5000;

/** @type {string} */
export const SESSION_COMMAND_MARKER = 'chinwag-mcp';

/**
 * @param {string} [homeDir] - Override home directory
 * @returns {string}
 */
export function getSessionsDir(homeDir = homedir()) {
  return join(homeDir, '.chinwag', 'sessions');
}

/**
 * @param {string} agentId
 * @returns {string}
 */
export function safeAgentId(agentId) {
  return agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * @param {string} agentId
 * @param {string} [homeDir] - Override home directory
 * @returns {string}
 */
export function getSessionFilePath(agentId, homeDir = homedir()) {
  return join(getSessionsDir(homeDir), `${safeAgentId(agentId)}.json`);
}

/**
 * @param {number} [pid] - Process ID to check (defaults to process.ppid)
 * @returns {string|null}
 */
export function getCurrentTtyPath(pid = process.ppid) {
  try {
    const ttyName = execFileSync('ps', ['-o', 'tty=', '-p', String(pid)], { encoding: 'utf-8', timeout: EXEC_TIMEOUT_MS }).trim();
    if (ttyName && ttyName !== '??' && ttyName !== '?') {
      return `/dev/${ttyName}`;
    }
  } catch {}
  return null;
}

function getProcessCommand(pid) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf-8', timeout: EXEC_TIMEOUT_MS }).trim();
  } catch {
    return null;
  }
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {SessionRecord} record
 * @param {Object} [options]
 * @param {(pid: number) => boolean} [options.processAlive]
 * @param {(pid: number) => string|null} [options.processCommand]
 * @returns {boolean}
 */
export function isSessionRecordAlive(record, {
  processAlive = isProcessAlive,
  processCommand = getProcessCommand,
} = {}) {
  if (!record?.pid || !processAlive(record.pid)) return false;
  if (!record.commandMarker) return true;
  const command = processCommand(record.pid);
  return typeof command === 'string' && command.includes(record.commandMarker);
}

/**
 * @param {string} agentId
 * @param {SessionRecord} record
 * @param {Object} [options]
 * @param {string} [options.homeDir]
 * @returns {string} - File path of the written session record
 */
export function writeSessionRecord(agentId, record, { homeDir = homedir() } = {}) {
  const filePath = getSessionFilePath(agentId, homeDir);
  mkdirSync(getSessionsDir(homeDir), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, JSON.stringify({ agentId, ...record }) + '\n', { mode: 0o600 });
  return filePath;
}

/**
 * @param {string} agentId
 * @param {Object} [options]
 * @param {string} [options.homeDir]
 * @returns {SessionRecord|null}
 */
export function readSessionRecord(agentId, { homeDir = homedir() } = {}) {
  const filePath = getSessionFilePath(agentId, homeDir);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} agentId
 * @param {Object} [options]
 * @param {string} [options.homeDir]
 * @returns {boolean}
 */
export function deleteSessionRecord(agentId, { homeDir = homedir() } = {}) {
  try {
    unlinkSync(getSessionFilePath(agentId, homeDir));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {ResolveSessionOptions} [options]
 * @returns {string|null}
 */
export function resolveSessionAgentId({
  tool,
  cwd = process.cwd(),
  tty = getCurrentTtyPath(),
  fallbackAgentId = null,
  homeDir = homedir(),
  recordAlive = isSessionRecordAlive,
} = {}) {
  if (!tool || !tty) return fallbackAgentId;

  try {
    const dir = getSessionsDir(homeDir);
    const matches = readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      .map(name => {
        try {
          return JSON.parse(readFileSync(join(dir, name), 'utf-8'));
        } catch {
          return null;
        }
      })
      .filter(record =>
        record &&
        record.agentId &&
        record.tool === tool &&
        record.cwd === cwd &&
        record.tty === tty &&
        recordAlive(record)
      )
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return matches[0]?.agentId || fallbackAgentId;
  } catch {
    return fallbackAgentId;
  }
}

/**
 * @param {string|null} tty - TTY device path
 * @param {string} title - Terminal title to set
 * @returns {boolean}
 */
export function setTerminalTitle(tty, title) {
  if (!tty) return false;
  try {
    appendFileSync(tty, `\x1b]0;${title}\x07`);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} agentId
 * @param {Object} [options]
 * @param {string} [options.homeDir]
 * @param {(record: SessionRecord) => boolean} [options.recordAlive]
 * @returns {boolean}
 */
export function pingAgentTerminal(agentId, {
  homeDir = homedir(),
  recordAlive = isSessionRecordAlive,
} = {}) {
  const record = readSessionRecord(agentId, { homeDir });
  if (!record?.tty || !recordAlive(record)) return false;
  try {
    // iTerm2/Kitty: request attention — pulses the tab orange
    appendFileSync(record.tty, '\x1b]1337;RequestAttention=yes\x07');
    // Terminal bell (flashes tab in most terminals if bells enabled)
    appendFileSync(record.tty, '\x07');
    return true;
  } catch {
    return false;
  }
}
