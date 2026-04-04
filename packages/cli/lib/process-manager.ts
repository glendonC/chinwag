/**
 * Re-export barrel for backward compatibility.
 * All process management logic has been split into process/ submodules.
 */
export type {
  ManagedProcess,
  AgentInfo,
  SpawnAgentResult,
  SpawnAgentLaunch,
  AttachTerminalResult,
  RegisterExternalAgentParams,
} from './process/index.js';

export {
  spawnAgent,
  killAgent,
  resizePty,
  attachTerminal,
  registerExternalAgent,
  setExternalAgentPid,
  checkExternalAgentLiveness,
  getAgents,
  getOutput,
  onUpdate,
  waitForExit,
  removeAgent,
} from './process/index.js';
