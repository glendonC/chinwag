/**
 * Process management barrel file.
 * Re-exports maintaining the existing public API from process-manager.ts.
 */

// Types
export type {
  ManagedProcess,
  AgentInfo,
  SpawnAgentResult,
  SpawnAgentLaunch,
  AttachTerminalResult,
  RegisterExternalAgentParams,
} from './types.js';

// Lifecycle (spawn, kill, resize, attach, external agents)
export {
  spawnAgent,
  killAgent,
  resizePty,
  attachTerminal,
  registerExternalAgent,
  setExternalAgentPid,
  checkExternalAgentLiveness,
} from './lifecycle.js';

// Registry (lookup, query, subscribe)
export { getAgents, getOutput, onUpdate, waitForExit, removeAgent } from './registry.js';
