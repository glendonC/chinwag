/**
 * Dashboard aggregates, team context, authentication, and user types.
 */

import type {
  TeamMember,
  TeamConflict,
  TeamLock,
  TeamMemory,
  TeamMessage,
  TeamSession,
} from './team.js';

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
