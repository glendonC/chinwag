import { createHash, randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import { basename } from 'path';
import { HOST_INTEGRATIONS, getHostIntegrationById } from './integration-model.js';

const EXEC_TIMEOUT_MS = 5000;

function defaultReadProcessInfo(pid) {
  if (!pid || pid <= 0 || process.platform === 'win32') return null;

  try {
    const line = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], {
      encoding: 'utf-8',
      timeout: EXEC_TIMEOUT_MS,
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

function getArgValue(flag, argv = process.argv) {
  const idx = argv.indexOf(flag);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : null;
}

function inferToolFromCommand(command = '') {
  const normalized = command.toLowerCase();
  if (!normalized || normalized.includes('chinwag-mcp') || normalized.includes('chinwag-channel')) {
    return null;
  }

  const executableName = extractExecutableName(command);
  for (const tool of HOST_INTEGRATIONS) {
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

function getRuntimeTransport(defaultTransport = 'mcp', options = {}) {
  return getArgValue('--transport', options.argv)
    || process.env.CHINWAG_TRANSPORT
    || options.defaultTransport
    || defaultTransport;
}

function getDetectionConfidence(source) {
  switch (source) {
    case 'explicit':
      return 1;
    case 'parent-process':
      return 0.7;
    default:
      return 0.2;
  }
}

function normalizeToolName(toolNameOrRuntime) {
  if (!toolNameOrRuntime) return null;
  if (typeof toolNameOrRuntime === 'string') return toolNameOrRuntime;
  return toolNameOrRuntime.hostTool || toolNameOrRuntime.tool || null;
}

export function detectRuntimeIdentity(defaultHost = 'unknown', options = {}) {
  const argv = options.argv || process.argv;
  const explicitTool = getArgValue('--tool', argv) || process.env.CHINWAG_TOOL;
  const explicitSurface = getArgValue('--surface', argv) || process.env.CHINWAG_SURFACE || null;
  const readProcessInfo = options.readProcessInfoFn || defaultReadProcessInfo;
  const maxParentHops = options.maxParentHops ?? 5;

  let hostTool = explicitTool || null;
  let detectionSource = explicitTool ? 'explicit' : 'fallback';

  if (!hostTool) {
    let pid = options.parentPid ?? process.ppid;
    for (let hop = 0; hop < maxParentHops && pid; hop++) {
      const info = readProcessInfo(pid);
      if (!info) break;

      const inferred = inferToolFromCommand(info.command);
      if (inferred) {
        hostTool = inferred;
        detectionSource = 'parent-process';
        break;
      }

      if (!info.ppid || info.ppid === pid) break;
      pid = info.ppid;
    }
  }

  if (!hostTool) {
    hostTool = defaultHost;
  }

  const host = getHostIntegrationById(hostTool);
  const transport = getRuntimeTransport('mcp', { ...options, argv });
  const capabilities = new Set(host?.capabilities || []);

  return {
    hostTool,
    agentSurface: explicitSurface,
    transport,
    tier: host?.tier || (transport === 'managed-cli' ? 'managed' : 'connected'),
    capabilities: [...capabilities].sort(),
    detectionSource,
    detectionConfidence: getDetectionConfidence(detectionSource),
  };
}

export function detectToolName(defaultTool = 'unknown', options = {}) {
  return detectRuntimeIdentity(defaultTool, options).hostTool;
}

export function generateAgentId(token, toolNameOrRuntime) {
  const toolName = normalizeToolName(toolNameOrRuntime) || 'unknown';
  const hash = createHash('sha256').update(token).digest('hex').slice(0, 12);
  return `${toolName}:${hash}`;
}

export function generateSessionAgentId(token, toolNameOrRuntime) {
  const base = generateAgentId(token, toolNameOrRuntime);
  const suffix = randomBytes(4).toString('hex');
  return `${base}:${suffix}`;
}

export function getConfiguredAgentId(toolNameOrRuntime = null) {
  const agentId = process.env.CHINWAG_AGENT_ID?.trim();
  if (!agentId || agentId.length > 60) return null;
  const toolName = normalizeToolName(toolNameOrRuntime);
  if (toolName && !agentId.startsWith(`${toolName}:`)) return null;
  return agentId;
}
