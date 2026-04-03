import {
  deleteSessionRecord,
  getCurrentTtyPath,
  resolveSessionAgentId,
  SESSION_COMMAND_MARKER,
  writeSessionRecord,
} from '../../shared/session-registry.js';
import { generateAgentId, getConfiguredAgentId } from './identity.js';
import { createLogger } from './utils/logger.js';
import type { TeamHandlers } from './team.js';

const log = createLogger('lifecycle');

export interface AgentIdentityResult {
  agentId: string;
  fallbackAgentId: string;
  hasExactSession: boolean;
}

interface ResolveOptions {
  configuredAgentId?: string | null;
  resolveSessionAgentIdFn?: typeof resolveSessionAgentId;
  [key: string]: unknown;
}

export function resolveAgentIdentity(
  token: string,
  toolName: string,
  options: ResolveOptions = {},
): AgentIdentityResult {
  const fallbackAgentId = generateAgentId(token, toolName);
  const configuredAgentId = options.configuredAgentId ?? getConfiguredAgentId(toolName);
  if (configuredAgentId) {
    return {
      agentId: configuredAgentId,
      fallbackAgentId,
      hasExactSession: true,
    };
  }

  const resolveSession = options.resolveSessionAgentIdFn || resolveSessionAgentId;
  const agentId = resolveSession({
    tool: toolName,
    fallbackAgentId,
    ...options,
  });

  return {
    agentId,
    fallbackAgentId,
    hasExactSession: agentId !== fallbackAgentId,
  };
}

interface SessionRecord {
  tty: string | null;
  tool: string;
  pid: number;
  cwd: string;
  createdAt: number;
  commandMarker: string;
}

interface RegisterSessionOptions {
  getCurrentTtyPathFn?: typeof getCurrentTtyPath;
  writeSessionRecordFn?: typeof writeSessionRecord;
  tty?: string | null;
  parentPid?: number;
  pid?: number;
  cwd?: string;
  createdAt?: number;
  commandMarker?: string;
  homeDir?: string;
}

export function registerProcessSession(
  agentId: string,
  toolName: string,
  options: RegisterSessionOptions = {},
): { tty: string | null; record: SessionRecord } {
  const getTty = options.getCurrentTtyPathFn || getCurrentTtyPath;
  const writeRecord = options.writeSessionRecordFn || writeSessionRecord;
  const tty = options.tty ?? getTty(options.parentPid);
  const record: SessionRecord = {
    tty,
    tool: toolName,
    pid: options.pid ?? process.pid,
    cwd: options.cwd ?? process.cwd(),
    createdAt: options.createdAt ?? Date.now(),
    commandMarker: options.commandMarker ?? SESSION_COMMAND_MARKER,
  };

  writeRecord(agentId, record, options.homeDir ? { homeDir: options.homeDir } : {});
  return { tty, record };
}

/** Mutable state shared between index.js and tool handlers. */
export interface McpState {
  teamId: string | null;
  ws: WebSocket | null;
  sessionId: string | null;
  tty: string | null;
  modelReported: string | null;
  lastActivity: number;
  heartbeatInterval?: ReturnType<typeof setInterval> | null;
  _shuttingDown?: boolean;
}

interface CleanupOptions {
  deleteRecord?: typeof deleteSessionRecord;
  clearIntervalFn?: typeof clearInterval;
  homeDir?: string;
}

export async function cleanupProcessSession(
  agentId: string,
  state: McpState,
  team: TeamHandlers,
  options: CleanupOptions = {},
): Promise<void> {
  const deleteRecord = options.deleteRecord || deleteSessionRecord;
  const clearTimer = options.clearIntervalFn || clearInterval;

  state._shuttingDown = true;
  deleteRecord(agentId, options.homeDir ? { homeDir: options.homeDir } : {});
  if (state.heartbeatInterval) clearTimer(state.heartbeatInterval);
  if (state.ws)
    try {
      state.ws.close();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      log.error('Failed to close WebSocket: ' + message);
    }

  if (state.sessionId && state.teamId) {
    await team.endSession(state.teamId, state.sessionId).catch((err: Error) => {
      log.error('Failed to end session: ' + err.message);
    });
  }
  if (state.teamId) {
    await team.leaveTeam(state.teamId).catch((err: Error) => {
      log.error('Failed to leave team: ' + err.message);
    });
  }
}
