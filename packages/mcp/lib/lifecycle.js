import {
  deleteSessionRecord,
  getCurrentTtyPath,
  isProcessAlive,
  resolveSessionAgentId,
  SESSION_COMMAND_MARKER,
  writeSessionRecord,
} from '@chinwag/shared/session-registry.js';
import { generateAgentId, getConfiguredAgentId } from './identity.js';

// --- Constants ---
/** @type {number} Timeout before force-exiting during cleanup */
export const FORCE_EXIT_TIMEOUT_MS = 3_000;
/** @type {number} How often to check if the parent process is alive */
export const PARENT_WATCH_INTERVAL_MS = 5_000;

export function resolveAgentIdentity(token, toolName, options = {}) {
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

export function registerProcessSession(agentId, toolName, options = {}) {
  const getTty = options.getCurrentTtyPathFn || getCurrentTtyPath;
  const writeRecord = options.writeSessionRecordFn || writeSessionRecord;
  const tty = options.tty ?? getTty(options.parentPid);
  const record = {
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

export async function cleanupProcessSession(agentId, state, team, options = {}) {
  const deleteRecord = options.deleteRecord || deleteSessionRecord;
  const clearTimer = options.clearIntervalFn || clearInterval;

  state.shuttingDown = true;
  deleteRecord(agentId, options.homeDir ? { homeDir: options.homeDir } : {});
  if (state.heartbeatInterval) clearTimer(state.heartbeatInterval);
  if (state.ws)
    try {
      state.ws.close();
    } catch (err) {
      console.error('[chinwag] Failed to close WebSocket:', err.message);
    }

  if (state.sessionId && state.teamId) {
    await team.endSession(state.teamId, state.sessionId).catch((err) => {
      console.error('[chinwag] Failed to end session:', err.message);
    });
  }
  if (state.teamId) {
    await team.leaveTeam(state.teamId).catch((err) => {
      console.error('[chinwag] Failed to leave team:', err.message);
    });
  }
}

/**
 * Sets up process cleanup handlers and parent process watcher.
 * Ensures graceful shutdown on SIGINT, SIGTERM, stdin close, and orphaned process.
 *
 * @param {object} options
 * @param {string} options.agentId - Agent ID for session cleanup
 * @param {object} options.state - Shared mutable state
 * @param {object} options.team - Team handlers
 * @param {() => void} [options.onDisconnectWs] - Called to disconnect WebSocket before cleanup
 * @returns {{ parentWatch: ReturnType<typeof setInterval>, cleanup: () => void }}
 */
export function setupShutdownHandlers({ agentId, state, team, onDisconnectWs }) {
  let cleaning = false;
  const parentPid = process.ppid;

  const cleanup = () => {
    if (cleaning) return;
    cleaning = true;
    if (onDisconnectWs) onDisconnectWs();
    if (parentWatch) {
      clearInterval(parentWatch);
      parentWatch = null;
    }
    const forceExit = setTimeout(() => process.exit(0), FORCE_EXIT_TIMEOUT_MS);
    forceExit.unref();
    const done = () => {
      clearTimeout(forceExit);
      process.exit(0);
    };
    cleanupProcessSession(agentId, state, team).finally(done);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.stdin.on('end', cleanup);
  process.stdin.on('close', cleanup);
  process.on('disconnect', cleanup);

  let parentWatch = setInterval(() => {
    if (parentPid > 1 && !isProcessAlive(parentPid)) {
      cleanup();
    }
  }, PARENT_WATCH_INTERVAL_MS);
  parentWatch.unref?.();

  return { parentWatch, cleanup };
}
