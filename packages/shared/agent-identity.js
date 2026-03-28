import { createHash, randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import { basename } from 'path';
import { MCP_TOOLS } from './tool-registry.js';

function defaultReadProcessInfo(pid) {
  if (!pid || pid <= 0 || process.platform === 'win32') return null;

  try {
    const line = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], {
      encoding: 'utf-8',
    }).trim();

    if (!line) return null;
    const match = line.match(/^\s*(\d+)\s+(.*)$/s);
    if (!match) return null;
    return {
      ppid: Number(match[1]),
      command: match[2],
    };
  } catch {
    return null;
  }
}

function extractExecutableName(command = '') {
  const match = String(command).trim().match(/^("[^"]+"|'[^']+'|\S+)/);
  if (!match) return '';

  const token = match[1].replace(/^['"]|['"]$/g, '');
  return basename(token).toLowerCase();
}

function includesAlias(command = '', alias = '') {
  const normalizedCommand = String(command).toLowerCase();
  const normalizedAlias = String(alias).toLowerCase().trim();
  if (!normalizedCommand || !normalizedAlias) return false;

  const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(normalizedCommand);
}

function inferToolFromCommand(command = '') {
  const normalized = command.toLowerCase();
  if (!normalized || normalized.includes('chinwag-mcp') || normalized.includes('chinwag-channel')) {
    return null;
  }

  const executableName = extractExecutableName(command);
  for (const tool of MCP_TOOLS) {
    const executables = new Set([
      ...(tool.detect?.cmds || []),
      ...(tool.processDetection?.executables || []),
    ].map((candidate) => String(candidate).toLowerCase()));

    if (executableName && executables.has(executableName)) {
      return tool.id;
    }

    const aliases = tool.processDetection?.aliases || [];
    if (aliases.some((alias) => includesAlias(command, alias))) {
      return tool.id;
    }
  }

  return null;
}

export function detectToolName(defaultTool = 'unknown', options = {}) {
  const idx = process.argv.indexOf('--tool');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (process.env.CHINWAG_TOOL) return process.env.CHINWAG_TOOL;

  const readProcessInfo = options.readProcessInfoFn || defaultReadProcessInfo;
  let pid = options.parentPid ?? process.ppid;
  const maxParentHops = options.maxParentHops ?? 5;

  for (let hop = 0; hop < maxParentHops && pid; hop++) {
    const info = readProcessInfo(pid);
    if (!info) break;

    const inferred = inferToolFromCommand(info.command);
    if (inferred) return inferred;

    if (!info.ppid || info.ppid === pid) break;
    pid = info.ppid;
  }

  return defaultTool;
}

export function generateAgentId(token, toolName) {
  const hash = createHash('sha256').update(token).digest('hex').slice(0, 12);
  return `${toolName}:${hash}`;
}

export function generateSessionAgentId(token, toolName) {
  const base = generateAgentId(token, toolName);
  const suffix = randomBytes(4).toString('hex');
  return `${base}:${suffix}`;
}

export function getConfiguredAgentId(toolName = null) {
  const agentId = process.env.CHINWAG_AGENT_ID?.trim();
  if (!agentId || agentId.length > 60) return null;
  if (toolName && !agentId.startsWith(`${toolName}:`)) return null;
  return agentId;
}
