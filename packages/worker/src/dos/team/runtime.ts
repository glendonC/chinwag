import type { RuntimeMetadata } from '../../types.js';

const RUNTIME_TOKEN_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Validate and cap a single runtime metadata value. */
function normalizeValue(value: unknown, maxLength = 50): string | null {
  if (!value || typeof value !== 'string') return null;
  if (value.length > maxLength) return null;
  if (!RUNTIME_TOKEN_PATTERN.test(value)) return null;
  return value;
}

/**
 * Normalize model names to canonical short forms for consistent analytics grouping.
 * Strips date-stamped suffixes (e.g. "claude-sonnet-4-5-20250514" → "claude-sonnet-4-5")
 * and collapses known aliases.
 */
export function normalizeModelName(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let name = raw.trim().toLowerCase();
  if (!name) return null;

  // Strip date suffixes: "-20250514", "-20251001", etc. (8-digit date at end)
  name = name.replace(/-\d{8}$/, '');

  // Collapse provider prefixes that some MCP clients add
  name = name.replace(/^(anthropic|openai|google|meta)[/:]/, '');

  // Normalize common aliases
  const ALIASES: Record<string, string> = {
    'gpt-4o-mini': 'gpt-4o-mini',
    'gpt-4-turbo': 'gpt-4-turbo',
    'claude-3-5-sonnet': 'claude-sonnet-3-5',
    'claude-3-5-haiku': 'claude-haiku-3-5',
    'claude-3-opus': 'claude-opus-3',
    'claude-3-sonnet': 'claude-sonnet-3',
    'claude-3-haiku': 'claude-haiku-3',
  };

  return ALIASES[name] ?? name;
}

/** Extract the host tool name from a prefixed agent ID (e.g. "cursor:abc" -> "cursor"). */
export function inferHostToolFromAgentId(agentId = ''): string {
  const idx = String(agentId).indexOf(':');
  return idx > 0 ? agentId.slice(0, idx) : 'unknown';
}

/**
 * Normalize runtime metadata from either a string tool name or a runtime object.
 * Always returns a complete RuntimeMetadata with no undefined fields.
 */
export function normalizeRuntimeMetadata(
  runtimeOrTool: string | Record<string, unknown> | null | undefined,
  agentId = '',
): RuntimeMetadata {
  if (!runtimeOrTool || typeof runtimeOrTool === 'string') {
    const hostTool =
      normalizeValue(runtimeOrTool) || inferHostToolFromAgentId(agentId) || 'unknown';
    return {
      hostTool,
      agentSurface: null,
      transport: null,
      tier: null,
      model: null,
    };
  }

  const hostTool =
    normalizeValue(runtimeOrTool.hostTool || runtimeOrTool.host_tool || runtimeOrTool.tool) ||
    inferHostToolFromAgentId(agentId) ||
    'unknown';

  return {
    hostTool,
    agentSurface: normalizeValue(runtimeOrTool.agentSurface || runtimeOrTool.agent_surface),
    transport: normalizeValue(runtimeOrTool.transport),
    tier: normalizeValue(runtimeOrTool.tier),
    model: normalizeModelName(normalizeValue(runtimeOrTool.model || runtimeOrTool.agent_model)),
  };
}
