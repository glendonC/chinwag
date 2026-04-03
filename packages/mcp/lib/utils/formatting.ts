// Shared formatting utilities for agent labels and tool tags.
// Used across tools, hooks, channels, and context display.

export interface TeamMember {
  handle: string;
  tool?: string;
  status?: string;
  agent_id?: string;
  activity?: AgentActivity | null;
  minutes_since_update?: number | null;
  session_minutes?: number | null;
}

export interface AgentActivity {
  files: string[];
  summary?: string;
  updated_at?: string;
}

/**
 * Format a tool tag string, returning empty string for unknown/missing tools.
 */
export function formatToolTag(tool: string | undefined | null): string {
  return tool && tool !== 'unknown' ? ` (${tool})` : '';
}

/**
 * Format an agent's display label: handle + optional (tool) suffix.
 */
export function formatAgentLabel(member: Pick<TeamMember, 'handle' | 'tool'>): string {
  return `${member.handle}${formatToolTag(member.tool)}`;
}

/**
 * Format a "who" label from separate handle and tool fields.
 * Used when the handle and tool are separate variables (e.g. conflict results).
 */
export function formatWho(handle: string, tool?: string): string {
  return `${handle}${formatToolTag(tool)}`;
}
