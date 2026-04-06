/**
 * Naming convention: this file mixes camelCase and snake_case deliberately.
 *
 * - **camelCase** (hostTool, agentSurface) — ephemeral runtime identity, internal to the MCP process.
 *   These are set once during detection and never persisted to the API.
 *
 * - **snake_case** (host_tool, agent_id) — API contract fields that map directly to database columns
 *   and JSON responses. Changing these requires API versioning.
 *
 * Do not normalize between the two without updating all consumers.
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
  handle?: string | null;
  created_at?: string;
  updated_at?: string;
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
}

export interface HostJoinMetric {
  host_tool: string;
  joins: number;
}

export interface ToolJoinMetric {
  tool: string;
  joins: number;
}

export interface SurfaceJoinMetric {
  agent_surface: string;
  joins: number;
}

export interface ModelMetric {
  agent_model: string;
  count: number;
}

export interface TeamContext {
  members: TeamMember[];
  conflicts: TeamConflict[];
  locks: TeamLock[];
  memories: TeamMemory[];
  messages: TeamMessage[];
  recentSessions: TeamSession[];
  sessions?: TeamSession[];
  tools_configured?: ToolJoinMetric[];
  hosts_configured?: HostJoinMetric[];
  surfaces_seen?: SurfaceJoinMetric[];
  models_seen?: ModelMetric[];
  usage?: Record<string, number>;
}

export interface DashboardTeamSummary {
  team_id: string;
  team_name?: string;
  active_agents: number;
  memory_count: number;
  conflict_count?: number;
  total_members?: number;
  live_sessions?: number;
  recent_sessions_24h?: number;
  tools_configured?: ToolJoinMetric[];
  hosts_configured?: HostJoinMetric[];
  surfaces_seen?: SurfaceJoinMetric[];
  models_seen?: ModelMetric[];
  usage?: Record<string, number>;
}

export interface DashboardSummary {
  teams: DashboardTeamSummary[];
  degraded: boolean;
  failed_teams: Array<Record<string, unknown>>;
  truncated: boolean;
}

export interface AuthenticatedUser {
  handle: string;
  color: string;
  created_at: string;
}

export interface UserTeam {
  team_id: string;
  team_name: string;
  joined_at?: string;
}

export interface UserTeamsResponse {
  teams: UserTeam[];
}

export interface WebSocketTicketResponse {
  ticket: string;
  expires_at?: string;
}

export interface ToolCatalogEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  featured?: boolean;
  installCmd?: string | null;
  mcp_support?: boolean;
}

export interface ToolCatalogResponse {
  tools: ToolCatalogEntry[];
  categories: Record<string, string>;
}

export interface ToolDirectoryEvaluation {
  id: string;
  name: string;
  category: string;
  verdict: string;
  tagline?: string;
  integration_tier?: string;
  mcp_support?: boolean | string;
  metadata?: Record<string, unknown>;
}

export interface ToolDirectoryResponse {
  evaluations: ToolDirectoryEvaluation[];
  categories: Record<string, string>;
}

export interface HeartbeatEvent {
  type: 'heartbeat';
  agent_id: string;
}

export interface ActivityEvent {
  type: 'activity';
  agent_id: string;
  files?: string[];
  summary?: string | null;
}

export interface FileEvent {
  type: 'file';
  agent_id: string;
  file: string;
}

export interface MemberJoinedEvent {
  type: 'member_joined';
  agent_id: string;
  handle?: string;
  host_tool?: string;
}

export interface MemberLeftEvent {
  type: 'member_left';
  agent_id: string;
}

export interface StatusChangeEvent {
  type: 'status_change';
  agent_id: string;
  status: AgentStatus;
}

export interface LockChangeEvent {
  type: 'lock_change';
  action: 'claim' | 'release' | 'release_all';
  agent_id: string;
  files?: string[];
}

export interface MessageEvent {
  type: 'message';
  handle: string;
  text: string;
  created_at?: string;
}

export interface MemoryDeltaEvent {
  type: 'memory';
  id?: string;
  text: string;
  tags?: string[];
  handle?: string;
  host_tool?: string;
  created_at?: string;
}

export interface CommandStatusEvent {
  type: 'command_status';
  id: string;
  status: string;
  command_type?: string;
  sender_handle?: string;
  claimed_by?: string;
  result?: Record<string, unknown>;
}

export interface ContextEvent {
  type: 'context';
  data: TeamContext;
}

export type DashboardDeltaEvent =
  | HeartbeatEvent
  | ActivityEvent
  | FileEvent
  | MemberJoinedEvent
  | MemberLeftEvent
  | StatusChangeEvent
  | LockChangeEvent
  | MessageEvent
  | MemoryDeltaEvent
  | CommandStatusEvent;

export interface ConflictCheckResponse {
  conflicts: ConflictMatch[];
  locked: LockedConflict[];
}
