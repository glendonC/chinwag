import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomicSync } from './fs-atomic.js';
import { getProcessTtyPath, getProcessCommandString } from './process-utils.js';
import { formatError } from './error-utils.js';
import { createLogger } from './logger.js';

const log = createLogger('session-registry');

export interface SessionRecord {
  agentId: string;
  pid: number;
  tool: string;
  cwd: string;
  tty: string | null;
  createdAt?: number;
  commandMarker?: string;
}

export type SessionRecordInput = Omit<SessionRecord, 'agentId'>;

export interface ResolveSessionOptions {
  tool?: string;
  cwd?: string;
  tty?: string | null;
  fallbackAgentId?: string | null;
  homeDir?: string;
  recordAlive?: (record: SessionRecord) => boolean;
}

export const SESSION_COMMAND_MARKER = 'chinmeister-mcp';

export function getSessionsDir(homeDir = homedir()): string {
  return join(homeDir, '.chinmeister', 'sessions');
}

export function safeAgentId(agentId: string): string {
  return agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function getSessionFilePath(agentId: string, homeDir = homedir()): string {
  return join(getSessionsDir(homeDir), `${safeAgentId(agentId)}.json`);
}

export function getCurrentTtyPath(pid = process.ppid): string | null {
  return getProcessTtyPath(pid);
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
    processCommand = getProcessCommandString,
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
  record: SessionRecordInput,
  { homeDir = homedir() }: { homeDir?: string } = {},
): string {
  const filePath = getSessionFilePath(agentId, homeDir);
  mkdirSync(getSessionsDir(homeDir), { recursive: true, mode: 0o700 });
  const payload: SessionRecord = { ...record, agentId };
  writeFileAtomicSync(filePath, JSON.stringify(payload) + '\n', { mode: 0o600 });
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
    log.error(`failed to parse session file ${filePath}: ${formatError(err)}`);
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
      log.error(`failed to delete session record: ${formatError(err)}`);
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
          log.error(`failed to parse session file ${join(dir, name)}: ${formatError(err)}`);
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
      log.error(`failed to resolve session agent ID: ${formatError(err)}`);
    return fallbackAgentId;
  }
}

/**
 * Completion record written by the MCP server when a session ends, so that the
 * dashboard (which observes the parent CLI agent's exit) can recover the
 * sessionId it needs for post-session analytics collection. The MCP's own
 * state.sessionId is lost when MCP exits; the dashboard has teamId but no
 * sessionId. This file is the handoff.
 */
export interface CompletedSession {
  agentId: string;
  sessionId: string;
  teamId: string;
  toolId: string;
  cwd: string;
  startedAt: number;
  completedAt: number;
}

export function getCompletedSessionPath(agentId: string, homeDir = homedir()): string {
  return join(getSessionsDir(homeDir), `${safeAgentId(agentId)}.completed.json`);
}

export function writeCompletedSession(
  record: CompletedSession,
  { homeDir = homedir() }: { homeDir?: string } = {},
): string {
  const filePath = getCompletedSessionPath(record.agentId, homeDir);
  mkdirSync(getSessionsDir(homeDir), { recursive: true, mode: 0o700 });
  writeFileAtomicSync(filePath, JSON.stringify(record) + '\n', { mode: 0o600 });
  return filePath;
}

export function readCompletedSession(
  agentId: string,
  { homeDir = homedir() }: { homeDir?: string } = {},
): CompletedSession | null {
  const filePath = getCompletedSessionPath(agentId, homeDir);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as CompletedSession;
  } catch (err: unknown) {
    log.error(`failed to parse completed session file ${filePath}: ${formatError(err)}`);
    return null;
  }
}

export function deleteCompletedSession(
  agentId: string,
  { homeDir = homedir() }: { homeDir?: string } = {},
): boolean {
  try {
    unlinkSync(getCompletedSessionPath(agentId, homeDir));
    return true;
  } catch (err: unknown) {
    if (
      !(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')
    )
      log.error(`failed to delete completed session record: ${formatError(err)}`);
    return false;
  }
}

/**
 * List every completion record currently on disk. Used by the dashboard's
 * orphan-sweep path: externally-launched agents (claude-code run directly,
 * not via chinmeister's managed flow) still produce `<agentId>.completed.json`
 * via MCP cleanup, but the dashboard never observes their exit — so those
 * files pile up until a future dashboard session picks them up. Sweeping
 * on mount lets post-session collectors run against external agents too,
 * closing the cost-coverage gap for the common "user launches their own
 * editor" case.
 *
 * Returns the parsed records and their on-disk paths so callers can delete
 * after successful collection. Files that fail to parse are skipped
 * (logged by readCompletedSession-style error handling) rather than
 * crashing the sweep.
 */
export function listCompletedSessions({ homeDir = homedir() }: { homeDir?: string } = {}): Array<{
  record: CompletedSession;
  filePath: string;
}> {
  const dir = getSessionsDir(homeDir);
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Array<{ record: CompletedSession; filePath: string }> = [];
  for (const name of entries) {
    if (!name.endsWith('.completed.json')) continue;
    const filePath = join(dir, name);
    try {
      const record = JSON.parse(readFileSync(filePath, 'utf-8')) as CompletedSession;
      if (record && record.agentId && record.sessionId && record.teamId) {
        out.push({ record, filePath });
      }
    } catch (err: unknown) {
      log.error(`failed to parse completed session file ${filePath}: ${formatError(err)}`);
    }
  }
  return out;
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
