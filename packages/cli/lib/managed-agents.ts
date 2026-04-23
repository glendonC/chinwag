import { generateSessionAgentId } from '@chinmeister/shared/agent-identity.js';
import { commandExists } from './mcp-config.js';
import { MCP_TOOLS, getMcpToolById } from './tools.js';
import type {
  McpTool,
  ToolAvailabilityCheck,
  ToolFailurePattern,
} from '@chinmeister/shared/tool-registry.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SpawnAgentLaunch } from './process-manager.js';
import type { TerminalLaunch } from './terminal-spawner.js';

const execFileAsync = promisify(execFile);

export interface ManagedTool {
  id: string;
  name: string;
  cmd: string;
  args: string[];
  taskArg: string | undefined;
  availabilityCheck: ToolAvailabilityCheck | null;
  failurePatterns: ToolFailurePattern[];
  [key: string]: unknown;
}

export interface ManagedToolState {
  toolId: string;
  state: string;
  detail: string;
  recoveryCommand?: string;
  source?: string;
}

interface CreateManagedAgentLaunchParams {
  tool: ManagedTool;
  task: string;
  cwd: string;
  token: string;
  cols?: number | undefined;
  rows?: number | undefined;
}

interface CreateTerminalAgentLaunchParams {
  tool: ManagedTool;
  task?: string | undefined;
  cwd: string;
  token: string;
}

function toManagedTool(tool: McpTool): ManagedTool {
  return {
    id: tool.id,
    name: tool.name,
    cmd: tool.spawn!.cmd,
    args: tool.spawn!.args || [],
    taskArg: tool.spawn!.taskArg,
    availabilityCheck: tool.availabilityCheck || null,
    failurePatterns: tool.failurePatterns || [],
  };
}

export function listManagedAgentTools(): ManagedTool[] {
  return MCP_TOOLS.filter((tool) => tool.spawn && commandExists(tool.spawn.cmd)).map(toManagedTool);
}

export function getManagedAgentTool(toolId: string): ManagedTool | null {
  const tool = MCP_TOOLS.find((item) => item.id === toolId && item.spawn);
  return tool ? toManagedTool(tool) : null;
}

export function createManagedAgentLaunch({
  tool,
  task,
  cwd,
  token,
  cols,
  rows,
}: CreateManagedAgentLaunchParams): SpawnAgentLaunch {
  if (!tool?.id || !tool?.cmd) {
    throw new Error('Missing managed agent tool metadata');
  }
  if (!task?.trim()) {
    throw new Error('Task is required');
  }
  if (!cwd) {
    throw new Error('Working directory is required');
  }
  if (!token) {
    throw new Error('Missing chinmeister auth token');
  }

  const agentId = generateSessionAgentId(token, tool.id);

  return {
    toolId: tool.id,
    toolName: tool.name,
    cmd: tool.cmd,
    args: tool.args || [],
    taskArg: tool.taskArg,
    task: task.trim(),
    cwd,
    agentId,
    cols,
    rows,
    env: {
      ...process.env,
      CHINMEISTER_TOOL: tool.id,
      CHINMEISTER_AGENT_ID: agentId,
    },
  };
}

export function createTerminalAgentLaunch({
  tool,
  task = '',
  cwd,
  token,
}: CreateTerminalAgentLaunchParams): TerminalLaunch {
  if (!tool?.id || !tool?.cmd) throw new Error('Missing managed agent tool metadata');
  if (!cwd) throw new Error('Working directory is required');
  if (!token) throw new Error('Missing chinmeister auth token');

  const agentId = generateSessionAgentId(token, tool.id);
  const fullTool = MCP_TOOLS.find((t) => t.id === tool.id);
  const args = fullTool?.spawn?.interactiveArgs ?? tool.args ?? [];

  return {
    toolId: tool.id,
    toolName: tool.name,
    cmd: tool.cmd,
    args,
    taskArg: tool.taskArg,
    task: task?.trim() || '',
    cwd,
    agentId,
    interactive: true,
  };
}

export async function checkManagedAgentToolAvailability(
  tool: ManagedTool,
  { cwd = process.cwd(), timeoutMs = 4000 } = {},
): Promise<ManagedToolState> {
  if (!tool?.id || !tool?.cmd) {
    return { toolId: tool?.id || 'unknown', state: 'unavailable', detail: 'Missing tool metadata' };
  }

  const statusCheck = tool.availabilityCheck || null;
  if (!statusCheck) {
    return { toolId: tool.id, state: 'ready', detail: 'Ready' };
  }

  try {
    const { stdout = '', stderr = '' } = await execFileAsync(tool.cmd, statusCheck.args, {
      cwd,
      env: process.env,
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
    });
    const parsed = statusCheck.parse(`${stdout}\n${stderr}`.trim());
    return { toolId: tool.id, ...parsed };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = `${e.stdout || ''}\n${e.stderr || ''}\n${e.message || ''}`.trim();
    const parsed = statusCheck.parse(output);
    return { toolId: tool.id, ...parsed };
  }
}

export function classifyManagedAgentFailure(
  toolId: string,
  outputText = '',
): ManagedToolState | null {
  const patterns = getMcpToolById(toolId)?.failurePatterns || [];
  for (const pattern of patterns) {
    if (pattern.pattern.test(outputText)) {
      return {
        toolId,
        state: 'needs_auth',
        detail: pattern.detail,
        recoveryCommand: pattern.recoveryCommand,
        source: 'runtime',
      };
    }
  }
  return null;
}
