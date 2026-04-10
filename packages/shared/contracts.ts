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

// -- Analytics types (workflow intelligence) --

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

// ── Workflow intelligence types ─────────────────────

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

// ── Period-over-period comparison ─────────────────

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

// ── Token usage analytics ─────────────────────────

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
  categories?: string[];
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

// -- Conversation intelligence types --

export interface ConversationEvent {
  id: string;
  session_id: string;
  agent_id: string;
  handle: string;
  host_tool: string;
  role: 'user' | 'assistant';
  content: string;
  char_count: number;
  sentiment: string | null;
  topic: string | null;
  sequence: number;
  created_at: string;
}

export interface SentimentDistribution {
  sentiment: string;
  count: number;
}

export interface TopicDistribution {
  topic: string;
  count: number;
}

export interface CharCountTrend {
  sequence: number;
  avg_char_count: number;
}

export interface SentimentOutcomeCorrelation {
  dominant_sentiment: string;
  sessions: number;
  completed: number;
  abandoned: number;
  failed: number;
  completion_rate: number;
}

export interface SessionConversationStats {
  session_id: string;
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  avg_user_msg_length: number;
  avg_assistant_msg_length: number;
  dominant_sentiment: string | null;
  sentiment_shift: 'stable' | 'improving' | 'degrading' | null;
  topics: string[];
}

export interface ConversationToolCoverage {
  /** Tools that support conversation analytics. */
  supported_tools: string[];
  /** Tools active in this team that DON'T support conversation analytics. */
  unsupported_tools: string[];
}

export interface ConversationAnalytics {
  ok: true;
  period_days: number;
  total_messages: number;
  user_messages: number;
  assistant_messages: number;
  avg_user_char_count: number;
  avg_assistant_char_count: number;
  sentiment_distribution: SentimentDistribution[];
  topic_distribution: TopicDistribution[];
  sentiment_outcome_correlation: SentimentOutcomeCorrelation[];
  sessions_with_conversations: number;
  /** Which tools in this team have/lack conversation support. */
  tool_coverage: ConversationToolCoverage;
}
