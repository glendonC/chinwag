/**
 * Widget catalog: every data point that can appear on the overview.
 *
 * 12-column grid. Each widget specifies w (columns) and h (row units).
 * Row height is ~80px. Widgets snap to these grid positions.
 *
 * Sizes:
 *   KPI stat card:    3 cols × 2 rows  (quarter width, compact)
 *   Half chart:       6 cols × 3 rows  (half width, standard chart)
 *   Wide chart:       8 cols × 3 rows  (two-thirds)
 *   Full-width:      12 cols × 3 rows  (tables, timelines)
 *   Tall full-width: 12 cols × 4 rows  (heatmap, large viz)
 */

/** Layout item for react-grid-layout */
interface RGLLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export type WidgetViz =
  | 'stat'
  | 'stat-row'
  | 'sparkline'
  | 'multi-sparkline'
  | 'heatmap'
  | 'bar-chart'
  | 'proportional-bar'
  | 'data-list'
  | 'outcome-bar'
  | 'factual-grid'
  | 'sentiment-bars'
  | 'topic-bars'
  | 'project-list'
  | 'bucket-chart'
  | 'live-list';

export type WidgetCategory =
  | 'live'
  | 'usage'
  | 'outcomes'
  | 'activity'
  | 'codebase'
  | 'tools'
  | 'conversations'
  | 'memory'
  | 'team';

export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  category: WidgetCategory;
  viz: WidgetViz;
  /** Default width in grid columns (1-12) */
  w: number;
  /** Default height in row units (~80px each) */
  h: number;
  /** Minimum width */
  minW?: number;
  /** Minimum height */
  minH?: number;
  /** Maximum width */
  maxW?: number;
  /** Maximum height */
  maxH?: number;
  /** Data keys on UserAnalytics or ConversationAnalytics */
  dataKeys: string[];
  /**
   * Hide the shared section-label eyebrow above the body. For widgets whose
   * body is self-explanatory (e.g. live-agents: a directory-style table with
   * its own column headers), the eyebrow becomes visual redundancy.
   */
  hideLabel?: boolean;
}

// ── The catalog ──────────────────────────────────

export const WIDGET_CATALOG: WidgetDef[] = [
  // ── Live (presence / coordination) ────
  {
    id: 'live-agents',
    name: 'Live now',
    description: 'Agents working across your projects right now',
    category: 'live',
    viz: 'live-list',
    w: 12,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['dashboard'],
  },
  {
    id: 'live-conflicts',
    name: 'Live conflicts',
    description: 'Files being edited by more than one agent right now',
    category: 'live',
    viz: 'data-list',
    w: 4,
    h: 3,
    minW: 3,
    minH: 2,
    dataKeys: ['dashboard'],
  },
  {
    id: 'files-in-play',
    name: 'Files in play',
    description: 'Files currently being edited across your projects',
    category: 'live',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['dashboard'],
  },

  // ── Usage (KPI stats) ─────────────────
  {
    id: 'sessions',
    name: 'Sessions',
    description: 'Total sessions this period',
    category: 'usage',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['daily_trends'],
  },
  {
    id: 'edits',
    name: 'Edits',
    description: 'Total edits made by agents',
    category: 'usage',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['daily_trends'],
  },
  {
    id: 'lines-added',
    name: 'Lines added',
    description: 'Total lines of code added',
    category: 'usage',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['daily_trends'],
  },
  {
    id: 'lines-removed',
    name: 'Lines removed',
    description: 'Total lines of code removed',
    category: 'usage',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['daily_trends'],
  },
  {
    id: 'files-touched',
    name: 'Files touched',
    description: 'Unique files edited by agents',
    category: 'usage',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['file_heatmap'],
  },
  {
    id: 'cost',
    name: 'Cost',
    description: 'Estimated cost from token usage',
    category: 'usage',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['token_usage'],
  },
  {
    id: 'cost-per-edit',
    name: 'Cost per edit',
    description: 'Average cost per file edit across sessions with token data',
    category: 'usage',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['token_usage'],
  },
  {
    id: 'cache-efficiency',
    name: 'Cache efficiency',
    description: 'Share of input tokens served from prompt cache',
    category: 'tools',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['token_usage'],
  },

  // ── Trends (sparklines) ───────────────
  {
    id: 'session-trend',
    name: 'Session trend',
    description: 'Daily session volume over time',
    category: 'usage',
    viz: 'sparkline',
    w: 8,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['daily_trends'],
  },
  {
    id: 'edit-velocity',
    name: 'Edit velocity',
    description: 'Edits per hour trend over time',
    category: 'usage',
    viz: 'sparkline',
    w: 8,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['edit_velocity'],
  },

  // ── Outcomes ──────────────────────────
  {
    id: 'outcomes',
    name: 'Outcomes',
    description: 'Finished, abandoned, and failed sessions',
    category: 'outcomes',
    viz: 'outcome-bar',
    w: 4,
    h: 3,
    minW: 3,
    minH: 2,
    dataKeys: ['completion_summary'],
  },
  {
    id: 'one-shot-rate',
    name: 'One-shot rate',
    description: 'Percentage of sessions where edits worked without retry',
    category: 'outcomes',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['tool_call_stats'],
  },
  {
    id: 'stuckness',
    name: 'Stuck sessions',
    description: 'Sessions where the agent stalled for 15+ minutes',
    category: 'outcomes',
    viz: 'stat-row',
    w: 4,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['stuckness'],
  },

  // ── Activity ──────────────────────────
  {
    id: 'heatmap',
    name: 'Activity heatmap',
    description: 'When you run sessions by hour and day of week',
    category: 'activity',
    viz: 'heatmap',
    w: 8,
    h: 4,
    minW: 6,
    minH: 3,
    dataKeys: ['hourly_distribution'],
  },
  {
    id: 'work-types',
    name: 'Work types',
    description: 'What kind of work: frontend, backend, test, docs, etc.',
    category: 'activity',
    viz: 'proportional-bar',
    w: 4,
    h: 3,
    minW: 3,
    minH: 2,
    dataKeys: ['work_type_distribution'],
  },

  // ── Codebase ──────────────────────────
  {
    id: 'commit-stats',
    name: 'Commits',
    description: 'Commit activity from agent sessions',
    category: 'codebase',
    viz: 'stat-row',
    w: 6,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['commit_stats'],
  },
  {
    id: 'directories',
    name: 'Top directories',
    description: 'Most-edited directories by touch count',
    category: 'codebase',
    viz: 'bar-chart',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['directory_heatmap'],
  },
  {
    id: 'files',
    name: 'Top files',
    description: 'Most-edited files by touch count',
    category: 'codebase',
    viz: 'data-list',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['file_heatmap'],
  },

  // ── Tools & Models ────────────────────
  {
    id: 'tools',
    name: 'Tools used',
    description: 'AI tools and their session/edit counts',
    category: 'tools',
    viz: 'factual-grid',
    w: 6,
    h: 3,
    minW: 3,
    minH: 2,
    dataKeys: ['tool_comparison'],
  },
  {
    id: 'models',
    name: 'Models used',
    description: 'AI models and their session/edit counts',
    category: 'tools',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 3,
    minH: 2,
    dataKeys: ['model_outcomes'],
  },

  // ── Conversations ─────────────────────
  {
    id: 'sentiment',
    name: 'Sentiment',
    description: 'Your message sentiment: positive, neutral, frustrated',
    category: 'conversations',
    viz: 'sentiment-bars',
    w: 4,
    h: 3,
    minW: 3,
    minH: 2,
    dataKeys: ['conversation'],
  },
  {
    id: 'topics',
    name: 'Topics',
    description: 'What you discuss: bug-fix, feature, refactor, testing',
    category: 'conversations',
    viz: 'topic-bars',
    w: 4,
    h: 3,
    minW: 3,
    minH: 2,
    dataKeys: ['conversation'],
  },

  // ── Memory ────────────────────────────
  {
    id: 'memory-stats',
    name: 'Memory',
    description: 'Shared memories, searches, and freshness',
    category: 'memory',
    viz: 'stat-row',
    w: 6,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['memory_usage'],
  },

  // ── Team ──────────────────────────────
  {
    id: 'team-members',
    name: 'Team',
    description: 'Teammates and their session/edit activity',
    category: 'team',
    viz: 'data-list',
    w: 12,
    h: 3,
    minW: 6,
    minH: 2,
    dataKeys: ['member_analytics'],
  },

  // ── Projects ──────────────────────────
  {
    id: 'projects',
    name: 'Projects',
    description: 'Your connected projects',
    category: 'usage',
    viz: 'project-list',
    w: 12,
    h: 3,
    minW: 6,
    minH: 2,
    dataKeys: ['dashboard'],
  },

  // ── Outcomes (extended) ─────────────
  {
    id: 'first-edit',
    name: 'First edit timing',
    description: 'How long before agents start producing edits',
    category: 'outcomes',
    viz: 'stat-row',
    w: 6,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['first_edit_stats'],
  },
  {
    id: 'duration-dist',
    name: 'Session durations',
    description: 'Distribution of session lengths',
    category: 'outcomes',
    viz: 'bar-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['duration_distribution'],
  },
  {
    id: 'scope-complexity',
    name: 'Scope complexity',
    description: 'Files touched per session vs completion rate',
    category: 'outcomes',
    viz: 'bucket-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['scope_complexity'],
  },

  // ── Activity (extended) ─────────────
  {
    id: 'prompt-efficiency',
    name: 'Prompt efficiency',
    description: 'User turns per edit trend over time',
    category: 'activity',
    viz: 'sparkline',
    w: 8,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['prompt_efficiency'],
  },
  {
    id: 'hourly-effectiveness',
    name: 'Hourly effectiveness',
    description: 'Completion rate and output by hour of day',
    category: 'activity',
    viz: 'bar-chart',
    w: 8,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['hourly_effectiveness'],
  },
  {
    id: 'work-type-outcomes',
    name: 'Work type outcomes',
    description: 'Completion rate by work type',
    category: 'activity',
    viz: 'bar-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['work_type_outcomes'],
  },

  // ── Codebase (extended) ─────────────
  {
    id: 'file-churn',
    name: 'File churn',
    description: 'Files edited across multiple sessions',
    category: 'codebase',
    viz: 'data-list',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['file_churn'],
  },
  {
    id: 'file-rework',
    name: 'File rework',
    description: 'Files with high failed-edit ratios',
    category: 'codebase',
    viz: 'data-list',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['file_rework'],
  },
  {
    id: 'audit-staleness',
    name: 'Stale directories',
    description: 'Directories with no recent activity',
    category: 'codebase',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['audit_staleness'],
  },
  {
    id: 'concurrent-edits',
    name: 'Concurrent edits',
    description: 'Files edited by multiple agents',
    category: 'codebase',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['concurrent_edits'],
  },

  // ── Tools (extended) ────────────────
  {
    id: 'tool-outcomes',
    name: 'Tool outcomes',
    description: 'Completion breakdown per tool',
    category: 'tools',
    viz: 'bar-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['tool_outcomes'],
  },
  {
    id: 'tool-handoffs',
    name: 'Tool handoffs',
    description: 'Files that move between different tools',
    category: 'tools',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['tool_handoffs'],
  },
  {
    id: 'tool-calls',
    name: 'Tool calls',
    description: 'Total calls, error rate, research-to-edit ratio',
    category: 'tools',
    viz: 'stat-row',
    w: 6,
    h: 2,
    minW: 4,
    minH: 2,
    dataKeys: ['tool_call_stats'],
  },
  {
    id: 'tool-call-freq',
    name: 'Tool call frequency',
    description: 'Most-invoked tools with error rates',
    category: 'tools',
    viz: 'bar-chart',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['tool_call_stats'],
  },
  {
    id: 'tool-call-errors',
    name: 'Tool call errors',
    description: 'Common error patterns across tools',
    category: 'tools',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['tool_call_stats'],
  },
  {
    id: 'token-detail',
    name: 'Token usage',
    description: 'Token consumption by model and tool',
    category: 'tools',
    viz: 'data-list',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['token_usage'],
  },
  {
    id: 'tool-daily',
    name: 'Tool adoption',
    description: 'Daily session volume per tool — adoption and migration over time',
    category: 'tools',
    viz: 'multi-sparkline',
    w: 8,
    h: 4,
    minW: 6,
    minH: 3,
    dataKeys: ['tool_daily'],
  },
  {
    id: 'tool-work-type',
    name: 'Tool work mix',
    description: 'What kind of work each tool handles',
    category: 'tools',
    viz: 'proportional-bar',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['tool_work_type'],
  },
  {
    id: 'data-coverage',
    name: 'Data coverage',
    description: 'Which insight categories have data and which are waiting',
    category: 'tools',
    viz: 'data-list',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['data_coverage'],
  },

  // ── Conversations (extended) ────────
  {
    id: 'sentiment-outcomes',
    name: 'Sentiment vs outcomes',
    description: 'How conversation sentiment correlates with session success',
    category: 'conversations',
    viz: 'bar-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['conversation'],
  },
  {
    id: 'conversation-depth',
    name: 'Conversation depth',
    description: 'How conversation length affects edit output',
    category: 'conversations',
    viz: 'bucket-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['conversation_edit_correlation'],
  },
  {
    id: 'message-length',
    name: 'Message length',
    description: 'Average characters per user prompt vs assistant response',
    category: 'conversations',
    viz: 'stat-row',
    w: 4,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['conversation'],
  },

  // ── Memory (extended) ───────────────
  {
    id: 'memory-outcomes',
    name: 'Memory vs outcomes',
    description: 'How memory usage correlates with session success',
    category: 'memory',
    viz: 'bar-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['memory_outcome_correlation'],
  },
  {
    id: 'top-memories',
    name: 'Top memories',
    description: 'Most-accessed shared memories',
    category: 'memory',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['top_memories'],
  },

  // ── Team (extended) ─────────────────
  {
    id: 'conflict-impact',
    name: 'Conflict impact',
    description: 'How conflicts affect session completion',
    category: 'team',
    viz: 'stat-row',
    w: 6,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['conflict_correlation'],
  },
  {
    id: 'retry-patterns',
    name: 'Retry patterns',
    description: 'Files retried across sessions after failure',
    category: 'team',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['retry_patterns'],
  },
  {
    id: 'file-overlap',
    name: 'File overlap',
    description: 'Share of files touched by more than one agent',
    category: 'team',
    viz: 'stat-row',
    w: 4,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['file_overlap'],
  },
];

// ── Size constraints by viz type ─────────────────
// Applied as defaults — explicit maxW/maxH on a widget override these.

const VIZ_MAX_CONSTRAINTS: Record<WidgetViz, { maxW: number; maxH: number }> = {
  stat: { maxW: 4, maxH: 2 },
  'stat-row': { maxW: 12, maxH: 2 },
  sparkline: { maxW: 12, maxH: 4 },
  'multi-sparkline': { maxW: 12, maxH: 8 },
  heatmap: { maxW: 12, maxH: 6 },
  'bar-chart': { maxW: 12, maxH: 6 },
  'proportional-bar': { maxW: 12, maxH: 8 },
  'data-list': { maxW: 12, maxH: 8 },
  'outcome-bar': { maxW: 6, maxH: 4 },
  'factual-grid': { maxW: 12, maxH: 4 },
  'sentiment-bars': { maxW: 8, maxH: 5 },
  'topic-bars': { maxW: 8, maxH: 5 },
  'project-list': { maxW: 12, maxH: 6 },
  'bucket-chart': { maxW: 12, maxH: 5 },
  'live-list': { maxW: 12, maxH: 3 },
};

// ── Lookup ───────────────────────────────────────

export const WIDGET_MAP = new Map(
  WIDGET_CATALOG.map((w) => {
    const vizMax = VIZ_MAX_CONSTRAINTS[w.viz];
    return [
      w.id,
      {
        ...w,
        maxW: w.maxW ?? vizMax?.maxW,
        maxH: w.maxH ?? vizMax?.maxH,
      },
    ];
  }),
);

export function getWidget(id: string): WidgetDef | undefined {
  return WIDGET_MAP.get(id);
}

// ── Category metadata ───────────────────────────

export const CATEGORIES: Array<{ id: WidgetCategory; label: string }> = [
  { id: 'live', label: 'Live' },
  { id: 'usage', label: 'Usage' },
  { id: 'outcomes', label: 'Outcomes' },
  { id: 'activity', label: 'Activity' },
  { id: 'codebase', label: 'Codebase' },
  { id: 'tools', label: 'Tools & Models' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'memory', label: 'Memory' },
  { id: 'team', label: 'Team' },
];

// ── Default layout for new users ────────────────
// x/y positions on the 12-column grid

export const DEFAULT_LAYOUT: RGLLayout[] = [
  // Row 0: Live presence table (full width, h=3 to fit header + ~3 rows)
  { i: 'live-agents', x: 0, y: 0, w: 12, h: 3 },

  // Row 3: KPI stats across the top
  { i: 'sessions', x: 0, y: 3, w: 3, h: 2 },
  { i: 'edits', x: 3, y: 3, w: 3, h: 2 },
  { i: 'cost', x: 6, y: 3, w: 3, h: 2 },
  { i: 'files-touched', x: 9, y: 3, w: 3, h: 2 },

  // Row 5: Trend chart (wide) + Outcomes (narrow)
  { i: 'session-trend', x: 0, y: 5, w: 8, h: 3 },
  { i: 'outcomes', x: 8, y: 5, w: 4, h: 3 },

  // Row 8: Heatmap (wide) + Work types (narrow)
  { i: 'heatmap', x: 0, y: 8, w: 8, h: 4 },
  { i: 'work-types', x: 8, y: 8, w: 4, h: 3 },

  // Row 12: Codebase — dirs + files side by side
  { i: 'directories', x: 0, y: 12, w: 6, h: 4 },
  { i: 'files', x: 6, y: 12, w: 6, h: 4 },

  // Row 16: Tools + Models side by side
  { i: 'tools', x: 0, y: 16, w: 6, h: 3 },
  { i: 'models', x: 6, y: 16, w: 6, h: 3 },

  // Row 19: Health signals
  { i: 'memory-stats', x: 0, y: 19, w: 6, h: 2 },
  { i: 'stuckness', x: 6, y: 19, w: 6, h: 2 },

  // Row 21: Projects (full width)
  { i: 'projects', x: 0, y: 21, w: 12, h: 3 },
];

export const DEFAULT_WIDGET_IDS = DEFAULT_LAYOUT.map((l) => l.i);
