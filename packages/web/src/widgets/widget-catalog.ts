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
    description: 'Files reserved by agents via chinmeister_claim_files',
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
  // ── Trends (sparklines) ───────────────
  // `session-trend` and `edit-velocity` were both cut 2026-04-25 after
  // the widget-rubric agent-team pass on the Usage Trends category.
  // session-trend failed A3 (zero-fill renders fake shape), B2 (subset
  // of the outcomes widget on the same row), and D1 (session count is
  // the most generic agent-tool metric going). edit-velocity was the
  // closer call — Challenger argued keep-catalog under Option B — but
  // followed when the question "are we actually building a detail
  // surface for it" came up: the only substrate-honest detail Q
  // (velocity → completion) is a Simpson's-paradox trap (fast=small
  // fixes, slow=deep refactors) flagged by ANALYTICS_SPEC §10, and
  // STRATEGY.md explicitly names raw-volume metrics as getting LESS
  // valuable as agents become more autonomous. Both alias to [] for
  // saved-layout migration. The underlying `edit_velocity` and
  // `daily_trends` fields stay in the schema — UsageDetail's `cadence`
  // and `peak` questions still consume them as scalars.

  // ── Outcomes ──────────────────────────
  {
    id: 'outcomes',
    name: 'outcomes',
    description: 'Finished, abandoned, and failed sessions',
    category: 'outcomes',
    scope: 'both',
    viz: 'outcome-bar',
    // Widened from 4×3 to 8×3 on 2026-04-24 after the viz became a
    // hero-stat + 5-column table (OUTCOME / COUNT / SHARE bar /
    // DELTA / TREND sparkline). The old 4-col slot clipped labels
    // and forced the table into a narrow column. The table needs
    // the 8-col width to breathe — share bars become legible, per-
    // outcome trend sparklines fit, drill arrows have room.
    w: 8,
    h: 3,
    minW: 6,
    minH: 2,
    maxW: 12,
    dataKeys: ['completion_summary'],
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
    // viz: 'stat' so the hero value uses --display-hero like one-shot-rate,
    // edits, cost, cost-per-edit — every KPI-shape widget in the system
    // renders at the same typography tier. The ratio + recovered% live in
    // the CoverageNote caption slot so they're visible without stealing
    // the hero tier. Changed from 'stat-row' on 2026-04-24 when the
    // 3-block layout read as "random smaller typography" next to the
    // hero-sized peers above it in the layout.
    viz: 'stat',
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
    description: 'Share of edits by category — frontend, backend, test, docs, etc.',
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

  // ── Projects ──────────────────────────
  {
    id: 'projects',
    name: 'projects',
    description:
      'Cross-project comparator: tool mix, 7-day activity, shared memory growth, conflict trend',
    category: 'usage',
    scope: 'overview',
    viz: 'project-list',
    // 8-col default (down from 12 on the 2026-04-22 redesign): the table now
    // has 6 fixed-track columns + a View pill, so a half-to-two-thirds tile
    // matches the live-agents/live-conflicts density precedent. Users can
    // still resize down to 6 or up to 12 from the customize panel.
    w: 8,
    h: 3,
    minW: 6,
    minH: 2,
    // Same opt-in as live-agents et al: WidgetGrid's useFitRowSpan measures
    // the table's scrollHeight and shrinks the cell's grid-row span to the
    // minimum needed (clamped at h:3 as ceiling). A single-project user
    // sees a 1-row tall cell instead of 3 rows of empty space; a
    // many-project user gets the full 3 rows + scroll inside the body.
    fitContent: true,
    dataKeys: ['dashboard'],
  },

  // ── Outcomes (extended) ─────────────
  // Note: `first-edit` and `duration-dist` were cut 2026-04-24 per the
  // Widget-Detail Precedent (WIDGET_RUBRIC.md § Widget ↔ Detail-View
  // Disposition). Both duplicated data that already lives in Usage
  // detail's Sessions panel — first-edit as the "first edit lands at
  // X min" lead-in, duration-dist as the DurationStrip. Detail-only is
  // the honest home when a metric only earns its seat in context.
  // duration-dist carried an additional concern: the histogram shape
  // invited the "optimal session length" read named as a never-build
  // anti-pattern in ANALYTICS_SPEC § 10.
  {
    id: 'scope-complexity',
    name: 'completion by scope',
    description: 'Completion rate bucketed by files touched per session',
    category: 'outcomes',
    scope: 'both',
    viz: 'bucket-chart',
    w: 8,
    h: 3,
    minW: 6,
    minH: 2,
    dataKeys: ['scope_complexity'],
  },

  // ── Codebase (extended) ─────────────
  {
    id: 'file-rework',
    name: 'files in failed sessions',
    description:
      "Top 10 files where edits often land inside sessions that end abandoned or failed. Percentage is the share of this file's edits attached to failing sessions — high values flag files that recur in sessions that don't complete, not necessarily that the edits themselves were broken.",
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
      'Directories with prior activity but no touches in 14+ days — ownership gaps and pruning candidates',
    category: 'codebase',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['audit_staleness'],
    timeScope: 'all-time',
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
  // ── Conversations (revived 2026-04-25) ──
  // Two file-axis widgets that use sentiment/topic as INPUTS to coordination
  // questions, not as the headline metric — the framing ANALYTICS_SPEC §10
  // anti-pattern #1 explicitly endorses ("use as input to Failure Analysis,
  // never alone"). Both gate on conversationLogs capability (Claude Code +
  // Aider today). See WIDGET_RUBRIC.md change log entry 2026-04-25 for the
  // generative pass that revived this category from 0 widgets to 2.
  {
    id: 'confused-files',
    name: 'files where the agent struggled',
    description:
      'Files where 2+ sessions had user messages classified confused or frustrated. Surfaces the file (a coordination axis), not the sentiment — sentiment is the input that ranks files. Read these files alongside their memories before editing; consider a stronger model for confused regions.',
    category: 'conversations',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['confused_files'],
  },
  {
    id: 'unanswered-questions',
    name: 'questions in abandoned sessions',
    description:
      "Count of user messages classified as questions inside sessions that ended abandoned — intent the agent couldn't fulfill. A navigation aid: open these sessions to see what was asked, then save the context as a memory or spawn a clarifying session.",
    category: 'conversations',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['unanswered_questions'],
  },

  // ── Memory (extended) ───────────────
  // Memory category density additions 2026-04-25. Each anchors a 4-5
  // question detail view (see body file doc-comments for the English
  // questions). Catalog-only at default sizes; promote individual widgets
  // to default after MemoryDetailView pattern lands.
  {
    id: 'memory-cross-tool-flow',
    name: 'memory across tools',
    description:
      "Memories authored by one tool that are available to another tool's sessions in the period. Honest framing: this measures co-presence and the available pool, not exact read attribution. Anchors questions like which tools share knowledge, which categories cross tools, and whether cross-tool memory tracks completion.",
    category: 'memory',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['cross_tool_memory_flow'],
  },
  {
    id: 'memory-aging-curve',
    name: 'memory freshness',
    description:
      'Currently-live memories grouped by age: 0-7d, 8-30d, 31-90d, 90d+. Lifetime scope; the date picker does not apply. Anchors questions like which categories age fastest, whether the team is replacing or accumulating, and which directories carry the freshest knowledge.',
    category: 'memory',
    scope: 'both',
    viz: 'proportional-bar',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['memory_aging'],
    timeScope: 'all-time',
    fitContent: true,
  },
  {
    id: 'memory-categories',
    name: 'knowledge categories',
    description:
      'Top agent-assigned categories on currently-live memories with last-touch hint. Empty until agents tag memories on save. Anchors questions like which categories help completion, which directories carry which knowledge, and how the mix shifts over time.',
    category: 'memory',
    scope: 'both',
    viz: 'bar-chart',
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    dataKeys: ['memory_categories'],
  },
  // Memory + team revivals + density 2026-04-25 (post 18-month re-audit).
  {
    id: 'memory-health',
    name: 'memory health',
    description:
      "Lifetime steady-state of the team's living memory: total live count, average age, stale count. All-time scope; the date picker does not apply. Anchors questions like the live-vs-invalidated trend, formation-observation rate, hygiene-action backlog, per-category live count, and last-touched age distribution.",
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
  {
    id: 'memory-bus-factor',
    name: 'single-author directories',
    description:
      'Directories where memories cluster on one author. Surface is directory-axis, never names handles, so it shows concentration risk without surveillance. Anchors questions like which directories carry single-author knowledge, period delta on concentration, second-author resilience trend, concentrated dirs by traffic, and team-wide authorship spread.',
    category: 'memory',
    scope: 'both',
    viz: 'data-list',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    dataKeys: ['memory_single_author_directories'],
  },
  {
    id: 'memory-supersession-flow',
    name: 'memory supersession',
    description:
      'Live counters for the consolidation pipeline: memories invalidated this period, memories merged, proposals pending review. Quiet today; load-bearing once Memory Hygiene Autopilot runs on cadence. Anchors questions like retired vs merged this period, queue depth and age, categories with most supersession, merge clustering by directory, and median memory lifespan.',
    category: 'memory',
    scope: 'both',
    viz: 'stat-row',
    w: 6,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['memory_supersession'],
    timeScope: 'live',
  },
  {
    id: 'memory-secrets-shield',
    name: 'secrets blocked',
    description:
      'Secret writes the shield caught before they reached shared memory. Substrate-unique: only chinmeister sees cross-tool memory writes, so this is the security signal no IDE or generic DLP produces. Anchors questions like how many leak attempts, which tools tried, trend, patterns caught most, and false-positive cost.',
    category: 'memory',
    scope: 'both',
    viz: 'stat-row',
    w: 4,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['memory_secrets_shield'],
  },
  {
    id: 'hourly-effectiveness',
    name: 'completion rate by hour',
    description:
      'Cross-tool, cross-agent completion rate by hour of day. The slice fix from the original cut: top hours by volume not clock order, so the rendered set is the high-traffic window. Anchors questions like the volume-vs-rate split, by-tool curve differences, work-type dependence, day-of-week dips, and off-hour failure attribution.',
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
    id: 'file-overlap',
    name: 'file overlap',
    description:
      "Share of files this period that multiple agents touched. Surfaces the team-overlap scalar that no IDE produces. Solo users see an honest 'requires 2+ agents' empty state — the populated branch is gated on team_size > 1. Anchors questions like overlap rate by directory, period trend, average agents-per-file in the overlap subset, claim coverage of overlap files, and tool-pair contribution.",
    category: 'team',
    scope: 'both',
    viz: 'stat-row',
    w: 4,
    h: 2,
    minW: 3,
    minH: 2,
    dataKeys: ['file_overlap'],
  },

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
  // top-memories revived 2026-04-25 after the rubric bar shifted to "anchors
  // a multi-question detail view." Click target opens MemoryDetailView when
  // that surface ships; meanwhile the row preview is the read.
  {
    id: 'top-memories',
    name: 'most-read memories',
    description:
      "Memories the team relies on most, ranked by access count with last-touch hint. Anchors questions like which memories never get read, which categories dominate the team's hot path, and how memory composition shifts over time.",
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
  // 2026-04-21: formation-summary cut. Duplicated memory-safety's
  // auditor-flagged count in chart form (B2) and failed C1 — the bar chart
  // rendered a minority subset (actionable flags) as if it were the whole.
  // The merge/evolve/discard breakdown belongs in the review drill, not
  // the cockpit.
  'formation-summary': [],
  // 2026-04-24: first-edit + duration-dist cut per the Widget-Detail
  // Precedent. Both already render in the Usage detail Sessions panel
  // (first-edit as a lead-in fact, duration-dist as the DurationStrip).
  // Detail-only is the honest home when a metric only earns its seat
  // in context. duration-dist additionally invited the "optimal session
  // length" read flagged as a never-build anti-pattern in
  // ANALYTICS_SPEC § 10. Empty array = drop the slot from any saved
  // layout on next load.
  'first-edit': [],
  'duration-dist': [],
  // 2026-04-24: session-trend cut. Detail view's DailyOutcomeStrip +
  // the same-row outcomes widget already own the signal with more
  // context, and the zero-fill spine rendered fake shape for low-
  // activity users. Saved layouts drop the slot on next load.
  'session-trend': [],
  // 2026-04-25: edit-velocity cut. No detail-view future earns the
  // build cost — only substrate-honest question (velocity → completion)
  // is a Simpson's-paradox trap, and edits/hr is a generic metric any
  // tool's own dashboard produces. Schema field `edit_velocity` stays
  // for UsageDetail's `cadence` scalar consumers.
  'edit-velocity': [],

  // 2026-04-25: agent-team audit pass on activity → end of catalog.
  // 22 widgets cut across activity, codebase, tools, conversations,
  // memory, and team categories. See WIDGET_RUBRIC.md change log entry
  // for 2026-04-25 (activity → team sweep). Schema fields stay; some
  // surfaces re-emerge as Reports inputs or detail-view facets.

  // Activity cuts. prompt-efficiency rides the same Simpson's-paradox
  // trap that cut edit-velocity (turns ↔ outcome). work-type-outcomes
  // is fully absorbed into OutcomesDetailView's WorkTypesPanel as a
  // facet (Option C detail-only per Widget-Detail Disposition).
  // hourly-effectiveness was revived 2026-04-25 (post 18-month re-audit)
  // with the slice-by-volume fix.
  'prompt-efficiency': [],
  'work-type-outcomes': [],

  // Codebase cuts. file-churn duplicates files in practice (different
  // aggregation primitive, same ranking), and triple-volume-metric row
  // invites the "high-on-all = bad" anti-pattern read.
  'file-churn': [],

  // Tools cuts (7). tool-outcomes B2-redundant with the `tools` factual
  // grid (which already shows completion%). cache-efficiency is plumbing
  // observability with no user control surface (B3 zero). tool-daily
  // rides the same zero-fill A3 failure that cut session-trend. tool-
  // work-type carries a broken denominator (sessions in multiple work
  // types double-counted) plus STRATEGY's "per-tool distribution as pie"
  // anti-pattern. tool-calls has polysemous "calls" semantics across
  // hook-instrumented vs MCP-only hosts. tool-call-freq is pure
  // frequency without effectiveness overlay (STRATEGY line 139). data-
  // coverage is plumbing diagnostic with negative emotional payload —
  // belongs on a Connect/Settings surface, not the cockpit.
  'tool-outcomes': [],
  'cache-efficiency': [],
  'tool-daily': [],
  'tool-work-type': [],
  'tool-calls': [],
  'tool-call-freq': [],
  'data-coverage': [],

  // Conversations cuts (3 of 3 from the original category). The category
  // dissolved on 2026-04-25 then revived the same day with two new file-
  // axis widgets (confused-files, unanswered-questions) that surface FILES
  // with sentiment/topic as inputs — the framing §10 #1 explicitly
  // endorses. These three originals stay cut because each independently
  // violated §10:
  //   topics — B2 with work-types (different signal, near-identical
  //     output buckets); D1 weak (every LLM-obs tool ships it).
  //   prompt-clarity — rename was lipstick; classifier still emits
  //     sentiment polarity; §10 #1 ("sentiment-to-outcome standalone")
  //     still applies.
  //   conversation-depth — Simpson's-paradox trap (longer sessions =
  //     harder tasks), same family as the edit-velocity cut.
  topics: [],
  'prompt-clarity': [],
  'conversation-depth': [],
  // 2026-04-25: chains updated. Both replacement targets (memory-
  // activity, memory-health, prompt-clarity) are now cut, so the
  // historical aliases drop their slots entirely.
  'memory-stats': [],
  'sentiment-outcomes': [],

  // Memory cuts (2 of 5 stay cut after the 2026-04-25 re-audit). memory-
  // activity rendered search hit rate (ANALYTICS_SPEC §10 #7 anti-pattern,
  // evergreen). memory-safety stays cut for now — the data is shipped via
  // memory-supersession-flow + memory-secrets-shield (the supersession +
  // secrets components of safety surface as their own widgets), and the
  // remaining auditor-flag piece pre-empts Memory Hygiene Autopilot Report.
  // memory-health, top-memories were revived; memory-outcomes was demoted
  // to catalog-only (will restore to default once memory_search_results
  // join lands).
  'memory-activity': [],
  'memory-safety': [],

  // Team cuts (4 of 5; only conflicts-blocked survives — substrate-
  // unique prevention proof). team-members triggers ANALYTICS_SPEC §10
  // #4 explicit anti-pattern ("agent productivity rankings across team
  // members — surveillance, not intelligence"); also pre-empts
  // STRATEGY § Privacy model which is unbuilt. conflict-impact rides
  // Simpson's paradox (sessions hitting conflicts are also harder
  // sessions) — the disclaimer line is theater in a stat-row that
  // reads causally by construction. retry-patterns is B2-redundant
  // with file-rework (same axis, different aggregation primitive — the
  // cross-agent + cross-tool columns belong as a footer line on file-
  // rework). file-overlap was revived 2026-04-25 (post 18-month re-audit)
  // after the populated branch was gated on team_size > 1 — the original
  // A3 lie was a renderer bug, not a structural rubric failure.
  'team-members': [],
  'conflict-impact': [],
  'retry-patterns': [],
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

  // Outcomes — 8×3. Stands alone on its row after `session-trend` was
  // cut 2026-04-24 (see catalog Trends block). No forced backfill — the
  // grid is modular, users add other widgets via the picker if they want
  // the leftover 4 cols filled.
  { id: 'outcomes', colSpan: 8, rowSpan: 3 },

  // Heatmap + work types — 8 + 4
  { id: 'heatmap', colSpan: 8, rowSpan: 4 },
  { id: 'work-types', colSpan: 4, rowSpan: 3 },

  // Codebase — directories + files. `directories` returned to default 2026-
  // 04-25 after the 18-month re-audit. The original demotion was a today-
  // state argument (renderer wasn't painting completion_rate); rendering it
  // is a one-day component change and the substrate-unique angle (per-
  // directory completion rate weighted by agent-session outcomes) is the
  // strongest D1 in the codebase category. Now renders completion_rate
  // colored by severity, with MoreHidden tail past top-10 and a hooks-
  // capability CoverageNote.
  { id: 'directories', colSpan: 6, rowSpan: 4 },
  { id: 'files', colSpan: 6, rowSpan: 4 },

  // Codebase deep — promoted 2026-04-21 after rubric pass.
  // commit-stats earned cross-tool coverage when the Cursor/Windsurf hook
  // handlers shipped 2026-04-17, so the old Claude-Code-only gating that
  // justified catalog-only in ANALYTICS_SPEC §5.6 is stale. file-rework
  // has the highest B3 in the category — drives "open this file, review"
  // directly. Full-width to match the airy stat-strip pattern used
  // elsewhere in the default layout.
  // NOTE: file-rework's "rework_ratio" label/math mismatch is queued for
  // pre-UI rework — see audit verdicts (rename or fold into files).
  { id: 'commit-stats', colSpan: 12, rowSpan: 2 },
  { id: 'file-rework', colSpan: 12, rowSpan: 4 },

  // Tools — `models` was demoted to catalog-only 2026-04-25 after the
  // agent-team audit. ANALYTICS_SPEC §10 anti-pattern #5 ("raw Model A > B
  // without scope control") + STRATEGY explicit demotion of model/tool
  // routing recommendations from headline Autopilot to passive insight.
  // Per-tool pill is partial mitigation only; needs a work-type filter
  // affordance before re-promotion.
  { id: 'tools', colSpan: 6, rowSpan: 3 },

  // Cross-tool handoffs — full-width. Substrate-unique (no IDE can show
  // "Cursor started this file, Claude Code finished it"), so it earns
  // default placement. Capture-latency (ANALYTICS_SPEC Open Work line 13)
  // can invert directionality today — gate on that pipeline fix.
  { id: 'tool-handoffs', colSpan: 12, rowSpan: 3 },

  // memory-outcomes was demoted to catalog-only 2026-04-25 after the
  // agent-team audit. The 3-bucket session-grain proxy is honest about what
  // it measures but is NOT the per-memory-attribution surface ANALYTICS_SPEC
  // §10 promised — the `memory_search_results` join table is unshipped.
  // At full-width with single-bucket cases unguarded, the widget can render
  // a lonely strip. Demoted to 6×3 catalog default; earns default again
  // when the join table lands AND a min-bucket guard is added.

  // Projects + stuckness — 8 + 4. Projects shrank from 12→8 on 2026-04-22
  // (the comparator-table redesign doesn't earn full width), opening room
  // for stuckness as its row partner. Bottom-row pairing keeps the layout
  // total at 12 per row and avoids leaving empty grid space.
  { id: 'projects', colSpan: 8, rowSpan: 3 },
  { id: 'stuckness', colSpan: 4, rowSpan: 2 },
];

export const DEFAULT_WIDGET_IDS = DEFAULT_LAYOUT.map((s) => s.id);
