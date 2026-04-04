import type { RuntimeMetadata } from '../../types.js';

const RUNTIME_TOKEN_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Validate and cap a single runtime metadata value. */
function normalizeValue(value: unknown, maxLength = 50): string | null {
  if (!value || typeof value !== 'string') return null;
  if (value.length > maxLength) return null;
  if (!RUNTIME_TOKEN_PATTERN.test(value)) return null;
  return value;
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
    model: normalizeValue(runtimeOrTool.model || runtimeOrTool.agent_model),
  };
}
