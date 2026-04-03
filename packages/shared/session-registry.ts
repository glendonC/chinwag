import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SessionRecord {
  agentId: string;
  pid: number;
  tool: string;
  cwd: string;
  tty: string | null;
  createdAt?: number;
  commandMarker?: string;
}

export interface ResolveSessionOptions {
  tool?: string;
  cwd?: string;
  tty?: string | null;
  fallbackAgentId?: string | null;
  homeDir?: string;
  recordAlive?: (record: SessionRecord) => boolean;
}

const EXEC_TIMEOUT_MS = 5000;

export const SESSION_COMMAND_MARKER = 'chinwag-mcp';

export function getSessionsDir(homeDir = homedir()): string {
  return join(homeDir, '.chinwag', 'sessions');
}

export function safeAgentId(agentId: string): string {
  return agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function getSessionFilePath(agentId: string, homeDir = homedir()): string {
  return join(getSessionsDir(homeDir), `${safeAgentId(agentId)}.json`);
}

export function getCurrentTtyPath(pid = process.ppid): string | null {
  try {
    const ttyName = execFileSync('ps', ['-o', 'tty=', '-p', String(pid)], {
      encoding: 'utf-8',
      timeout: EXEC_TIMEOUT_MS,
    }).trim();
    if (ttyName && ttyName !== '??' && ttyName !== '?') {
      return `/dev/${ttyName}`;
    }
  } catch {
    // ignore ps failures
  }
  return null;
}

function getProcessCommand(pid: number): string | null {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf-8',
      timeout: EXEC_TIMEOUT_MS,
    }).trim();
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isSessionRecordAlive(
  record: SessionRecord | null | undefined,
  {
    processAlive = isProcessAlive,
    processCommand = getProcessCommand,
  }: {
    processAlive?: (pid: number) => boolean;
    processCommand?: (pid: number) => string | null;
  } = {},
): boolean {
  if (!record?.pid || !processAlive(record.pid)) return false;
  if (!record.commandMarker) return true;
  const command = processCommand(record.pid);
  return typeof command === 'string' && command.includes(record.commandMarker);
}

export function writeSessionRecord(
  agentId: string,
  record: SessionRecord,
  { homeDir = homedir() }: { homeDir?: string } = {},
): string {
  const filePath = getSessionFilePath(agentId, homeDir);
  mkdirSync(getSessionsDir(homeDir), { recursive: true, mode: 0o700 });
  const payload: SessionRecord = { ...record, agentId };
  writeFileSync(filePath, JSON.stringify(payload) + '\n', { mode: 0o600 });
  return filePath;
}

export function readSessionRecord(
  agentId: string,
  { homeDir = homedir() }: { homeDir?: string } = {},
): SessionRecord | null {
  const filePath = getSessionFilePath(agentId, homeDir);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as SessionRecord;
  } catch (err: unknown) {
    console.error(
      'session-registry: failed to parse session file',
      filePath + ':',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export function deleteSessionRecord(
  agentId: string,
  { homeDir = homedir() }: { homeDir?: string } = {},
): boolean {
  try {
    unlinkSync(getSessionFilePath(agentId, homeDir));
    return true;
  } catch (err: unknown) {
    if (
      !(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')
    )
      console.error(
        'session-registry: failed to delete session record:',
        err instanceof Error ? err.message : String(err),
      );
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
}: ResolveSessionOptions = {}): string | null {
  if (!tool || !tty) return fallbackAgentId;

  try {
    const dir = getSessionsDir(homeDir);
    const matches = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        try {
          return JSON.parse(readFileSync(join(dir, name), 'utf-8')) as SessionRecord;
        } catch (err: unknown) {
          console.error(
            'session-registry: failed to parse session file',
            join(dir, name) + ':',
            err instanceof Error ? err.message : String(err),
          );
          return null;
        }
      })
      .filter((record): record is SessionRecord =>
        Boolean(
          record &&
          record.agentId &&
          record.tool === tool &&
          record.cwd === cwd &&
          record.tty === tty &&
          recordAlive(record),
        ),
      )
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return matches[0]?.agentId || fallbackAgentId;
  } catch (err: unknown) {
    if (
      !(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')
    )
      console.error(
        'session-registry: failed to resolve session agent ID:',
        err instanceof Error ? err.message : String(err),
      );
    return fallbackAgentId;
  }
}

export function setTerminalTitle(tty: string | null, title: string): boolean {
  if (!tty) return false;
  try {
    appendFileSync(tty, `\x1b]0;${title}\x07`);
    return true;
  } catch {
    return false;
  }
}

export function pingAgentTerminal(
  agentId: string,
  {
    homeDir = homedir(),
    recordAlive = isSessionRecordAlive,
  }: {
    homeDir?: string;
    recordAlive?: (record: SessionRecord) => boolean;
  } = {},
): boolean {
  const record = readSessionRecord(agentId, { homeDir });
  if (!record?.tty || !recordAlive(record)) return false;
  try {
    appendFileSync(record.tty, '\x1b]1337;RequestAttention=yes\x07');
    appendFileSync(record.tty, '\x07');
    return true;
  } catch {
    return false;
  }
}
