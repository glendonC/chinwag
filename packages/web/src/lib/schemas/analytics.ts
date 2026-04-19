// Team and user analytics schemas.
// Base shapes imported from @chinwag/shared/contracts/analytics.js;
// client-specific .default() values applied for resilient UI rendering.

import { z } from 'zod';

import {
  fileHeatmapEntrySchema as baseFileHeatmapEntrySchema,
  dailyTrendSchema as baseDailyTrendSchema,
  outcomeCountSchema as baseOutcomeCountSchema,
  toolDistributionSchema as baseToolDistributionSchema,
  dailyMetricEntrySchema as baseDailyMetricEntrySchema,
  hourlyBucketSchema as baseHourlyBucketSchema,
  modelOutcomeSchema as baseModelOutcomeSchema,
  toolOutcomeSchema as baseToolOutcomeSchema,
  toolHourlyBucketSchema as baseToolHourlyBucketSchema,
  toolDailyTrendSchema as baseToolDailyTrendSchema,
  completionSummarySchema as baseCompletionSummarySchema,
  toolComparisonSchema as baseToolComparisonSchema,
  workTypeDistributionSchema as baseWorkTypeDistributionSchema,
  toolWorkTypeBreakdownSchema as baseToolWorkTypeBreakdownSchema,
  fileChurnEntrySchema as baseFileChurnEntrySchema,
  durationBucketSchema as baseDurationBucketSchema,
  concurrentEditEntrySchema as baseConcurrentEditEntrySchema,
  memberAnalyticsSchema as baseMemberAnalyticsSchema,
  retryPatternSchema as baseRetryPatternSchema,
  conflictCorrelationSchema as baseConflictCorrelationSchema,
  editVelocityTrendSchema as baseEditVelocityTrendSchema,
  memoryUsageStatsSchema as baseMemoryUsageStatsSchema,
  workTypeOutcomeSchema as baseWorkTypeOutcomeSchema,
  conversationEditCorrelationSchema as baseConversationEditCorrelationSchema,
  fileReworkEntrySchema as baseFileReworkEntrySchema,
  directoryHeatmapEntrySchema as baseDirectoryHeatmapEntrySchema,
  stucknessStatsSchema as baseStucknessStatsSchema,
  fileOverlapStatsSchema as baseFileOverlapStatsSchema,
  auditStalenessEntrySchema as baseAuditStalenessEntrySchema,
  firstEditStatsSchema as baseFirstEditStatsSchema,
  memoryOutcomeCorrelationSchema as baseMemoryOutcomeCorrelationSchema,
  memoryAccessEntrySchema as baseMemoryAccessEntrySchema,
  scopeComplexityBucketSchema as baseScopeComplexityBucketSchema,
  promptEfficiencyTrendSchema as basePromptEfficiencyTrendSchema,
  hourlyEffectivenessSchema as baseHourlyEffectivenessSchema,
  outcomeTagCountSchema as baseOutcomeTagCountSchema,
  toolHandoffSchema as baseToolHandoffSchema,
  periodMetricsSchema as basePeriodMetricsSchema,
  tokenModelBreakdownSchema as baseTokenModelBreakdownSchema,
  tokenToolBreakdownSchema as baseTokenToolBreakdownSchema,
  dataCoverageSchema as baseDataCoverageSchema,
  toolCallFrequencySchema as baseToolCallFrequencySchema,
  toolCallErrorPatternSchema as baseToolCallErrorPatternSchema,
  toolCallTimelineSchema as baseToolCallTimelineSchema,
  commitStatsSchema as baseCommitStatsSchema,
} from '@chinwag/shared/contracts/analytics.js';

// ── Team analytics ──────────────────────────────────

const fileHeatmapEntrySchema = baseFileHeatmapEntrySchema;

const dailyTrendSchema = baseDailyTrendSchema.extend({
  sessions: z.number().default(0),
  edits: z.number().default(0),
  lines_added: z.number().default(0),
  lines_removed: z.number().default(0),
  avg_duration_min: z.number().default(0),
  completed: z.number().default(0),
  abandoned: z.number().default(0),
  failed: z.number().default(0),
});

const outcomeCountSchema = baseOutcomeCountSchema.extend({
  count: z.number().default(0),
});

const toolDistributionSchema = baseToolDistributionSchema.extend({
  sessions: z.number().default(0),
  edits: z.number().default(0),
});

const dailyMetricEntrySchema = baseDailyMetricEntrySchema.extend({
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

// ── User analytics (cross-project aggregate) ─────────

const hourlyBucketSchema = baseHourlyBucketSchema.extend({
  sessions: z.number().default(0),
  edits: z.number().default(0),
});

const modelOutcomeSchema = baseModelOutcomeSchema.extend({
  count: z.number().default(0),
  avg_duration_min: z.number().default(0),
  total_edits: z.number().default(0),
  total_lines_added: z.number().default(0),
  total_lines_removed: z.number().default(0),
});

const toolOutcomeSchema = baseToolOutcomeSchema.extend({
  count: z.number().default(0),
});

const toolHourlyBucketSchema = baseToolHourlyBucketSchema.extend({
  sessions: z.number().default(0),
  edits: z.number().default(0),
});

const toolDailyTrendSchema = baseToolDailyTrendSchema.extend({
  sessions: z.number().default(0),
  edits: z.number().default(0),
  lines_added: z.number().default(0),
  lines_removed: z.number().default(0),
  avg_duration_min: z.number().default(0),
});

const completionSummarySchema = baseCompletionSummarySchema.extend({
  total_sessions: z.number().default(0),
  completed: z.number().default(0),
  abandoned: z.number().default(0),
  failed: z.number().default(0),
  unknown: z.number().default(0),
  completion_rate: z.number().default(0),
  prev_completion_rate: z.number().nullable().default(null),
});

const toolComparisonSchema = baseToolComparisonSchema.extend({
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

const workTypeDistributionSchema = baseWorkTypeDistributionSchema.extend({
  sessions: z.number().default(0),
  edits: z.number().default(0),
  lines_added: z.number().default(0),
  lines_removed: z.number().default(0),
  files: z.number().default(0),
});

const toolWorkTypeBreakdownSchema = baseToolWorkTypeBreakdownSchema.extend({
  sessions: z.number().default(0),
  edits: z.number().default(0),
});

const fileChurnEntrySchema = baseFileChurnEntrySchema.extend({
  session_count: z.number().default(0),
  total_edits: z.number().default(0),
  total_lines: z.number().default(0),
});

const durationBucketSchema = baseDurationBucketSchema.extend({
  count: z.number().default(0),
});

const concurrentEditEntrySchema = baseConcurrentEditEntrySchema.extend({
  agents: z.number().default(0),
  edit_count: z.number().default(0),
});

const memberAnalyticsSchema = baseMemberAnalyticsSchema.extend({
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

const retryPatternSchema = baseRetryPatternSchema.extend({
  attempts: z.number().default(0),
  final_outcome: z.string().nullable().default(null),
  resolved: z.boolean().default(false),
});

const conflictCorrelationSchema = baseConflictCorrelationSchema.extend({
  sessions: z.number().default(0),
  completed: z.number().default(0),
  completion_rate: z.number().default(0),
});

const editVelocityTrendSchema = baseEditVelocityTrendSchema.extend({
  edits_per_hour: z.number().default(0),
  lines_per_hour: z.number().default(0),
  total_session_hours: z.number().default(0),
});

const memoryUsageStatsSchema = baseMemoryUsageStatsSchema.extend({
  total_memories: z.number().default(0),
  searches: z.number().default(0),
  searches_with_results: z.number().default(0),
  search_hit_rate: z.number().default(0),
  memories_created_period: z.number().default(0),
  memories_updated_period: z.number().default(0),
  stale_memories: z.number().default(0),
  avg_memory_age_days: z.number().default(0),
});

const workTypeOutcomeSchema = baseWorkTypeOutcomeSchema.extend({
  sessions: z.number().default(0),
  completed: z.number().default(0),
  abandoned: z.number().default(0),
  failed: z.number().default(0),
  completion_rate: z.number().default(0),
});

const conversationEditCorrelationSchema = baseConversationEditCorrelationSchema.extend({
  sessions: z.number().default(0),
  avg_edits: z.number().default(0),
  avg_lines: z.number().default(0),
  completion_rate: z.number().default(0),
});

const fileReworkEntrySchema = baseFileReworkEntrySchema.extend({
  total_edits: z.number().default(0),
  failed_edits: z.number().default(0),
  rework_ratio: z.number().default(0),
});

const directoryHeatmapEntrySchema = baseDirectoryHeatmapEntrySchema.extend({
  touch_count: z.number().default(0),
  file_count: z.number().default(0),
  total_lines: z.number().default(0),
  completion_rate: z.number().default(0),
});

const stucknessStatsSchema = baseStucknessStatsSchema.extend({
  total_sessions: z.number().default(0),
  stuck_sessions: z.number().default(0),
  stuckness_rate: z.number().default(0),
  stuck_completion_rate: z.number().default(0),
  normal_completion_rate: z.number().default(0),
});

const fileOverlapStatsSchema = baseFileOverlapStatsSchema.extend({
  total_files: z.number().default(0),
  overlapping_files: z.number().default(0),
  overlap_rate: z.number().default(0),
});

const auditStalenessEntrySchema = baseAuditStalenessEntrySchema.extend({
  days_since: z.number().default(0),
  prior_edit_count: z.number().default(0),
});

const firstEditStatsSchema = baseFirstEditStatsSchema.extend({
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

const memoryOutcomeCorrelationSchema = baseMemoryOutcomeCorrelationSchema.extend({
  sessions: z.number().default(0),
  completed: z.number().default(0),
  completion_rate: z.number().default(0),
});

const memoryAccessEntrySchema = baseMemoryAccessEntrySchema.extend({
  access_count: z.number().default(0),
  last_accessed_at: z.string().nullable().default(null),
});

const scopeComplexityBucketSchema = baseScopeComplexityBucketSchema.extend({
  sessions: z.number().default(0),
  avg_edits: z.number().default(0),
  avg_duration_min: z.number().default(0),
  completion_rate: z.number().default(0),
});

const promptEfficiencyTrendSchema = basePromptEfficiencyTrendSchema.extend({
  avg_turns_per_edit: z.number().default(0),
  sessions: z.number().default(0),
});

const hourlyEffectivenessSchema = baseHourlyEffectivenessSchema.extend({
  sessions: z.number().default(0),
  completion_rate: z.number().default(0),
  avg_edits: z.number().default(0),
});

const outcomeTagCountSchema = baseOutcomeTagCountSchema.extend({
  count: z.number().default(0),
});

const toolHandoffSchema = baseToolHandoffSchema.extend({
  file_count: z.number().default(0),
  handoff_completion_rate: z.number().default(0),
});

const periodMetricsSchema = basePeriodMetricsSchema.extend({
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

const tokenModelBreakdownSchema = baseTokenModelBreakdownSchema.extend({
  input_tokens: z.number().default(0),
  output_tokens: z.number().default(0),
  cache_read_tokens: z.number().default(0),
  cache_creation_tokens: z.number().default(0),
  sessions: z.number().default(0),
  // null when the model lacks pricing or the snapshot is stale. UI renders
  // "—" in that case instead of "$0".
  estimated_cost_usd: z.number().nullable().default(null),
});

const tokenToolBreakdownSchema = baseTokenToolBreakdownSchema.extend({
  input_tokens: z.number().default(0),
  output_tokens: z.number().default(0),
  cache_read_tokens: z.number().default(0),
  cache_creation_tokens: z.number().default(0),
  sessions: z.number().default(0),
});

const tokenUsageStatsSchema = z.object({
  total_input_tokens: z.number().default(0),
  total_output_tokens: z.number().default(0),
  total_cache_read_tokens: z.number().default(0),
  total_cache_creation_tokens: z.number().default(0),
  avg_input_per_session: z.number().default(0),
  avg_output_per_session: z.number().default(0),
  sessions_with_token_data: z.number().default(0),
  sessions_without_token_data: z.number().default(0),
  total_edits_in_token_sessions: z.number().default(0),
  total_estimated_cost_usd: z.number().default(0),
  pricing_refreshed_at: z.string().nullable().default(null),
  pricing_is_stale: z.boolean().default(false),
  models_without_pricing: z.array(z.string()).default([]),
  models_without_pricing_total: z.number().default(0),
  cost_per_edit: z.number().nullable().default(null),
  cache_hit_rate: z.number().nullable().default(null),
  by_model: z.array(tokenModelBreakdownSchema).default([]),
  by_tool: z.array(tokenToolBreakdownSchema).default([]),
});

// ── Tool call analytics ──────────────────────────

const toolCallFrequencySchema = baseToolCallFrequencySchema.extend({
  calls: z.number().default(0),
  errors: z.number().default(0),
  error_rate: z.number().default(0),
  avg_duration_ms: z.number().default(0),
  sessions: z.number().default(0),
});

const toolCallErrorPatternSchema = baseToolCallErrorPatternSchema.extend({
  count: z.number().default(0),
});

const toolCallTimelineSchema = baseToolCallTimelineSchema.extend({
  calls: z.number().default(0),
  errors: z.number().default(0),
});

const toolCallStatsSchema = z.object({
  total_calls: z.number().default(0),
  total_errors: z.number().default(0),
  error_rate: z.number().default(0),
  avg_duration_ms: z.number().default(0),
  calls_per_session: z.number().default(0),
  research_to_edit_ratio: z.number().default(0),
  one_shot_rate: z.number().default(0),
  one_shot_sessions: z.number().default(0),
  frequency: z.array(toolCallFrequencySchema).default([]),
  error_patterns: z.array(toolCallErrorPatternSchema).default([]),
  hourly_activity: z.array(toolCallTimelineSchema).default([]),
});

// ── Data coverage (capability-based) ──────────────

const dataCoverageSchema = baseDataCoverageSchema.extend({
  tools_reporting: z.array(z.string()).default([]),
  tools_without_data: z.array(z.string()).default([]),
  coverage_rate: z.number().default(0),
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
    merged_memories: 0,
    pending_consolidation_proposals: 0,
    formation_observations_by_recommendation: { keep: 0, merge: 0, evolve: 0, discard: 0 },
    secrets_blocked_period: 0,
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
    total_estimated_cost_usd: 0,
    by_model: [],
    by_tool: [],
  }),
  tool_call_stats: toolCallStatsSchema.default({
    total_calls: 0,
    total_errors: 0,
    error_rate: 0,
    avg_duration_ms: 0,
    calls_per_session: 0,
    research_to_edit_ratio: 0,
    one_shot_rate: 0,
    one_shot_sessions: 0,
    frequency: [],
    error_patterns: [],
    hourly_activity: [],
  }),
  commit_stats: baseCommitStatsSchema.default({
    total_commits: 0,
    commits_per_session: 0,
    sessions_with_commits: 0,
    avg_time_to_first_commit_min: null,
    by_tool: [],
    daily_commits: [],
    outcome_correlation: [],
    commit_edit_ratio: [],
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
export type PeriodMetrics = z.infer<typeof periodMetricsSchema>;
export type PeriodComparison = z.infer<typeof periodComparisonSchema>;
export type TokenModelBreakdown = z.infer<typeof tokenModelBreakdownSchema>;
export type TokenToolBreakdown = z.infer<typeof tokenToolBreakdownSchema>;
export type TokenUsageStats = z.infer<typeof tokenUsageStatsSchema>;
export type DataCoverage = z.infer<typeof dataCoverageSchema>;
export type ToolCallFrequency = z.infer<typeof toolCallFrequencySchema>;
export type ToolCallErrorPattern = z.infer<typeof toolCallErrorPatternSchema>;
export type ToolCallTimeline = z.infer<typeof toolCallTimelineSchema>;
export type ToolCallStats = z.infer<typeof toolCallStatsSchema>;

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
      merged_memories: 0,
      pending_consolidation_proposals: 0,
      formation_observations_by_recommendation: { keep: 0, merge: 0, evolve: 0, discard: 0 },
      secrets_blocked_period: 0,
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
      total_cache_read_tokens: 0,
      total_cache_creation_tokens: 0,
      avg_input_per_session: 0,
      avg_output_per_session: 0,
      sessions_with_token_data: 0,
      sessions_without_token_data: 0,
      total_edits_in_token_sessions: 0,
      total_estimated_cost_usd: 0,
      pricing_refreshed_at: null,
      pricing_is_stale: false,
      models_without_pricing: [],
      models_without_pricing_total: 0,
      cost_per_edit: null,
      cache_hit_rate: null,
      by_model: [],
      by_tool: [],
    },
    tool_call_stats: {
      total_calls: 0,
      total_errors: 0,
      error_rate: 0,
      avg_duration_ms: 0,
      calls_per_session: 0,
      research_to_edit_ratio: 0,
      one_shot_rate: 0,
      one_shot_sessions: 0,
      frequency: [],
      error_patterns: [],
      hourly_activity: [],
    },
    commit_stats: {
      total_commits: 0,
      commits_per_session: 0,
      sessions_with_commits: 0,
      avg_time_to_first_commit_min: null,
      by_tool: [],
      daily_commits: [],
      outcome_correlation: [],
      commit_edit_ratio: [],
    },
    teams_included: 0,
    degraded: false,
  };
}
