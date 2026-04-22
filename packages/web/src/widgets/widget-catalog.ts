/**
 * Widget catalog: every data point that can appear on the overview.
 *
 * 12-column CSS Grid. Each widget declares `w` (columns it spans: 3/4/6/8/12)
 * and `h` (80px row units it spans: 2/3/4). Rows auto-fit via
 * grid-auto-flow:row so staggering is structurally impossible — short
 * widgets align at the top of their row and tall ones extend downward.
 *
 * Sizes:
 *   KPI stat card:    3 cols × 2 rows  (quarter width, compact)
 *   Enriched stat:    4 cols × 2 rows  (third width)
 *   Half chart:       6 cols × 3 rows  (half width, standard chart)
 *   Wide chart:       8 cols × 3 rows  (two-thirds)
 *   Full-width:      12 cols × 3 rows  (tables, timelines)
 *   Tall full-width: 12 cols × 4 rows  (heatmap, large viz)
 */

export type WidgetColSpan = 3 | 4 | 6 | 8 | 12;
export type WidgetRowSpan = 2 | 3 | 4;

/**
 * Layout slot persisted in localStorage. `colSpan` maps to grid-column:span,
 * `rowSpan` to grid-row:span. The grid is 12-column with 80px row units and
 * 24px gaps, so a rowSpan of 2 paints a 184px cell, 3 = 288px, 4 = 392px.
 */
export interface WidgetSlot {
  id: string;
  colSpan: WidgetColSpan;
  rowSpan: WidgetRowSpan;
}

function clampColSpan(n: number): WidgetColSpan {
  if (n <= 3) return 3;
  if (n === 4) return 4;
  if (n <= 6) return 6;
  if (n <= 8) return 8;
  return 12;
}

function clampRowSpan(n: number): WidgetRowSpan {
  if (n <= 2) return 2;
  if (n === 3) return 3;
  return 4;
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
 * Time-semantics bucket. Drives whether a widget responds to the global date
 * picker and what label (if any) appears in its header.
 *
 *   'period'   — every number responds to the picker (default, most widgets)
 *   'live'     — real-time snapshot, picker does not apply
 *   'all-time' — lifetime values, picker does not apply
 *
 * Rule: a widget is exactly one scope. If a design needs mixed scopes, split
 * into two widgets so users can tell which numbers the picker controls.
 * See .internal/OVERVIEW_ARCH.md item #1.
 */
export type WidgetTimeScope = 'period' | 'live' | 'all-time';

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
  /**
   * Time-semantics scope. Omit for the default ('period') — only set
   * explicitly for 'live' or 'all-time' widgets. See WidgetTimeScope.
   */
  timeScope?: WidgetTimeScope;
  /**
   * When true, the widget renders at its content's natural height, up to
   * the declared `h` rowSpan. WidgetGrid measures content via ResizeObserver
   * and compresses the grid-row assignment so sparse widgets don't reserve
   * empty vertical space. When content exceeds the cap, the widget body
   * scrolls. Opt-in because mixed fit + fixed widgets in the same visual
   * row may create minor y-misalignment — best reserved for widgets that
   * are commonly sparse (live presence, list overflow) rather than charts
   * with intrinsic proportions.
   */
  fitContent?: boolean;
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
    w: 6,
    h: 4,
    minW: 4,
    minH: 2,
    dataKeys: ['dashboard'],
    timeScope: 'live',
    fitContent: true,
  },
  {
    id: 'live-conflicts',
    name: 'live conflicts',
    description: 'Files being edited by more than one agent right now',
    category: 'live',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['dashboard'],
    timeScope: 'live',
    fitContent: true,
  },
  {
    id: 'files-in-play',
    name: 'files being edited',
    description: 'Files currently being edited',
    category: 'live',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['dashboard'],
    timeScope: 'live',
    fitContent: true,
  },
  {
    id: 'claimed-files',
    name: 'claimed files',
    description: 'Files reserved by agents via chinwag_claim_files',
    category: 'live',
    scope: 'project',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['dashboard'],
    timeScope: 'live',
    fitContent: true,
  },

  // ── Usage (KPI stats) ─────────────────
  {
    id: 'sessions',
    name: 'sessions',
    description:
      'Scalar session count with period delta. Canonical anchor for the session dimension.',
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
    description: 'How much of each prompt is reused from cache instead of re-sent to the model',
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
    fitContent: true,
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
    fitContent: true,
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
    fitContent: true,
  },
  {
    id: 'outcome-trend',
    name: 'completion rate trend',
    description: 'Daily completion rate over time',
    category: 'outcomes',
    scope: 'both',
    viz: 'sparkline',
    w: 8,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['daily_trends'],
    fitContent: true,
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
    fitContent: true,
  },

  // ── Codebase ──────────────────────────
  {
    id: 'commit-stats',
    name: 'commits',
    description: 'Hook-captured commits from agent sessions, rolled up across tools',
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
    description: 'Top 10 directories by touch count, with per-directory completion rate',
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
    description: 'Top 10 files by touch count, with completion rate and line changes',
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
    description: 'AI tools in use, with sessions, edits, and how much data each tool captures',
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
    description: 'Which models your agents use, split by the tool that ran them',
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
    description:
      'What your prompts are about. Classified from conversation content, so it tracks intent (what you asked for) — not code changes (what landed).',
    category: 'conversations',
    scope: 'both',
    viz: 'topic-bars',
    w: 4,
    h: 3,
    minW: 3,
    minH: 2,
    dataKeys: ['conversation'],
    fitContent: true,
  },

  // ── Memory ────────────────────────────
  {
    id: 'memory-activity',
    name: 'memory activity',
    description: 'Searches, hit rate, and new memories this period',
    category: 'memory',
    scope: 'both',
    viz: 'stat-row',
    w: 6,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['memory_usage'],
  },
  {
    id: 'memory-health',
    name: 'memory health',
    description: 'Total memories, average age, and stale count across all time',
    category: 'memory',
    scope: 'both',
    viz: 'stat-row',
    w: 6,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['memory_usage'],
    timeScope: 'all-time',
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
    description: 'Recent activity and tool mix across your projects',
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
    description: 'Back-and-forth turns per edit over time — lower means fewer messages per change',
    category: 'activity',
    scope: 'both',
    viz: 'sparkline',
    w: 8,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['prompt_efficiency'],
    fitContent: true,
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
    description: 'Top 10 files by session spread — persistent work across separate sessions',
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
    description: 'Top 10 files by failed-edit ratio — candidates for refactor or review',
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
    name: 'cold directories',
    description:
      'Directories that went cold in this period (14+ days since last touch) — ownership gaps and pruning candidates',
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
    description: 'Top 10 files touched by multiple agents this period — coordination hotspots',
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
    description:
      'How often agents call tools, how often calls fail, and how much they read before editing',
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
    description:
      'Which underlying tools agents call most (Edit, Read, Grep, MCP tools) and how often they error',
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
    description: 'Recurring errors when agents run tools, grouped by tool and error message',
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
    fitContent: true,
  },
  {
    id: 'data-coverage',
    name: 'data coverage',
    description: 'Which analytics have real data yet and what to do to light up the rest',
    category: 'tools',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['data_coverage'],
    timeScope: 'live',
    fitContent: true,
  },

  // ── Conversations (extended) ────────
  {
    id: 'prompt-clarity',
    name: 'prompt clarity',
    description:
      'How phrasing quality correlates with session outcomes. Re-asks and confused prompts often mean the agent needs more memory or scope.',
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
    description:
      'Edit output and completion rate bucketed by session turn count. Snapshot view of the current period — see prompt-efficiency for the same axis trended over time.',
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
  {
    id: 'memory-safety',
    name: 'memory safety',
    description: 'Review queue: proposals, auditor flags, and secrets blocks needing attention',
    category: 'memory',
    scope: 'both',
    viz: 'stat-row',
    w: 6,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['memory_usage'],
    timeScope: 'live',
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
    id: 'conflicts-blocked',
    name: 'conflicts blocked',
    description: 'Edits the PreToolUse hook prevented this period',
    category: 'team',
    scope: 'both',
    viz: 'stat-row',
    w: 4,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['conflict_stats'],
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
  'live-list': { maxW: 12, maxH: 4 },
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

/**
 * Resolve a widget's default column span for the CSS Grid layout. Maps the
 * catalog's `w` (RGL grid units) to one of the canonical spans 3/4/6/8/12.
 * Used by views that render widgets via grid-column:span.
 */
export function widgetColSpan(def: WidgetDef): WidgetColSpan {
  return clampColSpan(def.w);
}

/**
 * Resolve a widget's default row span for the CSS Grid layout. Maps the
 * catalog's `h` (80px units) to one of 2/3/4 row spans.
 */
export function widgetRowSpan(def: WidgetDef): WidgetRowSpan {
  return clampRowSpan(def.h);
}

/**
 * Build a WidgetSlot for an id using catalog defaults. Returns null when the
 * id isn't in the catalog.
 */
export function defaultSlot(id: string): WidgetSlot | null {
  const def = getWidget(id);
  if (!def) return null;
  return { id, colSpan: widgetColSpan(def), rowSpan: widgetRowSpan(def) };
}

/**
 * ID aliases for widgets that have been renamed, removed, or split. When a
 * saved layout contains a deprecated ID, the loader replaces it in place
 * with the target IDs at their catalog default sizes.
 *
 * Empty array means "the widget was removed with no replacement" — the slot
 * is dropped from the layout.
 *
 * Single-entry array = rename. Multi-entry array = split.
 */
export const WIDGET_ALIASES: Record<string, string[]> = {
  // 2026-04: memory-stats mixed period + lifetime fields. Split so each
  // widget has one clear time scope. See .internal/OVERVIEW_ARCH.md item #1.
  'memory-stats': ['memory-activity', 'memory-health'],
  // 2026-04: sentiment-outcomes reframed as prompt-clarity. Same data (the
  // classifier still produces sentiment classes) under a coordination-oriented
  // frame: "which prompt phrasings stall sessions" instead of "your mood vs
  // your outcomes." See .internal/WIDGET_RUBRIC.md E4.
  'sentiment-outcomes': ['prompt-clarity'],
  // 2026-04-21: formation-summary cut. Duplicated memory-safety's
  // auditor-flagged count in chart form (B2) and failed C1 — the bar chart
  // rendered a minority subset (actionable flags) as if it were the whole.
  // The merge/evolve/discard breakdown belongs in the review drill, not
  // the cockpit.
  'formation-summary': [],
};

/**
 * Resolve a widget id through the alias map. Returns the replacement ids
 * (one or many), or the original id if it has no alias. Does not validate
 * that the returned ids exist in the catalog — callers still need to run
 * through `defaultSlot` or `getWidget`.
 */
export function resolveWidgetAlias(id: string): string[] {
  return WIDGET_ALIASES[id] ?? [id];
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
// Ordered widget slots on the 12-col CSS Grid. Widgets pack via
// grid-auto-flow:row so the visual rhythm below depends only on the
// (colSpan, rowSpan) sum per row totalling 12 cols.

export const DEFAULT_LAYOUT: WidgetSlot[] = [
  // Live presence + conflicts — 6 + 6. live-agents at rowSpan 4 so 8
  // agents (LIVE_AGENTS_CAP) fit simultaneously without overflow clipping;
  // fitContent compresses back down for smaller teams.
  { id: 'live-agents', colSpan: 6, rowSpan: 4 },
  { id: 'live-conflicts', colSpan: 6, rowSpan: 3 },

  // KPI strip — 3 × 4. Four stats at their natural 3-col size so the row
  // reads as a tab-selector group candidate (design-language pattern: stat
  // values double as tab triggers, active = full ink, inactive = --soft).
  // one-shot-rate earned default placement 2026-04-22 after the outcomes
  // sweep: CodeBurn's killer metric, honest CoverageNote empty state for
  // non-hook tools, and coverage grows only when the metric is visible.
  { id: 'edits', colSpan: 3, rowSpan: 2 },
  { id: 'cost', colSpan: 3, rowSpan: 2 },
  { id: 'cost-per-edit', colSpan: 3, rowSpan: 2 },
  { id: 'one-shot-rate', colSpan: 3, rowSpan: 2 },

  // Trend chart + outcomes — 8 + 4
  { id: 'session-trend', colSpan: 8, rowSpan: 3 },
  { id: 'outcomes', colSpan: 4, rowSpan: 3 },

  // Heatmap + work types — 8 + 4
  { id: 'heatmap', colSpan: 8, rowSpan: 4 },
  { id: 'work-types', colSpan: 4, rowSpan: 3 },

  // Codebase — 6 + 6
  { id: 'directories', colSpan: 6, rowSpan: 4 },
  { id: 'files', colSpan: 6, rowSpan: 4 },

  // Codebase deep — promoted 2026-04-21 after rubric pass.
  // commit-stats earned cross-tool coverage when the Cursor/Windsurf hook
  // handlers shipped 2026-04-17, so the old Claude-Code-only gating that
  // justified catalog-only in ANALYTICS_SPEC §5.6 is stale. file-rework
  // has the highest B3 in the category — drives "open this file, review"
  // directly, per the rubric challenger pass. Full-width to match the
  // airy stat-strip pattern used elsewhere in the default layout.
  { id: 'commit-stats', colSpan: 12, rowSpan: 2 },
  { id: 'file-rework', colSpan: 12, rowSpan: 4 },

  // Tools + models — 6 + 6
  { id: 'tools', colSpan: 6, rowSpan: 3 },
  { id: 'models', colSpan: 6, rowSpan: 3 },

  // Cross-tool handoffs — full-width. Substrate-unique (no IDE can show
  // "Cursor started this file, Claude Code finished it"), so it earns
  // default placement alongside the tools/models row.
  { id: 'tool-handoffs', colSpan: 12, rowSpan: 3 },

  // Memory correlation + stuckness — 8 + 4. memory-outcomes is the
  // strongest D1 memory widget: completion rate bucketed by whether the
  // session hit shared memory. Promoted from catalog-only in the
  // 2026-04-21 memory audit; memory-activity and memory-health were
  // demoted (raw search counts + abstract avg-age don't earn a cockpit
  // slot without a stale-list companion).
  { id: 'memory-outcomes', colSpan: 8, rowSpan: 3 },
  { id: 'stuckness', colSpan: 4, rowSpan: 2 },

  // Projects — 12
  { id: 'projects', colSpan: 12, rowSpan: 3 },
];

export const DEFAULT_WIDGET_IDS = DEFAULT_LAYOUT.map((s) => s.id);
