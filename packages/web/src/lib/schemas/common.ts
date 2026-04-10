// Shared primitives used across other schema files.
// Guards the UI layer against malformed backend data.
// Base shapes imported from @chinwag/shared/contracts; client-specific
// .default(), .catch(), .transform(), .preprocess() applied on top.

import { z } from 'zod';

import {
  hostJoinMetricSchema as baseHostMetricSchema,
  surfaceJoinMetricSchema as baseSurfaceMetricSchema,
  modelMetricSchema as baseModelMetricSchema,
  authenticatedUserSchema as baseUserSchema,
  userTeamSchema as baseTeamSchema,
  webSocketTicketResponseSchema as baseWsTicketSchema,
  dashboardSummarySchema as baseDashboardSummarySchema,
  userTeamsResponseSchema as baseUserTeamsSchema,
} from '@chinwag/shared/contracts/dashboard.js';

import {
  type teamMemberSchema,
  teamConflictSchema as baseConflictSchema,
  teamLockSchema as baseLockSchema,
  teamMemorySchema as baseMemorySchema,
  memoryCategorySchema as baseMemoryCategorySchema,
  teamMessageSchema as baseMessageSchema,
  teamSessionSchema as baseSessionSchema,
  agentMetadataSchema,
  memberActivitySchema,
} from '@chinwag/shared/contracts/team.js';

import {
  toolCatalogEntrySchema as baseToolCatalogEntrySchema,
  toolDirectoryEvaluationSchema as baseToolDirectoryEvaluationSchema,
} from '@chinwag/shared/contracts/tools.js';

// ── Shared primitives ───────────────────────────────

export const hostMetricSchema = baseHostMetricSchema.extend({
  joins: z.number().default(0),
});

export const surfaceMetricSchema = baseSurfaceMetricSchema.extend({
  joins: z.number().default(0),
});

export const modelMetricSchema = baseModelMetricSchema.extend({
  count: z.number().default(0),
});

// memberSchema: web uses fewer fields than shared teamMemberSchema (no tool,
// framework, seconds_since_update, minutes_since_update, signal_tier) and
// adds color. Keep hand-written definition; verify key fields via type check.
export const memberSchema = z.object({
  agent_id: z.string(),
  handle: z.string(),
  status: z.string().default('unknown'),
  host_tool: z.string().default('unknown'),
  agent_surface: z.string().optional(),
  transport: z.string().nullable().optional(),
  agent_model: z.string().nullable().optional(),
  activity: z
    .object({
      files: z.array(z.string()).default([]),
      summary: z.string().optional(),
      updated_at: z.string().optional(),
    })
    .nullable()
    .optional(),
  color: z.string().nullable().optional(),
  session_minutes: z.number().nullable().optional(),
});

// Type-level check: verify key fields stay aligned with shared contract
type _MemberContractCheck =
  z.infer<typeof memberSchema> extends Pick<z.infer<typeof teamMemberSchema>, 'agent_id' | 'handle'>
    ? true
    : never;
 
const _memberCheck: _MemberContractCheck = true;

export const memorySchema = baseMemorySchema.extend({
  tags: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
});

export const memoryCategorySchema = baseMemoryCategorySchema.extend({
  description: z.string().default(''),
  created_at: z.string().optional(),
});

export const lockSchema = baseLockSchema
  .pick({
    file_path: true,
    agent_id: true,
    handle: true,
    host_tool: true,
    agent_surface: true,
    minutes_held: true,
  })
  .extend({
    agent_id: z.string().optional(),
  });

// messageSchema: imports base shape but keeps .transform() for handle/host_tool
// normalization. The `target` field is web-only.
export const messageSchema = baseMessageSchema
  .extend({
    target: z.string().nullable().optional(),
  })
  .transform((msg) => ({
    ...msg,
    handle: msg.handle || msg.from_handle || '',
    host_tool: msg.host_tool || msg.from_host_tool || msg.from_tool || null,
    agent_surface: msg.agent_surface || msg.from_agent_surface || null,
  }));

// sessionSchema: imports base shape but keeps .preprocess() for got_stuck
// (SQLite returns 0/1) and .transform() for handle normalization.
export const sessionSchema = baseSessionSchema
  .extend({
    host_tool: z.string().default('unknown'),
    edit_count: z.number().default(0),
    files_touched: z.array(z.string()).default([]),
    conflicts_hit: z.number().default(0),
    memories_saved: z.number().default(0),
    outcome_tags: z.array(z.string()).default([]),
    lines_added: z.number().default(0),
    lines_removed: z.number().default(0),
    got_stuck: z.preprocess((v) => v === 1 || v === true, z.boolean()).default(false),
    memories_searched: z.number().default(0),
  })
  .transform((session) => ({
    ...session,
    agent_id: session.agent_id || '',
    owner_handle: session.owner_handle || session.handle || 'Agent',
    handle: session.handle || session.owner_handle || 'Agent',
  }));

export const conflictSchema = baseConflictSchema.extend({
  agents: z.array(z.string()).default([]),
});

export const teamSchema = baseTeamSchema.extend({
  team_name: z.string().optional(),
});

export const userSchema = baseUserSchema.extend({
  created_at: z.string().optional(),
  github_id: z.string().nullable().optional(),
  github_login: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
});

export const wsTicketSchema = baseWsTicketSchema;

export const toolCatalogEntrySchema = baseToolCatalogEntrySchema.extend({
  category: z.string().optional(),
  description: z.string().optional(),
});

export const toolDirectoryEvaluationSchema = baseToolDirectoryEvaluationSchema.extend({
  category: z.string().optional(),
  verdict: z.string().optional(),
});

// ── Inferred types from schemas ────────────────────

export type HostMetric = z.infer<typeof hostMetricSchema>;
export type SurfaceMetric = z.infer<typeof surfaceMetricSchema>;
export type ModelMetric = z.infer<typeof modelMetricSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Memory = z.infer<typeof memorySchema>;
export type MemoryCategory = z.infer<typeof memoryCategorySchema>;
export type Lock = z.infer<typeof lockSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Conflict = z.infer<typeof conflictSchema>;
export type Team = z.infer<typeof teamSchema>;
export type User = z.infer<typeof userSchema>;
export type WsTicket = z.infer<typeof wsTicketSchema>;
export type ToolCatalogEntry = z.infer<typeof toolCatalogEntrySchema>;
export type ToolDirectoryEvaluation = z.infer<typeof toolDirectoryEvaluationSchema>;

// ── Team context response ───────────────────────────

const daemonStatusSchema = z
  .object({
    connected: z.boolean().default(false),
    available_tools: z.array(z.string()).default([]),
  })
  .default({ connected: false, available_tools: [] });

export type DaemonStatus = z.infer<typeof daemonStatusSchema>;

export const teamContextSchema = z
  .object({
    members: z.array(memberSchema).catch([]),
    memories: z.array(memorySchema).catch([]),
    memory_categories: z.array(memoryCategorySchema).catch([]),
    locks: z.array(lockSchema).catch([]),
    messages: z.array(messageSchema).catch([]),
    recentSessions: z.array(sessionSchema).catch([]),
    sessions: z.array(sessionSchema).catch([]),
    conflicts: z.array(conflictSchema).catch([]),
    tools_configured: z.array(hostMetricSchema).catch([]),
    hosts_configured: z.array(hostMetricSchema).catch([]),
    surfaces_seen: z.array(surfaceMetricSchema).catch([]),
    models_seen: z.array(modelMetricSchema).catch([]),
    usage: z.record(z.number()).catch({}),
    daemon: daemonStatusSchema,
  })
  .transform((context) => ({
    ...context,
    recentSessions: context.recentSessions.length > 0 ? context.recentSessions : context.sessions,
  }));

export type TeamContext = z.infer<typeof teamContextSchema>;

// ── Dashboard summary response ──────────────────────

const activeMemberSchema = z.object({
  agent_id: z.string(),
  handle: z.string().default('unknown'),
  host_tool: z.string().default('unknown'),
  agent_surface: z.string().nullable().default(null),
  files: z.array(z.string()).default([]),
  summary: z.string().nullable().default(null),
  session_minutes: z.number().nullable().default(null),
});

export type ActiveMember = z.infer<typeof activeMemberSchema>;

const teamSummarySchema = z.object({
  team_id: z.string(),
  team_name: z.string().optional(),
  active_agents: z.number().default(0),
  memory_count: z.number().default(0),
  conflict_count: z.number().default(0),
  total_members: z.number().default(0),
  live_sessions: z.number().default(0),
  recent_sessions_24h: z.number().default(0),
  active_members: z.array(activeMemberSchema).default([]),
  hosts_configured: z.array(hostMetricSchema).default([]),
  surfaces_seen: z.array(surfaceMetricSchema).default([]),
  models_seen: z.array(modelMetricSchema).default([]),
  usage: z.record(z.number()).default({}),
});

export type TeamSummary = z.infer<typeof teamSummarySchema>;

export const dashboardSummarySchema = z.object({
  teams: z.array(teamSummarySchema).default([]),
  degraded: z.boolean().default(false),
  failed_teams: z
    .array(z.object({ team_id: z.string().optional(), team_name: z.string().optional() }))
    .default([]),
  truncated: z.boolean().default(false),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const userTeamsSchema = z.object({
  teams: z.array(teamSchema).default([]),
});

export type UserTeams = z.infer<typeof userTeamsSchema>;

export const userProfileSchema = userSchema;
export type UserProfile = z.infer<typeof userProfileSchema>;

export const webSocketTicketSchema = wsTicketSchema;
export type WebSocketTicket = z.infer<typeof webSocketTicketSchema>;

export const toolCatalogSchema = z.object({
  tools: z.array(toolCatalogEntrySchema).default([]),
  categories: z.record(z.string()).default({}),
});

export type ToolCatalog = z.infer<typeof toolCatalogSchema>;

export const toolDirectorySchema = z.object({
  evaluations: z.array(toolDirectoryEvaluationSchema).default([]),
  categories: z.record(z.string()).default({}),
});

export type ToolDirectory = z.infer<typeof toolDirectorySchema>;

// ── Edit history (per-edit audit log) ──────────────────

const editEntrySchema = z.object({
  id: z.string(),
  session_id: z.string(),
  handle: z.string(),
  host_tool: z.string().default('unknown'),
  file_path: z.string(),
  lines_added: z.number().default(0),
  lines_removed: z.number().default(0),
  created_at: z.string(),
});

export const editHistorySchema = z.object({
  ok: z.literal(true),
  edits: z.array(editEntrySchema).default([]),
});

export type EditEntry = z.infer<typeof editEntrySchema>;
export type EditHistory = z.infer<typeof editHistorySchema>;

// ── Factory functions ──────────────────────────────

export function createEmptyTeamContext(): TeamContext {
  return {
    members: [],
    memories: [],
    memory_categories: [],
    locks: [],
    messages: [],
    recentSessions: [],
    sessions: [],
    conflicts: [],
    tools_configured: [],
    hosts_configured: [],
    surfaces_seen: [],
    models_seen: [],
    usage: {},
    daemon: { connected: false, available_tools: [] },
  };
}

export function createEmptyDashboardSummary(): DashboardSummary {
  return {
    teams: [],
    degraded: true,
    failed_teams: [],
    truncated: false,
  };
}

export function createEmptyUserTeams(): UserTeams {
  return { teams: [] };
}

export function createEmptyToolCatalog(): ToolCatalog {
  return { tools: [], categories: {} };
}

export function createEmptyToolDirectory(): ToolDirectory {
  return { evaluations: [], categories: {} };
}

export function createEmptyEditHistory(): EditHistory {
  return { ok: true, edits: [] };
}
