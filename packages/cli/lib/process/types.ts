/**
 * Shared types for the process management system.
 */
import type { IPty } from 'node-pty';

export interface ManagedProcess {
  id: number;
  toolId: string;
  toolName: string;
  cmd: string;
  args: string[];
  taskArg: string;
  task: string;
  cwd: string;
  agentId: string | null;
  pty: IPty | null;
  pid?: number | null;
  spawnType?: string;
  status: 'running' | 'exited' | 'failed';
  outputBuffer: string[];
  startedAt: number;
  exitCode: number | null;
  _lastNewline: boolean;
  _killTimer: ReturnType<typeof setTimeout> | null;
}

export interface AgentInfo {
  id: number;
  toolId: string;
  toolName: string;
  cmd: string;
  args: string[];
  taskArg: string;
  task: string;
  cwd: string;
  agentId: string | null;
  status: string;
  startedAt: number;
  exitCode: number | null;
  spawnType: string;
  outputPreview: string | null;
}

export interface SpawnAgentResult {
  id: number;
  toolId: string;
  toolName: string;
  task: string;
  status: string;
  startedAt: number;
  agentId: string | null;
}

export interface SpawnAgentLaunch {
  toolId: string;
  toolName?: string;
  cmd: string;
  args?: string[];
  taskArg?: string;
  task: string;
  cwd: string;
  agentId?: string | null;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

export interface AttachTerminalResult {
  dispose: () => void;
  write: (data: string) => void;
}

export interface RegisterExternalAgentParams {
  toolId: string;
  toolName?: string;
  cmd: string;
  args?: string[];
  taskArg?: string;
  task: string;
  cwd: string;
  agentId?: string | null;
  pid?: number | null;
}
