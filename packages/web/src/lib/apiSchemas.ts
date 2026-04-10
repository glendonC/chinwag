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
  categories: z.array(z.string()).default([]),
  handle: z.string().nullable().optional(),
  host_tool: z.string().nullable().optional(),
  agent_surface: z.string().nullable().optional(),
  agent_model: z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  last_accessed_at: z.string().nullable().optional(),
});

const memoryCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  color: z.string().nullable().optional(),
  created_at: z.string().optional(),
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
    outcome: z.string().nullable().optional(),
    outcome_summary: z.string().nullable().optional(),
    outcome_tags: z.array(z.string()).default([]),
    lines_added: z.number().default(0),
    lines_removed: z.number().default(0),
    first_edit_at: z.string().nullable().optional(),
    got_stuck: z.preprocess((v) => v === 1 || v === true, z.boolean()).default(false),
    memories_searched: z.number().default(0),
    input_tokens: z.number().nullable().optional(),
    output_tokens: z.number().nullable().optional(),
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

// ── Analytics ──────────────────────────────────────

const fileHeatmapEntrySchema = z.object({
  file: z.string(),
  touch_count: z.number(),
  work_type: z.string().optional(),
  outcome_rate: z.number().optional(),
  total_lines_added: z.number().optional(),
  total_lines_removed: z.number().optional(),
});

const dailyTrendSchema = z.object({
  day: z.string(),
  sessions: z.number().default(0),
  edits: z.number().default(0),
  lines_added: z.number().default(0),
  lines_removed: z.number().default(0),
  avg_duration_min: z.number().default(0),
  completed: z.number().default(0),
  abandoned: z.number().default(0),
  failed: z.number().default(0),
});

const outcomeCountSchema = z.object({
  outcome: z.string(),
  count: z.number().default(0),
});

const toolDistributionSchema = z.object({
  host_tool: z.string(),
  sessions: z.number().default(0),
  edits: z.number().default(0),
});

const dailyMetricEntrySchema = z.object({
  date: z.string(),
  metric: z.string(),
  count: z.number().default(0),
});

export const teamAnalyticsSchema = z.object({
  ok: z.literal(true),
  period_days: z.number(),
  file_heatmap: z.array(fileHeatmapEntrySchema).default([]),
  daily_trends: z.array(dailyTrendSchema).default([]),
  tool_distribution: z.array(toolDistributionSchema).default([]),
  outcome_distribution: z.array(outcomeCountSchema).default([]),
  daily_metrics: z.array(dailyMetricEntrySchema).default([]),
});

export type TeamAnalytics = z.infer<typeof teamAnalyticsSchema>;
export type FileHeatmapEntry = z.infer<typeof fileHeatmapEntrySchema>;
export type DailyTrend = z.infer<typeof dailyTrendSchema>;
export type OutcomeCount = z.infer<typeof outcomeCountSchema>;
export type ToolDistributionEntry = z.infer<typeof toolDistributionSchema>;
export type DailyMetricEntry = z.infer<typeof dailyMetricEntrySchema>;

export function createEmptyAnalytics(): TeamAnalytics {
  return {
    ok: true,
    period_days: 7,
    file_heatmap: [],
    daily_trends: [],
    tool_distribution: [],
    outcome_distribution: [],
    daily_metrics: [],
  };
}

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

export function createEmptyEditHistory(): EditHistory {
  return { ok: true, edits: [] };
}

// ── User analytics (cross-project aggregate) ─────────

const hourlyBucketSchema = z.object({
  hour: z.number(),
  dow: z.number(),
  sessions: z.number().default(0),
  edits: z.number().default(0),
});

const modelOutcomeSchema = z.object({
  agent_model: z.string(),
  outcome: z.string(),
  count: z.number().default(0),
  avg_duration_min: z.number().default(0),
  total_edits: z.number().default(0),
  total_lines_added: z.number().default(0),
  total_lines_removed: z.number().default(0),
});

const toolOutcomeSchema = z.object({
  host_tool: z.string(),
  outcome: z.string(),
  count: z.number().default(0),
});

const toolHourlyBucketSchema = z.object({
  host_tool: z.string(),
  hour: z.number(),
  dow: z.number(),
  sessions: z.number().default(0),
  edits: z.number().default(0),
});

const toolDailyTrendSchema = z.object({
  host_tool: z.string(),
  day: z.string(),
  sessions: z.number().default(0),
  edits: z.number().default(0),
  lines_added: z.number().default(0),
  lines_removed: z.number().default(0),
  avg_duration_min: z.number().default(0),
});

const completionSummarySchema = z.object({
  total_sessions: z.number().default(0),
  completed: z.number().default(0),
  abandoned: z.number().default(0),
  failed: z.number().default(0),
  unknown: z.number().default(0),
  completion_rate: z.number().default(0),
  prev_completion_rate: z.number().nullable().default(null),
});

const toolComparisonSchema = z.object({
  host_tool: z.string(),
  sessions: z.number().default(0),
  completed: z.number().default(0),
  abandoned: z.number().default(0),
  failed: z.number().default(0),
  completion_rate: z.number().default(0),
  avg_duration_min: z.number().default(0),
  total_edits: z.number().default(0),
  total_lines_added: z.number().default(0),
  total_lines_removed: z.number().default(0),
});

const workTypeDistributionSchema = z.object({
  work_type: z.string(),
  sessions: z.number().default(0),
  edits: z.number().default(0),
  lines_added: z.number().default(0),
  lines_removed: z.number().default(0),
  files: z.number().default(0),
});

const toolWorkTypeBreakdownSchema = z.object({
  host_tool: z.string(),
  work_type: z.string(),
  sessions: z.number().default(0),
  edits: z.number().default(0),
});

const fileChurnEntrySchema = z.object({
  file: z.string(),
  session_count: z.number().default(0),
  total_edits: z.number().default(0),
  total_lines: z.number().default(0),
});

const durationBucketSchema = z.object({
  bucket: z.string(),
  count: z.number().default(0),
});

const concurrentEditEntrySchema = z.object({
  file: z.string(),
  agents: z.number().default(0),
  edit_count: z.number().default(0),
});

const memberAnalyticsSchema = z.object({
  handle: z.string(),
  sessions: z.number().default(0),
  completed: z.number().default(0),
  abandoned: z.number().default(0),
  failed: z.number().default(0),
  completion_rate: z.number().default(0),
  avg_duration_min: z.number().default(0),
  total_edits: z.number().default(0),
  total_lines_added: z.number().default(0),
  total_lines_removed: z.number().default(0),
  primary_tool: z.string().nullable().default(null),
});

const retryPatternSchema = z.object({
  handle: z.string(),
  file: z.string(),
  attempts: z.number().default(0),
  final_outcome: z.string().nullable().default(null),
  resolved: z.boolean().default(false),
});

const conflictCorrelationSchema = z.object({
  bucket: z.string(),
  sessions: z.number().default(0),
  completed: z.number().default(0),
  completion_rate: z.number().default(0),
});

const editVelocityTrendSchema = z.object({
  day: z.string(),
  edits_per_hour: z.number().default(0),
  lines_per_hour: z.number().default(0),
  total_session_hours: z.number().default(0),
});

const memoryUsageStatsSchema = z.object({
  total_memories: z.number().default(0),
  searches: z.number().default(0),
  searches_with_results: z.number().default(0),
  search_hit_rate: z.number().default(0),
  memories_created_period: z.number().default(0),
  memories_updated_period: z.number().default(0),
  stale_memories: z.number().default(0),
  avg_memory_age_days: z.number().default(0),
});

const workTypeOutcomeSchema = z.object({
  work_type: z.string(),
  sessions: z.number().default(0),
  completed: z.number().default(0),
  abandoned: z.number().default(0),
  failed: z.number().default(0),
  completion_rate: z.number().default(0),
});

const conversationEditCorrelationSchema = z.object({
  bucket: z.string(),
  sessions: z.number().default(0),
  avg_edits: z.number().default(0),
  avg_lines: z.number().default(0),
  completion_rate: z.number().default(0),
});

const fileReworkEntrySchema = z.object({
  file: z.string(),
  total_edits: z.number().default(0),
  failed_edits: z.number().default(0),
  rework_ratio: z.number().default(0),
});

const directoryHeatmapEntrySchema = z.object({
  directory: z.string(),
  touch_count: z.number().default(0),
  file_count: z.number().default(0),
  total_lines: z.number().default(0),
  completion_rate: z.number().default(0),
});

const stucknessStatsSchema = z.object({
  total_sessions: z.number().default(0),
  stuck_sessions: z.number().default(0),
  stuckness_rate: z.number().default(0),
  stuck_completion_rate: z.number().default(0),
  normal_completion_rate: z.number().default(0),
});

const fileOverlapStatsSchema = z.object({
  total_files: z.number().default(0),
  overlapping_files: z.number().default(0),
  overlap_rate: z.number().default(0),
});

const auditStalenessEntrySchema = z.object({
  directory: z.string(),
  last_edit: z.string(),
  days_since: z.number().default(0),
  prior_edit_count: z.number().default(0),
});

const firstEditStatsSchema = z.object({
  avg_minutes_to_first_edit: z.number().default(0),
  median_minutes_to_first_edit: z.number().default(0),
  by_tool: z
    .array(
      z.object({
        host_tool: z.string(),
        avg_minutes: z.number().default(0),
        sessions: z.number().default(0),
      }),
    )
    .default([]),
});

const memoryOutcomeCorrelationSchema = z.object({
  bucket: z.string(),
  sessions: z.number().default(0),
  completed: z.number().default(0),
  completion_rate: z.number().default(0),
});

const memoryAccessEntrySchema = z.object({
  id: z.string(),
  text_preview: z.string(),
  access_count: z.number().default(0),
  last_accessed_at: z.string().nullable().default(null),
  created_at: z.string(),
});

const scopeComplexityBucketSchema = z.object({
  bucket: z.string(),
  sessions: z.number().default(0),
  avg_edits: z.number().default(0),
  avg_duration_min: z.number().default(0),
  completion_rate: z.number().default(0),
});

const promptEfficiencyTrendSchema = z.object({
  day: z.string(),
  avg_turns_per_edit: z.number().default(0),
  sessions: z.number().default(0),
});

const hourlyEffectivenessSchema = z.object({
  hour: z.number(),
  sessions: z.number().default(0),
  completion_rate: z.number().default(0),
  avg_edits: z.number().default(0),
});

const outcomeTagCountSchema = z.object({
  tag: z.string(),
  count: z.number().default(0),
  outcome: z.string(),
});

const toolHandoffSchema = z.object({
  from_tool: z.string(),
  to_tool: z.string(),
  file_count: z.number().default(0),
  handoff_completion_rate: z.number().default(0),
});

const outcomePredictorSchema = z.object({
  outcome: z.string(),
  avg_first_edit_min: z.number().default(0),
  sessions: z.number().default(0),
});

const periodMetricsSchema = z.object({
  completion_rate: z.number().default(0),
  avg_duration_min: z.number().default(0),
  stuckness_rate: z.number().default(0),
  memory_hit_rate: z.number().default(0),
  edit_velocity: z.number().default(0),
  total_sessions: z.number().default(0),
});

const periodComparisonSchema = z.object({
  current: periodMetricsSchema,
  previous: periodMetricsSchema.nullable().default(null),
});

const tokenModelBreakdownSchema = z.object({
  agent_model: z.string(),
  input_tokens: z.number().default(0),
  output_tokens: z.number().default(0),
  sessions: z.number().default(0),
});

const tokenToolBreakdownSchema = z.object({
  host_tool: z.string(),
  input_tokens: z.number().default(0),
  output_tokens: z.number().default(0),
  sessions: z.number().default(0),
});

const tokenUsageStatsSchema = z.object({
  total_input_tokens: z.number().default(0),
  total_output_tokens: z.number().default(0),
  avg_input_per_session: z.number().default(0),
  avg_output_per_session: z.number().default(0),
  sessions_with_token_data: z.number().default(0),
  sessions_without_token_data: z.number().default(0),
  by_model: z.array(tokenModelBreakdownSchema).default([]),
  by_tool: z.array(tokenToolBreakdownSchema).default([]),
});

// ── Data coverage (capability-based) ──────────────

const dataCoverageSchema = z.object({
  tools_reporting: z.array(z.string()).default([]),
  tools_without_data: z.array(z.string()).default([]),
  coverage_rate: z.number().default(1),
  capabilities_available: z.array(z.string()).default([]),
  capabilities_missing: z.array(z.string()).default([]),
});

export const userAnalyticsSchema = teamAnalyticsSchema.extend({
  hourly_distribution: z.array(hourlyBucketSchema).default([]),
  tool_hourly: z.array(toolHourlyBucketSchema).default([]),
  tool_daily: z.array(toolDailyTrendSchema).default([]),
  model_outcomes: z.array(modelOutcomeSchema).default([]),
  tool_outcomes: z.array(toolOutcomeSchema).default([]),
  completion_summary: completionSummarySchema.default({
    total_sessions: 0,
    completed: 0,
    abandoned: 0,
    failed: 0,
    unknown: 0,
    completion_rate: 0,
    prev_completion_rate: null,
  }),
  tool_comparison: z.array(toolComparisonSchema).default([]),
  work_type_distribution: z.array(workTypeDistributionSchema).default([]),
  tool_work_type: z.array(toolWorkTypeBreakdownSchema).default([]),
  file_churn: z.array(fileChurnEntrySchema).default([]),
  duration_distribution: z.array(durationBucketSchema).default([]),
  concurrent_edits: z.array(concurrentEditEntrySchema).default([]),
  member_analytics: z.array(memberAnalyticsSchema).default([]),
  retry_patterns: z.array(retryPatternSchema).default([]),
  conflict_correlation: z.array(conflictCorrelationSchema).default([]),
  edit_velocity: z.array(editVelocityTrendSchema).default([]),
  memory_usage: memoryUsageStatsSchema.default({
    total_memories: 0,
    searches: 0,
    searches_with_results: 0,
    search_hit_rate: 0,
    memories_created_period: 0,
    memories_updated_period: 0,
    stale_memories: 0,
    avg_memory_age_days: 0,
  }),
  work_type_outcomes: z.array(workTypeOutcomeSchema).default([]),
  conversation_edit_correlation: z.array(conversationEditCorrelationSchema).default([]),
  file_rework: z.array(fileReworkEntrySchema).default([]),
  directory_heatmap: z.array(directoryHeatmapEntrySchema).default([]),
  stuckness: stucknessStatsSchema.default({
    total_sessions: 0,
    stuck_sessions: 0,
    stuckness_rate: 0,
    stuck_completion_rate: 0,
    normal_completion_rate: 0,
  }),
  file_overlap: fileOverlapStatsSchema.default({
    total_files: 0,
    overlapping_files: 0,
    overlap_rate: 0,
  }),
  audit_staleness: z.array(auditStalenessEntrySchema).default([]),
  first_edit_stats: firstEditStatsSchema.default({
    avg_minutes_to_first_edit: 0,
    median_minutes_to_first_edit: 0,
    by_tool: [],
  }),
  memory_outcome_correlation: z.array(memoryOutcomeCorrelationSchema).default([]),
  top_memories: z.array(memoryAccessEntrySchema).default([]),
  scope_complexity: z.array(scopeComplexityBucketSchema).default([]),
  prompt_efficiency: z.array(promptEfficiencyTrendSchema).default([]),
  hourly_effectiveness: z.array(hourlyEffectivenessSchema).default([]),
  outcome_tags: z.array(outcomeTagCountSchema).default([]),
  tool_handoffs: z.array(toolHandoffSchema).default([]),
  outcome_predictors: z.array(outcomePredictorSchema).default([]),
  period_comparison: periodComparisonSchema.default({
    current: {
      completion_rate: 0,
      avg_duration_min: 0,
      stuckness_rate: 0,
      memory_hit_rate: 0,
      edit_velocity: 0,
      total_sessions: 0,
    },
    previous: null,
  }),
  token_usage: tokenUsageStatsSchema.default({
    total_input_tokens: 0,
    total_output_tokens: 0,
    avg_input_per_session: 0,
    avg_output_per_session: 0,
    sessions_with_token_data: 0,
    sessions_without_token_data: 0,
    by_model: [],
    by_tool: [],
  }),
  teams_included: z.number().default(0),
  degraded: z.boolean().default(false),
  data_coverage: dataCoverageSchema.optional(),
});

export type UserAnalytics = z.infer<typeof userAnalyticsSchema>;
export type HourlyBucket = z.infer<typeof hourlyBucketSchema>;
export type ToolHourlyBucket = z.infer<typeof toolHourlyBucketSchema>;
export type ToolDailyTrend = z.infer<typeof toolDailyTrendSchema>;
export type ModelOutcome = z.infer<typeof modelOutcomeSchema>;
export type ToolOutcome = z.infer<typeof toolOutcomeSchema>;
export type CompletionSummary = z.infer<typeof completionSummarySchema>;
export type ToolComparison = z.infer<typeof toolComparisonSchema>;
export type WorkTypeDistribution = z.infer<typeof workTypeDistributionSchema>;
export type ToolWorkTypeBreakdown = z.infer<typeof toolWorkTypeBreakdownSchema>;
export type FileChurnEntry = z.infer<typeof fileChurnEntrySchema>;
export type DurationBucket = z.infer<typeof durationBucketSchema>;
export type ConcurrentEditEntry = z.infer<typeof concurrentEditEntrySchema>;
export type MemberAnalytics = z.infer<typeof memberAnalyticsSchema>;
export type RetryPattern = z.infer<typeof retryPatternSchema>;
export type ConflictCorrelation = z.infer<typeof conflictCorrelationSchema>;
export type EditVelocityTrend = z.infer<typeof editVelocityTrendSchema>;
export type MemoryUsageStats = z.infer<typeof memoryUsageStatsSchema>;
export type WorkTypeOutcome = z.infer<typeof workTypeOutcomeSchema>;
export type ConversationEditCorrelation = z.infer<typeof conversationEditCorrelationSchema>;
export type FileReworkEntry = z.infer<typeof fileReworkEntrySchema>;
export type DirectoryHeatmapEntry = z.infer<typeof directoryHeatmapEntrySchema>;
export type StucknessStats = z.infer<typeof stucknessStatsSchema>;
export type FileOverlapStats = z.infer<typeof fileOverlapStatsSchema>;
export type AuditStalenessEntry = z.infer<typeof auditStalenessEntrySchema>;
export type FirstEditStats = z.infer<typeof firstEditStatsSchema>;
export type MemoryOutcomeCorrelation = z.infer<typeof memoryOutcomeCorrelationSchema>;
export type MemoryAccessEntry = z.infer<typeof memoryAccessEntrySchema>;
export type ScopeComplexityBucket = z.infer<typeof scopeComplexityBucketSchema>;
export type PromptEfficiencyTrend = z.infer<typeof promptEfficiencyTrendSchema>;
export type HourlyEffectiveness = z.infer<typeof hourlyEffectivenessSchema>;
export type OutcomeTagCount = z.infer<typeof outcomeTagCountSchema>;
export type ToolHandoff = z.infer<typeof toolHandoffSchema>;
export type OutcomePredictor = z.infer<typeof outcomePredictorSchema>;
export type PeriodMetrics = z.infer<typeof periodMetricsSchema>;
export type PeriodComparison = z.infer<typeof periodComparisonSchema>;
export type TokenModelBreakdown = z.infer<typeof tokenModelBreakdownSchema>;
export type TokenToolBreakdown = z.infer<typeof tokenToolBreakdownSchema>;
export type TokenUsageStats = z.infer<typeof tokenUsageStatsSchema>;
export type DataCoverage = z.infer<typeof dataCoverageSchema>;

// ── Conversation intelligence ────────────────────────

const sentimentDistributionSchema = z.object({
  sentiment: z.string(),
  count: z.number().default(0),
});

const topicDistributionSchema = z.object({
  topic: z.string(),
  count: z.number().default(0),
});

const sentimentOutcomeCorrelationSchema = z.object({
  dominant_sentiment: z.string(),
  sessions: z.number().default(0),
  completed: z.number().default(0),
  abandoned: z.number().default(0),
  failed: z.number().default(0),
  completion_rate: z.number().default(0),
});

const conversationToolCoverageSchema = z.object({
  supported_tools: z.array(z.string()).default([]),
  unsupported_tools: z.array(z.string()).default([]),
});

export const conversationAnalyticsSchema = z.object({
  ok: z.literal(true),
  period_days: z.number(),
  total_messages: z.number().default(0),
  user_messages: z.number().default(0),
  assistant_messages: z.number().default(0),
  avg_user_char_count: z.number().default(0),
  avg_assistant_char_count: z.number().default(0),
  sentiment_distribution: z.array(sentimentDistributionSchema).default([]),
  topic_distribution: z.array(topicDistributionSchema).default([]),
  sentiment_outcome_correlation: z.array(sentimentOutcomeCorrelationSchema).default([]),
  sessions_with_conversations: z.number().default(0),
  tool_coverage: conversationToolCoverageSchema.default({
    supported_tools: [],
    unsupported_tools: [],
  }),
});

export type ConversationAnalytics = z.infer<typeof conversationAnalyticsSchema>;
export type SentimentDistribution = z.infer<typeof sentimentDistributionSchema>;
export type TopicDistribution = z.infer<typeof topicDistributionSchema>;
export type SentimentOutcomeCorrelation = z.infer<typeof sentimentOutcomeCorrelationSchema>;
export type ConversationToolCoverage = z.infer<typeof conversationToolCoverageSchema>;

export function createEmptyConversationAnalytics(): ConversationAnalytics {
  return {
    ok: true,
    period_days: 30,
    total_messages: 0,
    user_messages: 0,
    assistant_messages: 0,
    avg_user_char_count: 0,
    avg_assistant_char_count: 0,
    sentiment_distribution: [],
    topic_distribution: [],
    sentiment_outcome_correlation: [],
    sessions_with_conversations: 0,
    tool_coverage: { supported_tools: [], unsupported_tools: [] },
  };
}

export function createEmptyUserAnalytics(): UserAnalytics {
  return {
    ...createEmptyAnalytics(),
    period_days: 30,
    hourly_distribution: [],
    tool_hourly: [],
    tool_daily: [],
    model_outcomes: [],
    tool_outcomes: [],
    completion_summary: {
      total_sessions: 0,
      completed: 0,
      abandoned: 0,
      failed: 0,
      unknown: 0,
      completion_rate: 0,
      prev_completion_rate: null,
    },
    tool_comparison: [],
    work_type_distribution: [],
    tool_work_type: [],
    file_churn: [],
    duration_distribution: [],
    concurrent_edits: [],
    member_analytics: [],
    retry_patterns: [],
    conflict_correlation: [],
    edit_velocity: [],
    memory_usage: {
      total_memories: 0,
      searches: 0,
      searches_with_results: 0,
      search_hit_rate: 0,
      memories_created_period: 0,
      memories_updated_period: 0,
      stale_memories: 0,
      avg_memory_age_days: 0,
    },
    work_type_outcomes: [],
    conversation_edit_correlation: [],
    file_rework: [],
    directory_heatmap: [],
    stuckness: {
      total_sessions: 0,
      stuck_sessions: 0,
      stuckness_rate: 0,
      stuck_completion_rate: 0,
      normal_completion_rate: 0,
    },
    file_overlap: {
      total_files: 0,
      overlapping_files: 0,
      overlap_rate: 0,
    },
    audit_staleness: [],
    first_edit_stats: {
      avg_minutes_to_first_edit: 0,
      median_minutes_to_first_edit: 0,
      by_tool: [],
    },
    memory_outcome_correlation: [],
    top_memories: [],
    scope_complexity: [],
    prompt_efficiency: [],
    hourly_effectiveness: [],
    outcome_tags: [],
    tool_handoffs: [],
    outcome_predictors: [],
    period_comparison: {
      current: {
        completion_rate: 0,
        avg_duration_min: 0,
        stuckness_rate: 0,
        memory_hit_rate: 0,
        edit_velocity: 0,
        total_sessions: 0,
      },
      previous: null,
    },
    token_usage: {
      total_input_tokens: 0,
      total_output_tokens: 0,
      avg_input_per_session: 0,
      avg_output_per_session: 0,
      sessions_with_token_data: 0,
      sessions_without_token_data: 0,
      by_model: [],
      by_tool: [],
    },
    teams_included: 0,
    degraded: false,
  };
}

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
