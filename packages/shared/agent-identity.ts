import { createHash, randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { HOST_INTEGRATIONS, getHostIntegrationById } from './integration-model.js';
import { readProcessInfo as defaultReadProcessInfo } from './process-utils.js';
import type { RuntimeIdentityContract } from './contracts.js';

export interface RuntimeIdentity extends RuntimeIdentityContract {}

export interface DetectRuntimeOptions {
  argv?: string[];
  readProcessInfoFn?: (pid: number) => { ppid: number; command: string } | null;
  parentPid?: number;
  maxParentHops?: number;
  defaultTransport?: string;
}

export interface RuntimeIdentityLike {
  hostTool?: string;
  tool?: string;
}

/** Maximum parent process hops when detecting host tool via process tree. */
const DEFAULT_MAX_PARENT_HOPS = 5;

function extractExecutableName(command = ''): string {
  const match = String(command)
    .trim()
    .match(/^("[^"]+"|'[^']+'|\S+)/);
  if (!match) return '';

  const token = match[1].replace(/^['"]|['"]$/g, '');
  return basename(token).toLowerCase();
}

function includesAlias(command = '', alias = ''): boolean {
  const normalizedCommand = String(command).toLowerCase();
  const normalizedAlias = String(alias).toLowerCase().trim();
  if (!normalizedCommand || !normalizedAlias) return false;

  const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(normalizedCommand);
}

function getArgValue(flag: string, argv = process.argv): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) return argv[i + 1] || null;
    if (argv[i].startsWith(flag + '=')) return argv[i].slice(flag.length + 1) || null;
  }
  return null;
}

function inferToolFromCommand(command = ''): string | null {
  const normalized = command.toLowerCase();
  if (!normalized || normalized.includes('chinwag-mcp') || normalized.includes('chinwag-channel')) {
    return null;
  }

  const executableName = extractExecutableName(command);
  for (const tool of HOST_INTEGRATIONS) {
    const executables = new Set(
      [...(tool.detect?.cmds || []), ...(tool.processDetection?.executables || [])].map(
        (candidate) => String(candidate).toLowerCase(),
      ),
    );

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

function getRuntimeTransport(defaultTransport = 'mcp', options: DetectRuntimeOptions = {}): string {
  return (
    getArgValue('--transport', options.argv) ||
    process.env.CHINWAG_TRANSPORT ||
    options.defaultTransport ||
    defaultTransport
  );
}

function getDetectionConfidence(source: RuntimeIdentity['detectionSource']): number {
  switch (source) {
    case 'explicit':
      return 1;
    case 'parent-process':
      return 0.7;
    default:
      return 0.2;
  }
}

function normalizeToolName(
  toolNameOrRuntime: string | RuntimeIdentityLike | null | undefined,
): string | null {
  if (!toolNameOrRuntime) return null;
  if (typeof toolNameOrRuntime === 'string') return toolNameOrRuntime;
  return toolNameOrRuntime.hostTool || toolNameOrRuntime.tool || null;
}

export function detectRuntimeIdentity(
  defaultHost = 'unknown',
  options: DetectRuntimeOptions = {},
): RuntimeIdentity {
  const argv = options.argv || process.argv;
  const explicitTool = getArgValue('--tool', argv) || process.env.CHINWAG_TOOL || null;
  const explicitSurface = getArgValue('--surface', argv) || process.env.CHINWAG_SURFACE || null;
  const readProcessInfo = options.readProcessInfoFn || defaultReadProcessInfo;
  const maxParentHops = options.maxParentHops ?? DEFAULT_MAX_PARENT_HOPS;

  let hostTool = explicitTool;
  let detectionSource: RuntimeIdentity['detectionSource'] = explicitTool ? 'explicit' : 'fallback';

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

export function detectToolName(
  defaultTool = 'unknown',
  options: DetectRuntimeOptions = {},
): string {
  return detectRuntimeIdentity(defaultTool, options).hostTool;
}

export function generateAgentId(
  token: string,
  toolNameOrRuntime: string | RuntimeIdentityLike | null,
): string {
  const toolName = normalizeToolName(toolNameOrRuntime) || 'unknown';
  const hash = createHash('sha256').update(token).digest('hex').slice(0, 12);
  return `${toolName}:${hash}`;
}

export function generateSessionAgentId(
  token: string,
  toolNameOrRuntime: string | RuntimeIdentityLike | null,
): string {
  const base = generateAgentId(token, toolNameOrRuntime);
  const suffix = randomBytes(4).toString('hex');
  return `${base}:${suffix}`;
}

export function getConfiguredAgentId(
  toolNameOrRuntime: string | RuntimeIdentityLike | null = null,
): string | null {
  const agentId = process.env.CHINWAG_AGENT_ID?.trim();
  if (!agentId || agentId.length > 60) return null;
  const toolName = normalizeToolName(toolNameOrRuntime);
  if (toolName && !agentId.startsWith(`${toolName}:`)) return null;
  return agentId;
}
