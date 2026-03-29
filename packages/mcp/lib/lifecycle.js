import {
  deleteSessionRecord,
  getCurrentTtyPath,
  resolveSessionAgentId,
  SESSION_COMMAND_MARKER,
  writeSessionRecord,
} from '../../shared/session-registry.js';
import { generateAgentId, getConfiguredAgentId } from './identity.js';

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

  deleteRecord(agentId, options.homeDir ? { homeDir: options.homeDir } : {});
  if (state.heartbeatInterval) clearTimer(state.heartbeatInterval);

  if (state.sessionId && state.teamId) {
    await team.endSession(state.teamId, state.sessionId).catch(() => {});
  }
  if (state.teamId) {
    await team.leaveTeam(state.teamId).catch(() => {});
  }
}
