import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { execFile, execFileSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

export const SESSION_COMMAND_MARKER = 'chinwag-mcp';

export function getSessionsDir(homeDir = homedir()) {
  return join(homeDir, '.chinwag', 'sessions');
}

export function safeAgentId(agentId) {
  return agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function getSessionFilePath(agentId, homeDir = homedir()) {
  return join(getSessionsDir(homeDir), `${safeAgentId(agentId)}.json`);
}

export function getCurrentTtyPath(pid = process.ppid) {
  try {
    const ttyName = execFileSync('ps', ['-o', 'tty=', '-p', String(pid)], { encoding: 'utf-8' }).trim();
    if (ttyName && ttyName !== '??' && ttyName !== '?') {
      return `/dev/${ttyName}`;
    }
  } catch {}
  return null;
}

function getProcessCommand(pid) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isSessionRecordAlive(record, {
  processAlive = isProcessAlive,
  processCommand = getProcessCommand,
} = {}) {
  if (!record?.pid || !processAlive(record.pid)) return false;
  if (!record.commandMarker) return true;
  const command = processCommand(record.pid);
  return typeof command === 'string' && command.includes(record.commandMarker);
}

export function writeSessionRecord(agentId, record, { homeDir = homedir() } = {}) {
  const filePath = getSessionFilePath(agentId, homeDir);
  mkdirSync(getSessionsDir(homeDir), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, JSON.stringify({ agentId, ...record }) + '\n', { mode: 0o600 });
  return filePath;
}

export function readSessionRecord(agentId, { homeDir = homedir() } = {}) {
  const filePath = getSessionFilePath(agentId, homeDir);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function deleteSessionRecord(agentId, { homeDir = homedir() } = {}) {
  try {
    unlinkSync(getSessionFilePath(agentId, homeDir));
    return true;
  } catch {
    return false;
  }
}

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

export function setTerminalTitle(tty, title) {
  if (!tty) return false;
  try {
    appendFileSync(tty, `\x1b]0;${title}\x07`);
    return true;
  } catch {
    return false;
  }
}

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
