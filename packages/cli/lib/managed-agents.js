import { generateSessionAgentId } from '../../shared/agent-identity.js';
import { commandExists } from './mcp-config.js';
import { MCP_TOOLS, getMcpToolById } from './tools.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function toManagedTool(tool) {
  return {
    id: tool.id,
    name: tool.name,
    cmd: tool.spawn.cmd,
    args: tool.spawn.args || [],
    taskArg: tool.spawn.taskArg,
    availabilityCheck: tool.availabilityCheck || null,
    failurePatterns: tool.failurePatterns || [],
  };
}

export function listManagedAgentTools() {
  return MCP_TOOLS
    .filter(tool => tool.spawn && commandExists(tool.spawn.cmd))
    .map(toManagedTool);
}

export function getManagedAgentTool(toolId) {
  const tool = MCP_TOOLS.find(item => item.id === toolId && item.spawn);
  return tool ? toManagedTool(tool) : null;
}

export function createManagedAgentLaunch({
  tool,
  task,
  cwd,
  token,
  cols,
  rows,
}) {
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
    throw new Error('Missing chinwag auth token');
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
      CHINWAG_TOOL: tool.id,
      CHINWAG_AGENT_ID: agentId,
    },
  };
}

export async function checkManagedAgentToolAvailability(tool, { cwd = process.cwd(), timeoutMs = 4000 } = {}) {
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
  } catch (err) {
    const output = `${err.stdout || ''}\n${err.stderr || ''}\n${err.message || ''}`.trim();
    const parsed = statusCheck.parse(output);
    return { toolId: tool.id, ...parsed };
  }
}

export function classifyManagedAgentFailure(toolId, outputText = '') {
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
