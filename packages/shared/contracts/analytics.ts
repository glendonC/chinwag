/**
 * Analytics and workflow intelligence types.
 *
 * Covers heatmaps, trends, distributions, behavioral patterns,
 * period comparisons, token usage, and data coverage.
 */

import { z } from 'zod';

// ── Base analytics types ─────────────────────────

export const fileHeatmapEntrySchema = z.object({
  file: z.string(),
  touch_count: z.number(),
  work_type: z.string().optional(),
  outcome_rate: z.number().optional(),
  total_lines_added: z.number().optional(),
  total_lines_removed: z.number().optional(),
});
export type FileHeatmapEntry = z.infer<typeof fileHeatmapEntrySchema>;

export const dailyTrendSchema = z.object({
  day: z.string(),
  sessions: z.number(),
  edits: z.number(),
  lines_added: z.number(),
  lines_removed: z.number(),
  avg_duration_min: z.number(),
  completed: z.number().optional(),
  abandoned: z.number().optional(),
  failed: z.number().optional(),
});
export type DailyTrend = z.infer<typeof dailyTrendSchema>;

export const outcomeCountSchema = z.object({
  outcome: z.string(),
  count: z.number(),
});
export type OutcomeCount = z.infer<typeof outcomeCountSchema>;

export const toolDistributionSchema = z.object({
  host_tool: z.string(),
  sessions: z.number(),
  edits: z.number(),
});
export type ToolDistribution = z.infer<typeof toolDistributionSchema>;

export const dailyMetricEntrySchema = z.object({
  date: z.string(),
  metric: z.string(),
  count: z.number(),
});
export type DailyMetricEntry = z.infer<typeof dailyMetricEntrySchema>;

export const teamAnalyticsSchema = z.object({
  ok: z.literal(true),
  period_days: z.number(),
  file_heatmap: z.array(fileHeatmapEntrySchema),
  daily_trends: z.array(dailyTrendSchema),
  tool_distribution: z.array(toolDistributionSchema),
  outcome_distribution: z.array(outcomeCountSchema),
  daily_metrics: z.array(dailyMetricEntrySchema),
});
export type TeamAnalytics = z.infer<typeof teamAnalyticsSchema>;

// ── Hourly and tool-level breakdowns ─────────────

export const hourlyBucketSchema = z.object({
  hour: z.number(),
  dow: z.number(),
  sessions: z.number(),
  edits: z.number(),
});
export type HourlyBucket = z.infer<typeof hourlyBucketSchema>;

export const toolHourlyBucketSchema = z.object({
  host_tool: z.string(),
  hour: z.number(),
  dow: z.number(),
  sessions: z.number(),
  edits: z.number(),
});
export type ToolHourlyBucket = z.infer<typeof toolHourlyBucketSchema>;

export const toolDailyTrendSchema = z.object({
  host_tool: z.string(),
  day: z.string(),
  sessions: z.number(),
  edits: z.number(),
  lines_added: z.number(),
  lines_removed: z.number(),
  avg_duration_min: z.number(),
});
export type ToolDailyTrend = z.infer<typeof toolDailyTrendSchema>;

export const modelOutcomeSchema = z.object({
  agent_model: z.string(),
  outcome: z.string(),
  count: z.number(),
  avg_duration_min: z.number(),
  total_edits: z.number(),
  total_lines_added: z.number(),
  total_lines_removed: z.number(),
});
export type ModelOutcome = z.infer<typeof modelOutcomeSchema>;

export const toolOutcomeSchema = z.object({
  host_tool: z.string(),
  outcome: z.string(),
  count: z.number(),
});
export type ToolOutcome = z.infer<typeof toolOutcomeSchema>;

// ── Workflow intelligence ────────────────────────

export const completionSummarySchema = z.object({
  total_sessions: z.number(),
  completed: z.number(),
  abandoned: z.number(),
  failed: z.number(),
  unknown: z.number(),
  completion_rate: z.number(),
  prev_completion_rate: z.number().nullable(),
});
export type CompletionSummary = z.infer<typeof completionSummarySchema>;

export const toolComparisonSchema = z.object({
  host_tool: z.string(),
  sessions: z.number(),
  completed: z.number(),
  abandoned: z.number(),
  failed: z.number(),
  completion_rate: z.number(),
  avg_duration_min: z.number(),
  total_edits: z.number(),
  total_lines_added: z.number(),
  total_lines_removed: z.number(),
});
export type ToolComparison = z.infer<typeof toolComparisonSchema>;

export const workTypeDistributionSchema = z.object({
  work_type: z.string(),
  sessions: z.number(),
  edits: z.number(),
  lines_added: z.number(),
  lines_removed: z.number(),
  files: z.number(),
});
export type WorkTypeDistribution = z.infer<typeof workTypeDistributionSchema>;

export const toolWorkTypeBreakdownSchema = z.object({
  host_tool: z.string(),
  work_type: z.string(),
  sessions: z.number(),
  edits: z.number(),
});
export type ToolWorkTypeBreakdown = z.infer<typeof toolWorkTypeBreakdownSchema>;

export const fileChurnEntrySchema = z.object({
  file: z.string(),
  session_count: z.number(),
  total_edits: z.number(),
  total_lines: z.number(),
});
export type FileChurnEntry = z.infer<typeof fileChurnEntrySchema>;

export const durationBucketSchema = z.object({
  bucket: z.string(),
  count: z.number(),
});
export type DurationBucket = z.infer<typeof durationBucketSchema>;

export const concurrentEditEntrySchema = z.object({
  file: z.string(),
  agents: z.number(),
  edit_count: z.number(),
});
export type ConcurrentEditEntry = z.infer<typeof concurrentEditEntrySchema>;

export const memberAnalyticsSchema = z.object({
  handle: z.string(),
  sessions: z.number(),
  completed: z.number(),
  abandoned: z.number(),
  failed: z.number(),
  completion_rate: z.number(),
  avg_duration_min: z.number(),
  total_edits: z.number(),
  total_lines_added: z.number(),
  total_lines_removed: z.number(),
  primary_tool: z.string().nullable(),
});
export type MemberAnalytics = z.infer<typeof memberAnalyticsSchema>;

export const retryPatternSchema = z.object({
  handle: z.string(),
  file: z.string(),
  attempts: z.number(),
  final_outcome: z.string().nullable(),
  resolved: z.boolean(),
});
export type RetryPattern = z.infer<typeof retryPatternSchema>;

export const conflictCorrelationSchema = z.object({
  bucket: z.string(),
  sessions: z.number(),
  completed: z.number(),
  completion_rate: z.number(),
});
export type ConflictCorrelation = z.infer<typeof conflictCorrelationSchema>;

export const editVelocityTrendSchema = z.object({
  day: z.string(),
  edits_per_hour: z.number(),
  lines_per_hour: z.number(),
  total_session_hours: z.number(),
});
export type EditVelocityTrend = z.infer<typeof editVelocityTrendSchema>;

export const memoryUsageStatsSchema = z.object({
  total_memories: z.number(),
  searches: z.number(),
  searches_with_results: z.number(),
  search_hit_rate: z.number(),
  memories_created_period: z.number(),
  memories_updated_period: z.number(),
  stale_memories: z.number(),
  avg_memory_age_days: z.number(),
});
export type MemoryUsageStats = z.infer<typeof memoryUsageStatsSchema>;

export const workTypeOutcomeSchema = z.object({
  work_type: z.string(),
  sessions: z.number(),
  completed: z.number(),
  abandoned: z.number(),
  failed: z.number(),
  completion_rate: z.number(),
});
export type WorkTypeOutcome = z.infer<typeof workTypeOutcomeSchema>;

export const conversationEditCorrelationSchema = z.object({
  bucket: z.string(),
  sessions: z.number(),
  avg_edits: z.number(),
  avg_lines: z.number(),
  completion_rate: z.number(),
});
export type ConversationEditCorrelation = z.infer<typeof conversationEditCorrelationSchema>;

export const fileReworkEntrySchema = z.object({
  file: z.string(),
  total_edits: z.number(),
  failed_edits: z.number(),
  rework_ratio: z.number(),
});
export type FileReworkEntry = z.infer<typeof fileReworkEntrySchema>;

export const directoryHeatmapEntrySchema = z.object({
  directory: z.string(),
  touch_count: z.number(),
  file_count: z.number(),
  total_lines: z.number(),
  completion_rate: z.number(),
});
export type DirectoryHeatmapEntry = z.infer<typeof directoryHeatmapEntrySchema>;

export const stucknessStatsSchema = z.object({
  total_sessions: z.number(),
  stuck_sessions: z.number(),
  stuckness_rate: z.number(),
  stuck_completion_rate: z.number(),
  normal_completion_rate: z.number(),
});
export type StucknessStats = z.infer<typeof stucknessStatsSchema>;

export const fileOverlapStatsSchema = z.object({
  total_files: z.number(),
  overlapping_files: z.number(),
  overlap_rate: z.number(),
});
export type FileOverlapStats = z.infer<typeof fileOverlapStatsSchema>;

export const auditStalenessEntrySchema = z.object({
  directory: z.string(),
  last_edit: z.string(),
  days_since: z.number(),
  prior_edit_count: z.number(),
});
export type AuditStalenessEntry = z.infer<typeof auditStalenessEntrySchema>;

export const firstEditStatsSchema = z.object({
  avg_minutes_to_first_edit: z.number(),
  median_minutes_to_first_edit: z.number(),
  by_tool: z.array(
    z.object({
      host_tool: z.string(),
      avg_minutes: z.number(),
      sessions: z.number(),
    }),
  ),
});
export type FirstEditStats = z.infer<typeof firstEditStatsSchema>;

export const memoryOutcomeCorrelationSchema = z.object({
  bucket: z.string(),
  sessions: z.number(),
  completed: z.number(),
  completion_rate: z.number(),
});
export type MemoryOutcomeCorrelation = z.infer<typeof memoryOutcomeCorrelationSchema>;

export const memoryAccessEntrySchema = z.object({
  id: z.string(),
  text_preview: z.string(),
  access_count: z.number(),
  last_accessed_at: z.string().nullable(),
  created_at: z.string(),
});
export type MemoryAccessEntry = z.infer<typeof memoryAccessEntrySchema>;

export const scopeComplexityBucketSchema = z.object({
  bucket: z.string(),
  sessions: z.number(),
  avg_edits: z.number(),
  avg_duration_min: z.number(),
  completion_rate: z.number(),
});
export type ScopeComplexityBucket = z.infer<typeof scopeComplexityBucketSchema>;

export const promptEfficiencyTrendSchema = z.object({
  day: z.string(),
  avg_turns_per_edit: z.number(),
  sessions: z.number(),
});
export type PromptEfficiencyTrend = z.infer<typeof promptEfficiencyTrendSchema>;

export const hourlyEffectivenessSchema = z.object({
  hour: z.number(),
  sessions: z.number(),
  completion_rate: z.number(),
  avg_edits: z.number(),
});
export type HourlyEffectiveness = z.infer<typeof hourlyEffectivenessSchema>;

export const outcomeTagCountSchema = z.object({
  tag: z.string(),
  count: z.number(),
  outcome: z.string(),
});
export type OutcomeTagCount = z.infer<typeof outcomeTagCountSchema>;

export const toolHandoffSchema = z.object({
  from_tool: z.string(),
  to_tool: z.string(),
  file_count: z.number(),
  handoff_completion_rate: z.number(),
});
export type ToolHandoff = z.infer<typeof toolHandoffSchema>;

export const outcomePredictorSchema = z.object({
  outcome: z.string(),
  avg_first_edit_min: z.number(),
  sessions: z.number(),
});
export type OutcomePredictor = z.infer<typeof outcomePredictorSchema>;

// ── Period-over-period comparison ────────────────

export const periodMetricsSchema = z.object({
  completion_rate: z.number(),
  avg_duration_min: z.number(),
  stuckness_rate: z.number(),
  memory_hit_rate: z.number(),
  edit_velocity: z.number(),
  total_sessions: z.number(),
});
export type PeriodMetrics = z.infer<typeof periodMetricsSchema>;

export const periodComparisonSchema = z.object({
  current: periodMetricsSchema,
  previous: periodMetricsSchema.nullable(),
});
export type PeriodComparison = z.infer<typeof periodComparisonSchema>;

// ── Token usage ─────────────────────────────────

export const tokenModelBreakdownSchema = z.object({
  agent_model: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  sessions: z.number(),
  estimated_cost_usd: z.number().optional(),
});
export type TokenModelBreakdown = z.infer<typeof tokenModelBreakdownSchema>;

export const tokenToolBreakdownSchema = z.object({
  host_tool: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  sessions: z.number(),
});
export type TokenToolBreakdown = z.infer<typeof tokenToolBreakdownSchema>;

export const tokenUsageStatsSchema = z.object({
  total_input_tokens: z.number(),
  total_output_tokens: z.number(),
  avg_input_per_session: z.number(),
  avg_output_per_session: z.number(),
  sessions_with_token_data: z.number(),
  sessions_without_token_data: z.number(),
  total_estimated_cost_usd: z.number(),
  by_model: z.array(tokenModelBreakdownSchema),
  by_tool: z.array(tokenToolBreakdownSchema),
});
export type TokenUsageStats = z.infer<typeof tokenUsageStatsSchema>;

/**
 * Reports which tools contributed data and which couldn't,
 * based on declared data capabilities in the tool registry.
 * Attached to analytics responses so the UI can annotate partial coverage.
 */
export const dataCoverageSchema = z.object({
  /** Tools that contributed data to this analytics response. */
  tools_reporting: z.array(z.string()),
  /** Active tools that lacked capability to contribute specific data. */
  tools_without_data: z.array(z.string()),
  /** Ratio of tools_reporting to total active tools (0-1). */
  coverage_rate: z.number(),
  /** Data capabilities that are covered by at least one active tool. */
  capabilities_available: z.array(z.string()),
  /** Data capabilities that no active tool supports. */
  capabilities_missing: z.array(z.string()),
});
export type DataCoverage = z.infer<typeof dataCoverageSchema>;

/** Cross-team user analytics — extends base TeamAnalytics with advanced breakdowns. */
export const userAnalyticsSchema = teamAnalyticsSchema.extend({
  hourly_distribution: z.array(hourlyBucketSchema),
  tool_hourly: z.array(toolHourlyBucketSchema),
  tool_daily: z.array(toolDailyTrendSchema),
  model_outcomes: z.array(modelOutcomeSchema),
  tool_outcomes: z.array(toolOutcomeSchema),
  completion_summary: completionSummarySchema,
  tool_comparison: z.array(toolComparisonSchema),
  work_type_distribution: z.array(workTypeDistributionSchema),
  tool_work_type: z.array(toolWorkTypeBreakdownSchema),
  file_churn: z.array(fileChurnEntrySchema),
  duration_distribution: z.array(durationBucketSchema),
  concurrent_edits: z.array(concurrentEditEntrySchema),
  member_analytics: z.array(memberAnalyticsSchema),
  retry_patterns: z.array(retryPatternSchema),
  conflict_correlation: z.array(conflictCorrelationSchema),
  edit_velocity: z.array(editVelocityTrendSchema),
  memory_usage: memoryUsageStatsSchema,
  work_type_outcomes: z.array(workTypeOutcomeSchema),
  conversation_edit_correlation: z.array(conversationEditCorrelationSchema),
  file_rework: z.array(fileReworkEntrySchema),
  directory_heatmap: z.array(directoryHeatmapEntrySchema),
  stuckness: stucknessStatsSchema,
  file_overlap: fileOverlapStatsSchema,
  audit_staleness: z.array(auditStalenessEntrySchema),
  first_edit_stats: firstEditStatsSchema,
  memory_outcome_correlation: z.array(memoryOutcomeCorrelationSchema),
  top_memories: z.array(memoryAccessEntrySchema),
  scope_complexity: z.array(scopeComplexityBucketSchema),
  prompt_efficiency: z.array(promptEfficiencyTrendSchema),
  hourly_effectiveness: z.array(hourlyEffectivenessSchema),
  outcome_tags: z.array(outcomeTagCountSchema),
  tool_handoffs: z.array(toolHandoffSchema),
  outcome_predictors: z.array(outcomePredictorSchema),
  period_comparison: periodComparisonSchema,
  token_usage: tokenUsageStatsSchema,
  teams_included: z.number(),
  degraded: z.boolean(),
  data_coverage: dataCoverageSchema.optional(),
});
export type UserAnalytics = z.infer<typeof userAnalyticsSchema>;
