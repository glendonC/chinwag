/**
 * Core team entity types — members, conflicts, locks, memory, messages, sessions.
 *
 * Naming convention: snake_case for API-persisted fields (database columns),
 * camelCase for ephemeral runtime identity (MCP process-internal).
 */

export type AgentStatus = 'active' | 'idle' | 'offline';

/** Runtime-safe constants for AgentStatus comparisons. */
export const AGENT_STATUS = {
  ACTIVE: 'active',
  IDLE: 'idle',
  OFFLINE: 'offline',
} as const satisfies Record<string, AgentStatus>;

export interface RuntimeIdentityContract {
  hostTool: string;
  agentSurface: string | null;
  transport: string;
  tier: 'managed' | 'connected';
  capabilities: string[];
  detectionSource: 'explicit' | 'mcp-client-info' | 'parent-process' | 'fallback';
  detectionConfidence: number;
}

export interface MemberActivity {
  files: string[];
  summary: string | null;
  updated_at?: string | null;
}

/**
 * Common agent metadata attached to team resources.
 * Extracted to avoid duplicating these four fields across every interface.
 */
export interface AgentMetadata {
  host_tool?: string | null;
  agent_surface?: string | null;
  transport?: string | null;
  agent_model?: string | null;
}

export interface TeamMember extends AgentMetadata {
  agent_id: string;
  handle: string;
  tool?: string | null;
  host_tool: string;
  status: AgentStatus;
  framework?: string | null;
  session_minutes?: number | null;
  seconds_since_update?: number | null;
  minutes_since_update?: number | null;
  signal_tier?: string | null;
  activity: MemberActivity | null;
}

export interface TeamConflict {
  file: string;
  agents: string[];
}

export interface ConflictMatch {
  handle: string;
  host_tool: string;
  files: string[];
  summary: string;
}

export interface LockedConflict {
  file: string;
  handle: string;
  host_tool: string;
  claimed_at: string;
}

export interface TeamLock extends AgentMetadata {
  file_path: string;
  agent_id: string;
  handle?: string | null;
  owner_handle?: string | null;
  tool?: string | null;
  claimed_at?: string;
  minutes_held?: number | null;
}

export interface TeamMemory extends AgentMetadata {
  id: string;
  text: string;
  tags: string[];
  categories: string[];
  handle?: string | null;
  session_id?: string | null;
  created_at?: string;
  updated_at?: string;
  last_accessed_at?: string | null;
}

export interface MemoryCategory {
  id: string;
  name: string;
  description: string;
  color: string | null;
  created_at: string;
}

export interface TeamMessage extends AgentMetadata {
  id?: string;
  agent_id?: string | null;
  handle?: string;
  from_handle?: string;
  from_tool?: string | null;
  from_host_tool?: string | null;
  from_agent_surface?: string | null;
  text: string;
  created_at: string;
}

export interface TeamSession extends AgentMetadata {
  id?: string;
  agent_id: string;
  handle?: string;
  owner_handle: string;
  framework?: string | null;
  host_tool: string;
  tool?: string | null;
  started_at: string;
  ended_at?: string | null;
  edit_count?: number;
  files_touched?: string[];
  conflicts_hit?: number;
  memories_saved?: number;
  duration_minutes?: number | null;
  outcome?: string | null;
  outcome_summary?: string | null;
  outcome_tags?: string[];
  lines_added?: number;
  lines_removed?: number;
  first_edit_at?: string | null;
  got_stuck?: boolean;
  memories_searched?: number;
  input_tokens?: number | null;
  output_tokens?: number | null;
}

export interface ConflictCheckResponse {
  conflicts: ConflictMatch[];
  locked: LockedConflict[];
}
