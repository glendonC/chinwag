/**
 * Analytics and workflow intelligence types.
 *
 * Covers heatmaps, trends, distributions, behavioral patterns,
 * period comparisons, token usage, and data coverage.
 */

// ── Base analytics types ─────────────────────────

export interface FileHeatmapEntry {
  file: string;
  touch_count: number;
  work_type?: string;
  outcome_rate?: number;
  total_lines_added?: number;
  total_lines_removed?: number;
}

export interface DailyTrend {
  day: string;
  sessions: number;
  edits: number;
  lines_added: number;
  lines_removed: number;
  avg_duration_min: number;
  completed?: number;
  abandoned?: number;
  failed?: number;
}

export interface OutcomeCount {
  outcome: string;
  count: number;
}

export interface ToolDistribution {
  host_tool: string;
  sessions: number;
  edits: number;
}

export interface DailyMetricEntry {
  date: string;
  metric: string;
  count: number;
}

export interface TeamAnalytics {
  ok: true;
  period_days: number;
  file_heatmap: FileHeatmapEntry[];
  daily_trends: DailyTrend[];
  tool_distribution: ToolDistribution[];
  outcome_distribution: OutcomeCount[];
  daily_metrics: DailyMetricEntry[];
}

// ── Hourly and tool-level breakdowns ─────────────

export interface HourlyBucket {
  hour: number;
  dow: number;
  sessions: number;
  edits: number;
}

export interface ToolHourlyBucket {
  host_tool: string;
  hour: number;
  dow: number;
  sessions: number;
  edits: number;
}

export interface ToolDailyTrend {
  host_tool: string;
  day: string;
  sessions: number;
  edits: number;
  lines_added: number;
  lines_removed: number;
  avg_duration_min: number;
}

export interface ModelOutcome {
  agent_model: string;
  outcome: string;
  count: number;
  avg_duration_min: number;
  total_edits: number;
  total_lines_added: number;
  total_lines_removed: number;
}

export interface ToolOutcome {
  host_tool: string;
  outcome: string;
  count: number;
}

// ── Workflow intelligence ────────────────────────

export interface CompletionSummary {
  total_sessions: number;
  completed: number;
  abandoned: number;
  failed: number;
  unknown: number;
  completion_rate: number;
  prev_completion_rate: number | null;
}

export interface ToolComparison {
  host_tool: string;
  sessions: number;
  completed: number;
  abandoned: number;
  failed: number;
  completion_rate: number;
  avg_duration_min: number;
  total_edits: number;
  total_lines_added: number;
  total_lines_removed: number;
}

export interface WorkTypeDistribution {
  work_type: string;
  sessions: number;
  edits: number;
  lines_added: number;
  lines_removed: number;
  files: number;
}

export interface ToolWorkTypeBreakdown {
  host_tool: string;
  work_type: string;
  sessions: number;
  edits: number;
}

export interface FileChurnEntry {
  file: string;
  session_count: number;
  total_edits: number;
  total_lines: number;
}

export interface DurationBucket {
  bucket: string;
  count: number;
}

export interface ConcurrentEditEntry {
  file: string;
  agents: number;
  edit_count: number;
}

export interface MemberAnalytics {
  handle: string;
  sessions: number;
  completed: number;
  abandoned: number;
  failed: number;
  completion_rate: number;
  avg_duration_min: number;
  total_edits: number;
  total_lines_added: number;
  total_lines_removed: number;
  primary_tool: string | null;
}

export interface RetryPattern {
  handle: string;
  file: string;
  attempts: number;
  final_outcome: string | null;
  resolved: boolean;
}

export interface ConflictCorrelation {
  bucket: string;
  sessions: number;
  completed: number;
  completion_rate: number;
}

export interface EditVelocityTrend {
  day: string;
  edits_per_hour: number;
  lines_per_hour: number;
  total_session_hours: number;
}

export interface MemoryUsageStats {
  total_memories: number;
  searches: number;
  searches_with_results: number;
  search_hit_rate: number;
  memories_created_period: number;
  memories_updated_period: number;
  stale_memories: number;
  avg_memory_age_days: number;
}

export interface WorkTypeOutcome {
  work_type: string;
  sessions: number;
  completed: number;
  abandoned: number;
  failed: number;
  completion_rate: number;
}

export interface ConversationEditCorrelation {
  bucket: string;
  sessions: number;
  avg_edits: number;
  avg_lines: number;
  completion_rate: number;
}

export interface FileReworkEntry {
  file: string;
  total_edits: number;
  failed_edits: number;
  rework_ratio: number;
}

export interface DirectoryHeatmapEntry {
  directory: string;
  touch_count: number;
  file_count: number;
  total_lines: number;
  completion_rate: number;
}

export interface StucknessStats {
  total_sessions: number;
  stuck_sessions: number;
  stuckness_rate: number;
  stuck_completion_rate: number;
  normal_completion_rate: number;
}

export interface FileOverlapStats {
  total_files: number;
  overlapping_files: number;
  overlap_rate: number;
}

export interface AuditStalenessEntry {
  directory: string;
  last_edit: string;
  days_since: number;
  prior_edit_count: number;
}

export interface FirstEditStats {
  avg_minutes_to_first_edit: number;
  median_minutes_to_first_edit: number;
  by_tool: Array<{
    host_tool: string;
    avg_minutes: number;
    sessions: number;
  }>;
}

export interface MemoryOutcomeCorrelation {
  bucket: string;
  sessions: number;
  completed: number;
  completion_rate: number;
}

export interface MemoryAccessEntry {
  id: string;
  text_preview: string;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
}

export interface ScopeComplexityBucket {
  bucket: string;
  sessions: number;
  avg_edits: number;
  avg_duration_min: number;
  completion_rate: number;
}

export interface PromptEfficiencyTrend {
  day: string;
  avg_turns_per_edit: number;
  sessions: number;
}

export interface HourlyEffectiveness {
  hour: number;
  sessions: number;
  completion_rate: number;
  avg_edits: number;
}

export interface OutcomeTagCount {
  tag: string;
  count: number;
  outcome: string;
}

export interface ToolHandoff {
  from_tool: string;
  to_tool: string;
  file_count: number;
  handoff_completion_rate: number;
}

export interface OutcomePredictor {
  outcome: string;
  avg_first_edit_min: number;
  sessions: number;
}

// ── Period-over-period comparison ────────────────

export interface PeriodMetrics {
  completion_rate: number;
  avg_duration_min: number;
  stuckness_rate: number;
  memory_hit_rate: number;
  edit_velocity: number;
  total_sessions: number;
}

export interface PeriodComparison {
  current: PeriodMetrics;
  previous: PeriodMetrics | null;
}

// ── Token usage ─────────────────────────────────

export interface TokenModelBreakdown {
  agent_model: string;
  input_tokens: number;
  output_tokens: number;
  sessions: number;
}

export interface TokenToolBreakdown {
  host_tool: string;
  input_tokens: number;
  output_tokens: number;
  sessions: number;
}

export interface TokenUsageStats {
  total_input_tokens: number;
  total_output_tokens: number;
  avg_input_per_session: number;
  avg_output_per_session: number;
  sessions_with_token_data: number;
  sessions_without_token_data: number;
  by_model: TokenModelBreakdown[];
  by_tool: TokenToolBreakdown[];
}

/**
 * Reports which tools contributed data and which couldn't,
 * based on declared data capabilities in the tool registry.
 * Attached to analytics responses so the UI can annotate partial coverage.
 */
export interface DataCoverage {
  /** Tools that contributed data to this analytics response. */
  tools_reporting: string[];
  /** Active tools that lacked capability to contribute specific data. */
  tools_without_data: string[];
  /** Ratio of tools_reporting to total active tools (0-1). */
  coverage_rate: number;
  /** Data capabilities that are covered by at least one active tool. */
  capabilities_available: string[];
  /** Data capabilities that no active tool supports. */
  capabilities_missing: string[];
}

/** Cross-team user analytics — extends base TeamAnalytics with advanced breakdowns. */
export interface UserAnalytics extends TeamAnalytics {
  hourly_distribution: HourlyBucket[];
  tool_hourly: ToolHourlyBucket[];
  tool_daily: ToolDailyTrend[];
  model_outcomes: ModelOutcome[];
  tool_outcomes: ToolOutcome[];
  completion_summary: CompletionSummary;
  tool_comparison: ToolComparison[];
  work_type_distribution: WorkTypeDistribution[];
  tool_work_type: ToolWorkTypeBreakdown[];
  file_churn: FileChurnEntry[];
  duration_distribution: DurationBucket[];
  concurrent_edits: ConcurrentEditEntry[];
  member_analytics: MemberAnalytics[];
  retry_patterns: RetryPattern[];
  conflict_correlation: ConflictCorrelation[];
  edit_velocity: EditVelocityTrend[];
  memory_usage: MemoryUsageStats;
  work_type_outcomes: WorkTypeOutcome[];
  conversation_edit_correlation: ConversationEditCorrelation[];
  file_rework: FileReworkEntry[];
  directory_heatmap: DirectoryHeatmapEntry[];
  stuckness: StucknessStats;
  file_overlap: FileOverlapStats;
  audit_staleness: AuditStalenessEntry[];
  first_edit_stats: FirstEditStats;
  memory_outcome_correlation: MemoryOutcomeCorrelation[];
  top_memories: MemoryAccessEntry[];
  scope_complexity: ScopeComplexityBucket[];
  prompt_efficiency: PromptEfficiencyTrend[];
  hourly_effectiveness: HourlyEffectiveness[];
  outcome_tags: OutcomeTagCount[];
  tool_handoffs: ToolHandoff[];
  outcome_predictors: OutcomePredictor[];
  period_comparison: PeriodComparison;
  token_usage: TokenUsageStats;
  teams_included: number;
  degraded: boolean;
  data_coverage?: DataCoverage;
}
