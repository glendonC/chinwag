import {
  deleteSessionRecord,
  getCurrentTtyPath,
  isProcessAlive,
  resolveSessionAgentId,
  SESSION_COMMAND_MARKER,
  type SessionRecordInput,
  writeCompletedSession,
  writeSessionRecord,
} from '@chinwag/shared/session-registry.js';
import { generateAgentId, getConfiguredAgentId } from './identity.js';
import { createLogger } from './utils/logger.js';
import { getErrorMessage } from './utils/responses.js';
import { FORCE_EXIT_TIMEOUT_MS, PARENT_WATCH_INTERVAL_MS } from './constants.js';
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
  const agentId =
    resolveSession({
      tool: toolName,
      fallbackAgentId,
      ...options,
    }) || fallbackAgentId;

  return {
    agentId,
    fallbackAgentId,
    hasExactSession: agentId !== fallbackAgentId,
  };
}

type SessionRecord = SessionRecordInput;

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
  /** Model string currently being reported (in-flight deduplication). */
  modelReportInflight: string | null;
  lastActivity: number;
  heartbeatInterval?: ReturnType<typeof setInterval> | null;
  /** Recovery timer that reattempts heartbeat after death with exponential backoff (capped at 30m). */
  heartbeatRecoveryTimeout?: ReturnType<typeof setTimeout> | null;
  shuttingDown: boolean;
  /** Set when initial team join fails — tools can surface this instead of a generic "Not in a team" error. */
  teamJoinError: string | null;
  /**
   * Resolves once the initial team join settles (success or failure).
   * Tools await this so they don't race the backend with calls before the DO has
   * registered membership. Always resolves — failure is surfaced via teamJoinError
   * and teamId being nulled.
   */
  teamJoinComplete: Promise<void> | null;
  /** Set when heartbeat exhausts all retries — tools should tell the user to rejoin. */
  heartbeatDead: boolean;
  /** Accumulated tool call metadata flushed to the backend on session end. */
  toolCalls: Array<{ tool: string; at: number }>;
}

// ── Shutdown ──

// Re-export for backwards compatibility
export { FORCE_EXIT_TIMEOUT_MS, PARENT_WATCH_INTERVAL_MS } from './constants.js';

interface ShutdownOptions {
  agentId: string;
  state: McpState;
  team: TeamHandlers;
  /** Tool identifier for the completion record written on shutdown. */
  toolId?: string;
  /** Agent start timestamp for the completion record. Defaults to now. */
  startedAt?: number;
  onDisconnectWs?: () => void;
}

export function setupShutdownHandlers({
  agentId,
  state,
  team,
  toolId,
  startedAt,
  onDisconnectWs,
}: ShutdownOptions): {
  parentWatch: ReturnType<typeof setInterval>;
  cleanup: () => void;
} {
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (onDisconnectWs) onDisconnectWs();
    clearInterval(parentWatch);
    // Force exit if cleanup hangs (e.g. backend unreachable)
    const forceExit = setTimeout(() => process.exit(0), FORCE_EXIT_TIMEOUT_MS);
    forceExit.unref?.();
    cleanupProcessSession(agentId, state, team, { toolId, startedAt })
      .then(() => {
        clearTimeout(forceExit);
        setTimeout(() => process.exit(0), 100);
      })
      .catch((err) => {
        log.error('Cleanup failed: ' + (err instanceof Error ? err.message : String(err)));
        clearTimeout(forceExit);
        setTimeout(() => process.exit(0), 100);
      });
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('disconnect', cleanup);
  process.stdin.on('end', cleanup);
  process.stdin.on('close', cleanup);

  // Watch for parent process exit (orphan detection)
  const parentPid = process.ppid;
  const parentWatch = setInterval(() => {
    if (parentPid > 1 && !isProcessAlive(parentPid)) {
      cleanup();
    }
  }, PARENT_WATCH_INTERVAL_MS);
  parentWatch.unref?.();

  return { parentWatch, cleanup };
}

interface CleanupOptions {
  deleteRecord?: typeof deleteSessionRecord | undefined;
  writeCompleted?: typeof writeCompletedSession | undefined;
  clearIntervalFn?: typeof clearInterval | undefined;
  homeDir?: string | undefined;
  /** Overridable for tests: agent startedAt timestamp for completion record. */
  startedAt?: number | undefined;
  /** Overridable for tests: toolId for completion record. */
  toolId?: string | undefined;
}

export async function cleanupProcessSession(
  agentId: string,
  state: McpState,
  team: TeamHandlers,
  options: CleanupOptions = {},
): Promise<void> {
  const deleteRecord = options.deleteRecord || deleteSessionRecord;
  const writeCompleted = options.writeCompleted || writeCompletedSession;
  const clearTimer = options.clearIntervalFn || clearInterval;
  const homeOpt = options.homeDir ? { homeDir: options.homeDir } : {};

  state.shuttingDown = true;

  // Hand off sessionId to the dashboard so it can run post-session collectors.
  // The dashboard observes the parent CLI agent's exit via node-pty but has no
  // access to MCP's in-memory state. The completion file is the bridge.
  if (state.sessionId && state.teamId && options.toolId) {
    try {
      writeCompleted(
        {
          agentId,
          sessionId: state.sessionId,
          teamId: state.teamId,
          toolId: options.toolId,
          cwd: process.cwd(),
          startedAt: options.startedAt ?? Date.now(),
          completedAt: Date.now(),
        },
        homeOpt,
      );
    } catch (err: unknown) {
      log.error('Failed to write completion record: ' + getErrorMessage(err));
    }
  }

  deleteRecord(agentId, homeOpt);
  if (state.heartbeatInterval) clearTimer(state.heartbeatInterval);
  if (state.heartbeatRecoveryTimeout) clearTimeout(state.heartbeatRecoveryTimeout);
  if (state.ws)
    try {
      state.ws.close();
    } catch (err: unknown) {
      log.error('Failed to close WebSocket: ' + getErrorMessage(err));
    }

  if (state.sessionId && state.teamId) {
    if (state.toolCalls.length > 0) {
      await team
        .recordToolCalls(state.teamId, state.sessionId, state.toolCalls)
        .catch((err: Error) => {
          log.error('Failed to flush tool calls: ' + err.message);
        });
    }
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
