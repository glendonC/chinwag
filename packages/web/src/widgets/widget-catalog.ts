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

/**
 * Which view surfaces a widget should appear in:
 *   'overview'  — cross-project / developer-level scope only
 *   'project'   — single-project scope only
 *   'both'      — renders correctly at either scope
 * Used by the picker to filter catalog entries per view.
 */
export type WidgetScope = 'overview' | 'project' | 'both';

export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  category: WidgetCategory;
  scope: WidgetScope;
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
}

// ── The catalog ──────────────────────────────────

export const WIDGET_CATALOG: WidgetDef[] = [
  // ── Live (presence / coordination) ────
  {
    id: 'live-agents',
    name: 'live agents',
    description: 'Agents working right now',
    category: 'live',
    scope: 'both',
    viz: 'live-list',
    w: 12,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['dashboard'],
  },
  {
    id: 'live-conflicts',
    name: 'live conflicts',
    description: 'Files being edited by more than one agent right now',
    category: 'live',
    scope: 'both',
    viz: 'data-list',
    w: 4,
    h: 3,
    minW: 3,
    minH: 2,
    dataKeys: ['dashboard'],
  },
  {
    id: 'files-in-play',
    name: 'active files',
    description: 'Files currently being edited',
    category: 'live',
    scope: 'both',
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
    name: 'sessions',
    description: 'Total sessions this period',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['daily_trends'],
  },
  {
    id: 'edits',
    name: 'edits',
    description: 'Total edits made by agents',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['daily_trends'],
  },
  {
    id: 'lines-added',
    name: 'lines added',
    description: 'Total lines of code added',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['daily_trends'],
  },
  {
    id: 'lines-removed',
    name: 'lines removed',
    description: 'Total lines of code removed',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['daily_trends'],
  },
  {
    id: 'files-touched',
    name: 'files touched',
    description: 'Unique files edited by agents',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['file_heatmap'],
  },
  {
    id: 'cost',
    name: 'cost',
    description: 'Estimated cost from token usage',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['token_usage'],
  },
  {
    id: 'cost-per-edit',
    name: 'cost per edit',
    description: 'Average cost per file edit across sessions with token data',
    category: 'usage',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['token_usage'],
  },
  {
    id: 'cache-efficiency',
    name: 'cache hit rate',
    description: 'Share of input tokens served from prompt cache',
    category: 'tools',
    scope: 'both',
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
    name: 'session trend',
    description: 'Daily session volume over time',
    category: 'usage',
    scope: 'both',
    viz: 'sparkline',
    w: 8,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['daily_trends'],
  },
  {
    id: 'edit-velocity',
    name: 'edits per hour',
    description: 'Edits per hour trend over time',
    category: 'usage',
    scope: 'both',
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
    name: 'outcomes',
    description: 'Finished, abandoned, and failed sessions',
    category: 'outcomes',
    scope: 'both',
    viz: 'outcome-bar',
    w: 4,
    h: 3,
    minW: 3,
    minH: 2,
    dataKeys: ['completion_summary'],
  },
  {
    id: 'one-shot-rate',
    name: 'one-shot rate',
    description: 'Percentage of sessions where edits worked without retry',
    category: 'outcomes',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['tool_call_stats'],
  },
  {
    id: 'stuckness',
    name: 'stuck sessions',
    description: 'Sessions where the agent stalled for 15+ minutes',
    category: 'outcomes',
    scope: 'both',
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
    name: 'activity heatmap',
    description: 'When you run sessions by hour and day of week',
    category: 'activity',
    scope: 'both',
    viz: 'heatmap',
    w: 8,
    h: 4,
    minW: 6,
    minH: 3,
    dataKeys: ['hourly_distribution'],
  },
  {
    id: 'work-types',
    name: 'work types',
    description: 'What kind of work: frontend, backend, test, docs, etc.',
    category: 'activity',
    scope: 'both',
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
    name: 'commits',
    description: 'Commit activity from agent sessions',
    category: 'codebase',
    scope: 'both',
    viz: 'stat-row',
    w: 6,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['commit_stats'],
  },
  {
    id: 'directories',
    name: 'top directories',
    description: 'Most-edited directories by touch count',
    category: 'codebase',
    scope: 'both',
    viz: 'bar-chart',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['directory_heatmap'],
  },
  {
    id: 'files',
    name: 'top files',
    description: 'Most-edited files by touch count',
    category: 'codebase',
    scope: 'both',
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
    name: 'tool comparison',
    description: 'AI tools and their session/edit counts',
    category: 'tools',
    scope: 'both',
    viz: 'factual-grid',
    w: 6,
    h: 3,
    minW: 3,
    minH: 2,
    dataKeys: ['tool_comparison'],
  },
  {
    id: 'models',
    name: 'models',
    description: 'AI models and their session/edit counts',
    category: 'tools',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 3,
    minH: 2,
    dataKeys: ['model_outcomes'],
  },

  // ── Conversations ─────────────────────
  {
    id: 'topics',
    name: 'topics',
    description: 'What you discuss: bug-fix, feature, refactor, testing',
    category: 'conversations',
    scope: 'both',
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
    name: 'memory usage',
    description: 'Shared memories, searches, and freshness',
    category: 'memory',
    scope: 'both',
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
    name: 'team members',
    description: 'Teammates and their session/edit activity',
    category: 'team',
    scope: 'both',
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
    name: 'projects',
    description: 'Your connected projects',
    category: 'usage',
    scope: 'overview',
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
    name: 'time to first edit',
    description: 'How long before agents start producing edits',
    category: 'outcomes',
    scope: 'both',
    viz: 'stat-row',
    w: 6,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['first_edit_stats'],
  },
  {
    id: 'duration-dist',
    name: 'session durations',
    description: 'Distribution of session lengths',
    category: 'outcomes',
    scope: 'both',
    viz: 'bar-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['duration_distribution'],
  },
  {
    id: 'scope-complexity',
    name: 'scope complexity',
    description: 'Files touched per session vs completion rate',
    category: 'outcomes',
    scope: 'both',
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
    name: 'prompt efficiency',
    description: 'User turns per edit trend over time',
    category: 'activity',
    scope: 'both',
    viz: 'sparkline',
    w: 8,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['prompt_efficiency'],
  },
  {
    id: 'hourly-effectiveness',
    name: 'completion rate by hour',
    description: 'Completion rate and output by hour of day',
    category: 'activity',
    scope: 'both',
    viz: 'bar-chart',
    w: 8,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['hourly_effectiveness'],
  },
  {
    id: 'work-type-outcomes',
    name: 'work type outcomes',
    description: 'Completion rate by work type',
    category: 'activity',
    scope: 'both',
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
    name: 'file churn',
    description: 'Files edited across multiple sessions',
    category: 'codebase',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['file_churn'],
  },
  {
    id: 'file-rework',
    name: 'file rework',
    description: 'Files with high failed-edit ratios',
    category: 'codebase',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['file_rework'],
  },
  {
    id: 'audit-staleness',
    name: 'stale directories',
    description: 'Directories with no recent activity',
    category: 'codebase',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['audit_staleness'],
  },
  {
    id: 'concurrent-edits',
    name: 'edit collisions',
    description: 'Files touched by multiple agents in the same period — conflict risk',
    category: 'codebase',
    scope: 'both',
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
    name: 'tool outcomes',
    description: 'Completion breakdown per tool',
    category: 'tools',
    scope: 'both',
    viz: 'bar-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['tool_outcomes'],
  },
  {
    id: 'tool-handoffs',
    name: 'tool handoffs',
    description: 'Files that move between different tools',
    category: 'tools',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['tool_handoffs'],
  },
  {
    id: 'tool-calls',
    name: 'tool calls',
    description: 'Total calls, error rate, research-to-edit ratio',
    category: 'tools',
    scope: 'both',
    viz: 'stat-row',
    w: 6,
    h: 2,
    minW: 4,
    minH: 2,
    dataKeys: ['tool_call_stats'],
  },
  {
    id: 'tool-call-freq',
    name: 'tool call frequency',
    description: 'Most-invoked tools with error rates',
    category: 'tools',
    scope: 'both',
    viz: 'bar-chart',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['tool_call_stats'],
  },
  {
    id: 'tool-call-errors',
    name: 'tool call errors',
    description: 'Common error patterns across tools',
    category: 'tools',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['tool_call_stats'],
  },
  {
    id: 'token-detail',
    name: 'token usage',
    description: 'Token consumption by model and tool',
    category: 'tools',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['token_usage'],
  },
  {
    id: 'tool-daily',
    name: 'tool adoption',
    description: 'Daily session volume per tool — adoption and migration over time',
    category: 'tools',
    scope: 'both',
    viz: 'multi-sparkline',
    w: 8,
    h: 4,
    minW: 6,
    minH: 3,
    dataKeys: ['tool_daily'],
  },
  {
    id: 'tool-work-type',
    name: 'tool work mix',
    description: 'What kind of work each tool handles',
    category: 'tools',
    scope: 'both',
    viz: 'proportional-bar',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['tool_work_type'],
  },
  {
    id: 'data-coverage',
    name: 'data coverage',
    description: 'Which insight categories have data and which are waiting',
    category: 'tools',
    scope: 'both',
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
    name: 'outcomes by sentiment',
    description: 'How conversation sentiment correlates with session success',
    category: 'conversations',
    scope: 'both',
    viz: 'bar-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['conversation'],
  },
  {
    id: 'conversation-depth',
    name: 'conversation depth',
    description: 'How conversation length affects edit output',
    category: 'conversations',
    scope: 'both',
    viz: 'bucket-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['conversation_edit_correlation'],
  },
  // ── Memory (extended) ───────────────
  {
    id: 'memory-outcomes',
    name: 'outcomes by memory',
    description: 'How memory usage correlates with session success',
    category: 'memory',
    scope: 'both',
    viz: 'bar-chart',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['memory_outcome_correlation'],
  },
  {
    id: 'top-memories',
    name: 'top memories',
    description: 'Most-accessed shared memories',
    category: 'memory',
    scope: 'both',
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
    name: 'conflict impact',
    description: 'How conflicts affect session completion',
    category: 'team',
    scope: 'both',
    viz: 'stat-row',
    w: 6,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['conflict_correlation'],
  },
  {
    id: 'retry-patterns',
    name: 'recurring failures',
    description: 'Files edited repeatedly across failed sessions',
    category: 'team',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['retry_patterns'],
  },
  {
    id: 'file-overlap',
    name: 'file overlap',
    description: 'Share of files touched by more than one agent',
    category: 'team',
    scope: 'both',
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
  { id: 'live', label: 'live' },
  { id: 'usage', label: 'usage' },
  { id: 'outcomes', label: 'outcomes' },
  { id: 'activity', label: 'activity' },
  { id: 'codebase', label: 'codebase' },
  { id: 'tools', label: 'tools & models' },
  { id: 'conversations', label: 'conversations' },
  { id: 'memory', label: 'memory' },
  { id: 'team', label: 'team' },
];

// ── Default layout for new users ────────────────
// x/y positions on the 12-column grid

export const DEFAULT_LAYOUT: RGLLayout[] = [
  // Row 0: Live presence table (full width)
  { i: 'live-agents', x: 0, y: 0, w: 12, h: 3 },

  // Row 3: KPI stats — edits, cost, cost-per-edit (4-col each)
  { i: 'edits', x: 0, y: 3, w: 4, h: 2 },
  { i: 'cost', x: 4, y: 3, w: 4, h: 2 },
  { i: 'cost-per-edit', x: 8, y: 3, w: 4, h: 2 },

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
