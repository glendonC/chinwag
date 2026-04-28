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
  /** MCP clientInfo.name from the initialization handshake. */
  clientInfoName?: string;
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

  const raw = match[1];
  if (raw === undefined) return '';
  const token = raw.replace(/^['"]|['"]$/g, '');
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
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === flag) return argv[i + 1] || null;
    if (arg.startsWith(flag + '=')) return arg.slice(flag.length + 1) || null;
  }
  return null;
}

function inferToolFromCommand(command = ''): string | null {
  const normalized = command.toLowerCase();
  if (
    !normalized ||
    normalized.includes('chinmeister-mcp') ||
    normalized.includes('chinmeister-channel')
  ) {
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

    // Check command-string patterns (catches npm-installed tools: node /path/to/@scope/package/cli.js)
    const patterns = tool.processDetection?.commandPatterns || [];
    if (patterns.some((pat) => normalized.includes(pat.toLowerCase()))) {
      return tool.id;
    }
  }

  return null;
}

/**
 * Resolve a tool ID from an MCP clientInfo.name string.
 * Matches case-insensitively against each tool's clientInfoNames registry.
 */
export function inferToolFromClientInfo(clientName: string): string | null {
  if (!clientName) return null;
  const normalized = clientName.toLowerCase().trim();
  if (!normalized) return null;

  for (const tool of HOST_INTEGRATIONS) {
    const names = tool.clientInfoNames || [];
    if (names.some((n) => n.toLowerCase() === normalized)) {
      return tool.id;
    }
  }
  return null;
}

function getRuntimeTransport(defaultTransport = 'mcp', options: DetectRuntimeOptions = {}): string {
  return (
    getArgValue('--transport', options.argv) ||
    process.env.CHINMEISTER_TRANSPORT ||
    options.defaultTransport ||
    defaultTransport
  );
}

function getDetectionConfidence(source: RuntimeIdentity['detectionSource']): number {
  switch (source) {
    case 'explicit':
      return 1;
    case 'mcp-client-info':
      return 0.95;
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
  const explicitTool = getArgValue('--tool', argv) || process.env.CHINMEISTER_TOOL || null;
  const explicitSurface = getArgValue('--surface', argv) || process.env.CHINMEISTER_SURFACE || null;
  const readProcessInfo = options.readProcessInfoFn || defaultReadProcessInfo;
  const maxParentHops = options.maxParentHops ?? DEFAULT_MAX_PARENT_HOPS;

  let hostTool = explicitTool;
  let detectionSource: RuntimeIdentity['detectionSource'] = explicitTool ? 'explicit' : 'fallback';

  // MCP clientInfo.name - the host tool declares itself during the MCP handshake.
  if (!hostTool && options.clientInfoName) {
    const fromClient = inferToolFromClientInfo(options.clientInfoName);
    if (fromClient) {
      hostTool = fromClient;
      detectionSource = 'mcp-client-info';
    }
  }

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
  const agentId = process.env.CHINMEISTER_AGENT_ID?.trim();
  if (!agentId || agentId.length > 60) return null;
  const toolName = normalizeToolName(toolNameOrRuntime);
  if (toolName && !agentId.startsWith(`${toolName}:`)) return null;
  return agentId;
}
