// Runtime validation schemas for critical API responses.
// Guards the UI layer against malformed backend data — if the shape
// changes server-side, the dashboard degrades with a warning instead
// of crashing with an opaque TypeError deep in a component.
//
// Philosophy: permissive parsing (coerce/default where safe), strict
// on structural fields the UI actually destructures. Additional fields
// the API may return are declared as explicit optional properties.

import { z } from 'zod';

// ── Shared primitives ───────────────────────────────

const hostMetricSchema = z.object({
  host_tool: z.string(),
  joins: z.number().default(0),
});

const surfaceMetricSchema = z.object({
  agent_surface: z.string(),
  joins: z.number().default(0),
});

const modelMetricSchema = z.object({
  agent_model: z.string(),
  count: z.number().default(0),
});

const memberSchema = z.object({
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

const memorySchema = z.object({
  id: z.string(),
  text: z.string(),
  tags: z.array(z.string()).default([]),
  handle: z.string().nullable().optional(),
  host_tool: z.string().nullable().optional(),
  agent_surface: z.string().nullable().optional(),
  agent_model: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

const lockSchema = z.object({
  file_path: z.string(),
  agent_id: z.string().optional(),
  handle: z.string().nullable().optional(),
  host_tool: z.string().nullable().optional(),
  agent_surface: z.string().nullable().optional(),
  minutes_held: z.number().nullable().optional(),
});

const messageSchema = z
  .object({
    id: z.string().optional(),
    agent_id: z.string().nullable().optional(),
    handle: z.string().optional(),
    from_handle: z.string().optional(),
    host_tool: z.string().nullable().optional(),
    from_host_tool: z.string().nullable().optional(),
    from_tool: z.string().nullable().optional(),
    agent_surface: z.string().nullable().optional(),
    from_agent_surface: z.string().nullable().optional(),
    text: z.string(),
    created_at: z.string().optional(),
    target: z.string().nullable().optional(),
  })
  .transform((msg) => ({
    ...msg,
    handle: msg.handle || msg.from_handle || '',
    host_tool: msg.host_tool || msg.from_host_tool || msg.from_tool || null,
    agent_surface: msg.agent_surface || msg.from_agent_surface || null,
  }));

const sessionSchema = z
  .object({
    id: z.string().optional(),
    agent_id: z.string().optional(),
    owner_handle: z.string().optional(),
    handle: z.string().optional(),
    framework: z.string().optional(),
    host_tool: z.string().default('unknown'),
    agent_surface: z.string().nullable().optional(),
    transport: z.string().nullable().optional(),
    agent_model: z.string().nullable().optional(),
    started_at: z.string(),
    ended_at: z.string().nullable().optional(),
    edit_count: z.number().default(0),
    files_touched: z.array(z.string()).default([]),
    conflicts_hit: z.number().default(0),
    memories_saved: z.number().default(0),
    duration_minutes: z.number().nullable().optional(),
  })
  .transform((session) => ({
    ...session,
    agent_id: session.agent_id || '',
    owner_handle: session.owner_handle || session.handle || 'Agent',
    handle: session.handle || session.owner_handle || 'Agent',
  }));

const conflictSchema = z.object({
  file: z.string(),
  agents: z.array(z.string()).default([]),
});

const teamSchema = z.object({
  team_id: z.string(),
  team_name: z.string().optional(),
  joined_at: z.string().optional(),
});

const userSchema = z.object({
  handle: z.string(),
  color: z.string(),
  created_at: z.string().optional(),
  github_id: z.string().nullable().optional(),
  github_login: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
});

const wsTicketSchema = z.object({
  ticket: z.string(),
  expires_at: z.string().optional(),
});

const toolCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
  featured: z.boolean().optional(),
  installCmd: z.string().nullable().optional(),
  mcp_support: z.boolean().optional(),
});

const toolDirectoryEvaluationSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().optional(),
  verdict: z.string().optional(),
  tagline: z.string().optional(),
  integration_tier: z.string().optional(),
  mcp_support: z.union([z.boolean(), z.string()]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ── Inferred types from schemas ────────────────────

export type HostMetric = z.infer<typeof hostMetricSchema>;
export type SurfaceMetric = z.infer<typeof surfaceMetricSchema>;
export type ModelMetric = z.infer<typeof modelMetricSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Memory = z.infer<typeof memorySchema>;
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

export function createEmptyTeamContext(): TeamContext {
  return {
    members: [],
    memories: [],
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

// ── Safe parse wrapper ──────────────────────────────

interface ValidateOptions<F> {
  fallback?: F | (() => F);
  throwOnError?: boolean;
}

/**
 * Validate an API response against a schema. On success, returns the parsed
 * data. On failure, either throws or returns a caller-provided safe fallback.
 */
export function validateResponse<T, F = undefined>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  data: unknown,
  label: string,
  options: ValidateOptions<F> = {},
): T | F {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  console.warn(`[chinwag] API response validation warning (${label}):`, detail);

  if (options.throwOnError) {
    const error = new Error(`Invalid API response (${label})`);
    error.name = 'SchemaValidationError';
    (error as Error & { details: string }).details = detail;
    throw error;
  }

  return typeof options.fallback === 'function'
    ? (options.fallback as () => F)()
    : (options.fallback as F);
}
