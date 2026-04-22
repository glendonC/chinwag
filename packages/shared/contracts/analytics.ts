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
  // Per-day cost and cost-per-edit, populated post-query by
  // enrichDailyTrendsWithPricing. Null on any day where cost is
  // structurally unshowable — no token-capturing sessions that day,
  // all-unpriced models, or stale pricing — so the trend widget can plot
  // these metrics without emitting bogus zeros. Optional so old payloads
  // parse cleanly.
  cost: z.number().nullable().optional(),
  cost_per_edit: z.number().nullable().optional(),
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
  // Uncapped COUNT(DISTINCT file_path) from the edits table. Distinct from
  // file_heatmap.length, which is capped at HEATMAP_LIMIT=50 and is meant
  // for the ranked "most-touched files" list, not a scalar total.
  files_touched_total: z.number().default(0),
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
  // host_tool is nullable for backwards-compat with existing serialized
  // rows; new aggregations always populate it. Splitting the model axis by
  // tool is what makes the models widget substrate-unique (cross-tool
  // attribution no single-tool dashboard can produce).
  host_tool: z.string().nullable().default(null),
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
  // Wall-clock hours summed across completed sessions only (ended_at
  // IS NOT NULL). Matches queryEditVelocity's denominator so per-tool
  // rates in the Edits drill reconcile with the aggregate sparkline.
  total_session_hours: z.number(),
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

// Audit 2026-04-21: Pruned to fields actual consumers read. Dropped:
//   abandoned, failed — not rendered anywhere (completion_rate is the
//     consumed summary; raw outcome splits were ghosted aggregation work).
//   avg_duration_min — only shown on ModelOutcome, not member rows.
//   total_lines_added, total_lines_removed, total_commits — wiring these up
//     would commit the team-members widget to a GitHub-clone framing. They
//     can be re-added when a drill view calls for them; the SQL is not a
//     load-bearing source of truth.
// `completed` is retained because cross-team completion_rate derivation needs
// raw numerator + denominator; averaging per-team rates is wrong.
export const memberAnalyticsSchema = z.object({
  handle: z.string(),
  sessions: z.number(),
  completed: z.number(),
  completion_rate: z.number(),
  total_edits: z.number(),
  primary_tool: z.string().nullable(),
  // Same semantics as toolComparisonSchema.total_session_hours —
  // completed-session wall-clock sum, used as the per-teammate velocity
  // denominator in the Edits drill.
  total_session_hours: z.number(),
});
export type MemberAnalytics = z.infer<typeof memberAnalyticsSchema>;

// Audit 2026-04-21: Regrouped from (handle, file) to file only. The old shape
// let one noisy agent dominate the top-N: if handle-A hit Button.tsx 8 times
// and handle-B twice, the renderer showed two rows for the same file. The
// new shape is file-centric — attempts are summed across agents, and the
// agent / tool distinctness counts surface the cross-agent and cross-tool
// angle that is actually substrate-unique (vs. Claude Code's own session log
// which is per-tool). `tools` is the list of host_tools that contributed to
// the retries, deduped; `agents` is the number of distinct handles that
// retried this file.
export const retryPatternSchema = z.object({
  file: z.string(),
  attempts: z.number(),
  agents: z.number(),
  tools: z.array(z.string()),
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

export const conflictStatsSchema = z.object({
  /** Hook-sourced blocks: PreToolUse calls that found conflicts and prevented the edit. */
  blocked_period: z.number(),
  /** Every detection in the period, including advisory MCP-tool lookups. */
  found_period: z.number(),
});
export type ConflictStats = z.infer<typeof conflictStatsSchema>;

export const editVelocityTrendSchema = z.object({
  day: z.string(),
  edits_per_hour: z.number(),
  lines_per_hour: z.number(),
  total_session_hours: z.number(),
});

// Per-project (team) velocity rollup — one entry per team the caller
// belongs to, preserving the cross-project view that the aggregate
// edit_velocity otherwise collapses. total_session_hours uses the same
// `ended_at IS NOT NULL` denominator as queryEditVelocity so per-project
// rates reconcile with the aggregate sparkline. `primary_tool` is the
// host_tool with the most sessions in this project; null when the project
// has no tool-identified sessions. Powers the Edits drill's per-project
// section.
export const projectVelocityRollupSchema = z.object({
  team_id: z.string(),
  team_name: z.string().nullable(),
  sessions: z.number(),
  total_edits: z.number(),
  total_session_hours: z.number(),
  edits_per_hour: z.number(),
  primary_tool: z.string().nullable(),
});
export type ProjectVelocityRollup = z.infer<typeof projectVelocityRollupSchema>;
export type EditVelocityTrend = z.infer<typeof editVelocityTrendSchema>;

// Per-teammate daily timeline of lines attribution. Scoped to the top 50
// handles by total edits in the period (matching memberAnalyticsSchema's
// LIMIT 50 semantics so the two fields agree on which teammates exist).
// Zero-filled across the full period via the recursive-CTE spine pattern,
// so each handle's sparkline is dense. Powers the Lines drill's per-member
// stacked-area view.
export const memberDailyLineTrendSchema = z.object({
  handle: z.string(),
  day: z.string(),
  sessions: z.number(),
  edits: z.number(),
  lines_added: z.number(),
  lines_removed: z.number(),
});
export type MemberDailyLineTrend = z.infer<typeof memberDailyLineTrendSchema>;

// Per-project (team) daily timeline of lines attribution, preserving team
// identity across the cross-team aggregation that collapses `daily_trends`.
// team_id is the same identifier exposed by GET /me/teams; team_name is
// included so clients don't need a second round-trip to render a label.
// Powers the Lines drill's per-project split view.
export const projectLinesTrendSchema = z.object({
  team_id: z.string(),
  team_name: z.string().nullable(),
  day: z.string(),
  sessions: z.number(),
  edits: z.number(),
  lines_added: z.number(),
  lines_removed: z.number(),
});
export type ProjectLinesTrend = z.infer<typeof projectLinesTrendSchema>;

export const formationRecommendationCountsSchema = z.object({
  keep: z.number(),
  merge: z.number(),
  evolve: z.number(),
  discard: z.number(),
});
export type FormationRecommendationCounts = z.infer<typeof formationRecommendationCountsSchema>;

export const memoryUsageStatsSchema = z.object({
  total_memories: z.number(),
  searches: z.number(),
  searches_with_results: z.number(),
  search_hit_rate: z.number(),
  memories_created_period: z.number(),
  stale_memories: z.number(),
  avg_memory_age_days: z.number(),
  // Live count of consolidation proposals awaiting human / agent review.
  pending_consolidation_proposals: z.number(),
  // Live count of unaddressed formation observations by recommendation
  // (status = 'observed'). 'keep' is the trivial case; merge/evolve/discard
  // are flag candidates. Age does not gate — a year-old unaddressed flag
  // still needs a decision, so this query runs without a time filter.
  formation_observations_by_recommendation: formationRecommendationCountsSchema,
  // Live count of secret-detector blocks in the last 24h. Signal that the
  // filter is doing work; counts before-and-after force=true. Windowed at
  // 24h (not the global period picker) so the memory-safety review surface
  // stays live: a recent block is actionable, an old block is audit history.
  secrets_blocked_24h: z.number(),
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

// Audit 2026-04-21: Dropped `overlap_rate`. The percentage was a B1 ambiguity
// in the renderer ("60%" reads as good paired work or bad collision depending
// on context). Absolute counts stay — total_files and overlapping_files are
// concrete; consumers that need a rate recompute it from the counts.
export const fileOverlapStatsSchema = z.object({
  total_files: z.number(),
  overlapping_files: z.number(),
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
  // Nullable: the worker emits null for days with no conversation+edit
  // activity (NULLIF on zero edits → no outer COALESCE). The client
  // treats null as "skip this point" rather than rendering a zero floor.
  avg_turns_per_edit: z.number().nullable(),
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

export const toolHandoffRecentFileSchema = z.object({
  file_path: z.string(),
  last_transition_at: z.string(),
  a_edits: z.number(),
  b_edits: z.number(),
  completed: z.boolean(),
});
export type ToolHandoffRecentFile = z.infer<typeof toolHandoffRecentFileSchema>;

export const toolHandoffSchema = z.object({
  from_tool: z.string(),
  to_tool: z.string(),
  file_count: z.number(),
  handoff_completion_rate: z.number(),
  avg_gap_minutes: z.number().default(0),
  recent_files: z.array(toolHandoffRecentFileSchema).default([]),
});
export type ToolHandoff = z.infer<typeof toolHandoffSchema>;

// ── Tool call analytics ────────────────────────

export const toolCallFrequencySchema = z.object({
  tool: z.string(),
  calls: z.number(),
  errors: z.number(),
  error_rate: z.number(),
  avg_duration_ms: z.number(),
  sessions: z.number(),
});
export type ToolCallFrequency = z.infer<typeof toolCallFrequencySchema>;

export const toolCallErrorPatternSchema = z.object({
  tool: z.string(),
  error_preview: z.string(),
  count: z.number(),
  // ISO timestamp of the most recent occurrence. Lets the errors widget
  // surface a recency pane alongside frequency so rare-but-recent errors
  // don't get buried under high-count historical ones. Nullable to stay
  // compatible with old payloads.
  last_at: z.string().nullable().default(null),
});
export type ToolCallErrorPattern = z.infer<typeof toolCallErrorPatternSchema>;

export const toolCallTimelineSchema = z.object({
  hour: z.number(),
  calls: z.number(),
  errors: z.number(),
});
export type ToolCallTimeline = z.infer<typeof toolCallTimelineSchema>;

export const toolCallStatsSchema = z.object({
  total_calls: z.number(),
  total_errors: z.number(),
  error_rate: z.number(),
  avg_duration_ms: z.number(),
  calls_per_session: z.number(),
  research_to_edit_ratio: z.number(),
  /** Percentage of sessions where the first edit succeeded without retry (0-100). */
  one_shot_rate: z.number(),
  /** Number of sessions with edits used in the one-shot calculation. */
  one_shot_sessions: z.number(),
  frequency: z.array(toolCallFrequencySchema),
  error_patterns: z.array(toolCallErrorPatternSchema),
  hourly_activity: z.array(toolCallTimelineSchema),
});
export type ToolCallStats = z.infer<typeof toolCallStatsSchema>;

// ── Commit analytics ──────────────────────────────

export const commitToolBreakdownSchema = z.object({
  host_tool: z.string(),
  commits: z.number(),
  avg_files_changed: z.number(),
  avg_lines: z.number(),
});
export type CommitToolBreakdown = z.infer<typeof commitToolBreakdownSchema>;

export const dailyCommitSchema = z.object({
  day: z.string(),
  commits: z.number(),
});
export type DailyCommit = z.infer<typeof dailyCommitSchema>;

export const commitOutcomeCorrelationSchema = z.object({
  bucket: z.string(),
  sessions: z.number(),
  completed: z.number(),
  completion_rate: z.number(),
});
export type CommitOutcomeCorrelation = z.infer<typeof commitOutcomeCorrelationSchema>;

export const commitEditRatioBucketSchema = z.object({
  bucket: z.string(),
  sessions: z.number(),
  completion_rate: z.number(),
  avg_edits: z.number(),
  avg_commits: z.number(),
});
export type CommitEditRatioBucket = z.infer<typeof commitEditRatioBucketSchema>;

export const commitStatsSchema = z.object({
  total_commits: z.number(),
  commits_per_session: z.number(),
  sessions_with_commits: z.number(),
  avg_time_to_first_commit_min: z.number().nullable(),
  by_tool: z.array(commitToolBreakdownSchema),
  daily_commits: z.array(dailyCommitSchema),
  outcome_correlation: z.array(commitOutcomeCorrelationSchema),
  commit_edit_ratio: z.array(commitEditRatioBucketSchema),
});
export type CommitStats = z.infer<typeof commitStatsSchema>;

// ── Period-over-period comparison ────────────────

export const periodMetricsSchema = z.object({
  completion_rate: z.number(),
  avg_duration_min: z.number(),
  stuckness_rate: z.number(),
  memory_hit_rate: z.number(),
  edit_velocity: z.number(),
  total_sessions: z.number(),
  /** Total USD cost for this period's token-capturing sessions. Null when
   *  pricing is stale, no token data was captured, or every model in the
   *  period was missing from LiteLLM pricing. Both windows are priced
   *  against the CURRENT pricing snapshot so deltas reflect behavior
   *  change, not Anthropic/OpenAI price movement. */
  total_estimated_cost_usd: z.number().nullable().default(null),
  /** Sum of edit_count across sessions where input_tokens IS NOT NULL in
   *  this period. Denominator for cost_per_edit. Always countable (no null). */
  total_edits_in_token_sessions: z.number().default(0),
  /** Period-scoped cost divided by edits. See field above for the
   *  retroactive-pricing semantic. Null under the same conditions as
   *  total_estimated_cost_usd OR when total_edits_in_token_sessions is 0. */
  cost_per_edit: z.number().nullable().default(null),
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
  cache_read_tokens: z.number().default(0),
  cache_creation_tokens: z.number().default(0),
  sessions: z.number(),
  // Null when the model isn't in our LiteLLM snapshot, or when the snapshot
  // is >7 days stale. UI should render "—" rather than "$0" in that case.
  estimated_cost_usd: z.number().nullable().default(null),
});
export type TokenModelBreakdown = z.infer<typeof tokenModelBreakdownSchema>;

export const tokenToolBreakdownSchema = z.object({
  host_tool: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_tokens: z.number().default(0),
  cache_creation_tokens: z.number().default(0),
  sessions: z.number(),
});
export type TokenToolBreakdown = z.infer<typeof tokenToolBreakdownSchema>;

export const tokenUsageStatsSchema = z.object({
  total_input_tokens: z.number(),
  total_output_tokens: z.number(),
  total_cache_read_tokens: z.number().default(0),
  total_cache_creation_tokens: z.number().default(0),
  avg_input_per_session: z.number(),
  avg_output_per_session: z.number(),
  sessions_with_token_data: z.number(),
  sessions_without_token_data: z.number(),
  /** Sum of edit_count across sessions where input_tokens IS NOT NULL.
   *  This is the denominator for cost_per_edit — scoping to token-capturing
   *  sessions is what prevents mixing populations (e.g. Cursor contributing
   *  edits without token data would otherwise deflate the ratio). */
  total_edits_in_token_sessions: z.number().default(0),
  /** Total USD cost across priced models. Null when pricing is stale
   *  (>7 days) OR no model in the period was in the LiteLLM snapshot.
   *  Zero only when sessions exist but token totals are literally zero —
   *  UI must distinguish null (unknown) from 0 (measured). */
  total_estimated_cost_usd: z.number().nullable().default(null),
  // ISO timestamp of the most recent successful LiteLLM pricing refresh, or
  // null if no refresh has ever succeeded. UI reads this + pricing_is_stale
  // to decide whether to show a staleness banner.
  pricing_refreshed_at: z.string().nullable().default(null),
  // True when the snapshot is >7 days old. The enrichment layer zeroes
  // costs in that state rather than serving stale numbers.
  pricing_is_stale: z.boolean().default(false),
  // Canonical names we couldn't price, capped at MAX_UNPRICED_REPORTED (20).
  // Drives a "coverage gap" surface so we know when the resolver needs
  // updating. Complemented by models_without_pricing_total below.
  models_without_pricing: z.array(z.string()).default([]),
  // Total count of unknown models, including any beyond the display cap.
  // A response with 20 in the list and total = 100 signals that the resolver
  // is missing a large swath of real production models — much louder than
  // silently truncating. Always >= models_without_pricing.length.
  models_without_pricing_total: z.number().default(0),
  /** Cost divided by total edits across sessions with token data. Null when no edits. */
  cost_per_edit: z.number().nullable().default(null),
  /** cache_read_tokens / (input + cache_read + cache_creation). 0-1, null when no tokens. */
  cache_hit_rate: z.number().nullable().default(null),
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
  // Uncapped count of distinct handles with activity in the window. Ships
  // alongside member_analytics (which is capped at 50 per team) so the
  // renderer can surface a truthful "+N more" affordance when the team
  // has more active members than the rendered list.
  member_analytics_total: z.number(),
  retry_patterns: z.array(retryPatternSchema),
  conflict_correlation: z.array(conflictCorrelationSchema),
  conflict_stats: conflictStatsSchema,
  edit_velocity: z.array(editVelocityTrendSchema),
  // Lines drill axes. Default to [] so older producers stay compatible.
  member_daily_lines: z.array(memberDailyLineTrendSchema).default([]),
  per_project_lines: z.array(projectLinesTrendSchema).default([]),
  per_project_velocity: z.array(projectVelocityRollupSchema).default([]),
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
  period_comparison: periodComparisonSchema,
  token_usage: tokenUsageStatsSchema,
  tool_call_stats: toolCallStatsSchema,
  commit_stats: commitStatsSchema,
  teams_included: z.number(),
  degraded: z.boolean(),
  data_coverage: dataCoverageSchema.optional(),
});
export type UserAnalytics = z.infer<typeof userAnalyticsSchema>;
