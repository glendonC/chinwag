import type {
  ConversationAnalytics,
  DailyTrend,
  HourlyBucket,
  UserAnalytics,
} from '../lib/apiSchemas.js';
import { getDataCapabilities } from '@chinmeister/shared/tool-registry.js';

// ── Work types ────────────────────────────────────

// Canonical work-type categories. Matches the SQL WORK_TYPE_CASE and
// classifyWorkType() classifier in packages/worker/src/dos/team/analytics/outcomes.ts —
// any change here requires a migration on the worker side.
export const WORK_TYPES = [
  'frontend',
  'backend',
  'styling',
  'test',
  'docs',
  'config',
  'other',
] as const;
export type WorkType = (typeof WORK_TYPES)[number];

// Work-type palette. Values are CSS custom-property references declared
// in styles/tokens.css — they alias the app's semantic tokens so dark
// mode is handled at the token layer, not here.
export const WORK_TYPE_COLORS: Record<WorkType, string> = {
  frontend: 'var(--work-frontend)',
  backend: 'var(--work-backend)',
  test: 'var(--work-test)',
  styling: 'var(--work-styling)',
  docs: 'var(--work-docs)',
  config: 'var(--work-config)',
  other: 'var(--work-other)',
};

/** Lookup a work-type color with a safe fallback to --work-other. */
export function workTypeColor(key: string | null | undefined): string {
  if (key && (WORK_TYPES as readonly string[]).includes(key)) {
    return WORK_TYPE_COLORS[key as WorkType];
  }
  return WORK_TYPE_COLORS.other;
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Semantic thresholds ───────────────────────────
// Thresholds that widgets use to switch between success/warn/danger
// colors. Centralized here so tuning the cutoffs is a one-line change
// rather than a grep-and-edit across widgets.

export const COMPLETION_THRESHOLDS = {
  /** Sessions at or above this completion rate render in --success. */
  good: 70,
  /** Below `good` but at or above `warning` render in --warn. Below render in --danger. */
  warning: 40,
} as const;

/** Error rate (%) at or above which tool-call frequency bars tint to --warn. */
export const TOOL_ERROR_RATE_WARN_THRESHOLD = 10;

/**
 * Top-N cap for per-tool widgets (tool-daily, tool-work-type). At 8 the widget
 * stays legible in its default slot height and covers the 2–3 most common
 * teams-with-many-tools scenarios before the hidden tail grows meaningful;
 * overflow is surfaced with a "+N more" marker rather than silently dropped.
 */
export const TOOLS_TOP_N_CAP = 8;

// ── Tool-call classification ──────────────────────
// The tool-call-freq widget separates the host tool's built-in primitives
// (Edit, Read, Grep, Bash, …) from everything else (MCP-registered tools,
// user-installed commands). Without the split, built-ins dominate the
// top-N and the MCP tail stays invisible. The list below is Claude Code's
// canonical built-in set; other hosts overlap heavily on the same names.

const BUILTIN_TOOL_CALL_NAMES: ReadonlySet<string> = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Read',
  'Grep',
  'Glob',
  'Bash',
  'BashOutput',
  'KillShell',
  'Task',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'SlashCommand',
]);

export type ToolCallLane = 'builtin' | 'custom';

/**
 * Classify a tool-call name into built-in (the host's own primitives) or
 * custom (MCP-registered tools, user-installed extensions, anything else).
 * The `mcp__` prefix is the canonical marker for MCP tools across hosts.
 */
export function classifyToolCall(name: string): ToolCallLane {
  if (name.startsWith('mcp__')) return 'custom';
  if (BUILTIN_TOOL_CALL_NAMES.has(name)) return 'builtin';
  return 'custom';
}

// ── Tool data depth ───────────────────────────────
// Classifies a tool by how much of the capture pipeline it feeds. Three
// discrete levels so the 3-bar indicator in the Tools widget stays readable.

export type ToolDepthLevel = 1 | 2 | 3;
export interface ToolDepth {
  level: ToolDepthLevel;
  label: string;
}

export const TOOL_DEPTH_LABELS: Record<ToolDepthLevel, string> = {
  3: 'Full analytics',
  2: 'Activity analytics',
  1: 'Session analytics',
};

/**
 * Map a tool's DataCapabilities to a depth level:
 *   3 — feeds cost, conversations, or tool calls
 *   2 — feeds hooks or commit tracking
 *   1 — MCP session/edit data only (floor for every MCP-connected tool)
 */
export function getToolDepth(toolId: string): ToolDepth {
  const caps = getDataCapabilities(toolId);
  if (caps.conversationLogs || caps.tokenUsage || caps.toolCallLogs) {
    return { level: 3, label: TOOL_DEPTH_LABELS[3] };
  }
  if (caps.hooks || caps.commitTracking) {
    return { level: 2, label: TOOL_DEPTH_LABELS[2] };
  }
  return { level: 1, label: TOOL_DEPTH_LABELS[1] };
}

export function completionColor(rate: number): string {
  if (rate >= COMPLETION_THRESHOLDS.good) return 'var(--success)';
  if (rate >= COMPLETION_THRESHOLDS.warning) return 'var(--warn)';
  return 'var(--danger)';
}

// ── Derived data ──────────────────────────────────

export function computeCompletionRates(trends: DailyTrend[]): number[] {
  return trends.map((d) => {
    const total = d.sessions;
    if (total === 0) return 0;
    return Math.round(((d.completed ?? 0) / total) * 100);
  });
}

export interface ModelToolBreakdown {
  host_tool: string;
  count: number;
  edits: number;
}

export interface AggregatedModel {
  model: string;
  completed: number;
  total: number;
  rate: number;
  avgMin: number;
  edits: number;
  linesAdded: number;
  linesRemoved: number;
  /** Per-tool attribution sorted by count desc, nulls collapsed into a single
   * 'unknown' bucket. What makes the models widget substrate-unique: no
   * single-tool dashboard can answer "which tools ran this model." */
  byTool: ModelToolBreakdown[];
}

export function aggregateModels(
  modelOutcomes: Array<{
    agent_model: string;
    host_tool?: string | null;
    outcome: string;
    count: number;
    avg_duration_min: number;
    total_edits: number;
    total_lines_added: number;
    total_lines_removed: number;
  }>,
): AggregatedModel[] {
  interface Agg {
    completed: number;
    total: number;
    durationSum: number;
    edits: number;
    linesAdded: number;
    linesRemoved: number;
    tools: Map<string, { count: number; edits: number }>;
  }
  const map = new Map<string, Agg>();
  for (const m of modelOutcomes) {
    const existing = map.get(m.agent_model) || {
      completed: 0,
      total: 0,
      durationSum: 0,
      edits: 0,
      linesAdded: 0,
      linesRemoved: 0,
      tools: new Map<string, { count: number; edits: number }>(),
    };
    existing.total += m.count;
    if (m.outcome === 'completed') existing.completed += m.count;
    existing.durationSum += m.avg_duration_min * m.count;
    existing.edits += m.total_edits;
    existing.linesAdded += m.total_lines_added;
    existing.linesRemoved += m.total_lines_removed;
    const toolKey = m.host_tool ?? 'unknown';
    const toolAgg = existing.tools.get(toolKey) ?? { count: 0, edits: 0 };
    toolAgg.count += m.count;
    toolAgg.edits += m.total_edits;
    existing.tools.set(toolKey, toolAgg);
    map.set(m.agent_model, existing);
  }
  return [...map.entries()]
    .map(([model, v]) => ({
      model,
      completed: v.completed,
      total: v.total,
      rate: v.total > 0 ? Math.round((v.completed / v.total) * 1000) / 10 : 0,
      avgMin: v.total > 0 ? Math.round((v.durationSum / v.total) * 10) / 10 : 0,
      edits: v.edits,
      linesAdded: v.linesAdded,
      linesRemoved: v.linesRemoved,
      byTool: [...v.tools.entries()]
        .map(([host_tool, t]) => ({ host_tool, count: t.count, edits: t.edits }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.total - a.total);
}

export function buildHeatmapData(hourly: HourlyBucket[]): { grid: number[][]; max: number } {
  // grid[dow][hour] = session count
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const h of hourly) {
    grid[h.dow][h.hour] = (grid[h.dow][h.hour] || 0) + h.sessions;
  }
  // Normalize against the 95th percentile of populated cells, not the
  // absolute max. At team scale, one bursty cell (e.g. 30 Claude Code
  // sessions Tuesday 2pm) otherwise pushes every other cell to the
  // opacity floor and the rest of the grid reads as empty. p95 keeps
  // the hot cell saturated (callers clamp val/max to 1) while preserving
  // signal in the long tail.
  const populated: number[] = [];
  for (const row of grid) for (const v of row) if (v > 0) populated.push(v);
  populated.sort((a, b) => a - b);
  const max =
    populated.length > 0
      ? (populated[Math.max(0, Math.floor(populated.length * 0.95) - 1)] ?? 0)
      : 0;
  return { grid, max };
}

// ── Formatters ────────────────────────────────────

export function formatDelta(
  current: number,
  previous: number | undefined | null,
): { value: string; direction: 'up' | 'down' | 'neutral' } | null {
  if (previous == null || previous === 0) return null;
  const delta = Math.round((current - previous) * 10) / 10;
  if (delta === 0) return { value: '0', direction: 'neutral' };
  return {
    value: `${delta > 0 ? '+' : ''}${delta}`,
    direction: delta > 0 ? 'up' : 'down',
  };
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatDuration(ms: number): string {
  if (ms < 1) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/**
 * USD cost formatter. Returns the em-dash sentinel (`--`) for null/undefined
 * so callers can gate on their own "cost is unavailable" predicate and hand
 * the formatter a pass-through without a ternary at every site.
 *
 * Thousands separators are load-bearing at the 3.6rem hero-stat altitude —
 * `$12345.67` overflows the 4×2 KPI slot where `$12,345.67` does not.
 */
export function formatCost(value: number | null | undefined, decimals = 2): string {
  if (value == null) return '--';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Delta magnitude formatter for per-edit USD movements. Picks 4 decimals
 * below half a cent (|delta| < $0.005) so sub-cent swings aren't rounded
 * to $0.000; falls back to 3 decimals above that range for readability.
 * Returns the unsigned magnitude — the caller decorates with the
 * arrow/direction glyph.
 *
 * Lives next to formatCost rather than in lib/ because it's a
 * stat-widget-shaped concern: only the inline delta pill consumes it.
 */
export function formatCostDelta(value: number): string {
  const abs = Math.abs(value);
  if (abs < 0.005) return `$${abs.toFixed(4)}`;
  return `$${abs.toFixed(3)}`;
}

// ── Data-coverage categories ──────────────────────
// The data-coverage widget renders a list of analytics categories and how
// many of each category's signals have data yet. The category table is a
// declarative specification (label, signals, hint) — keep it here so the
// renderer stays a thin view.

export interface CoverageCategory {
  id: string;
  label: string;
  total: number;
  active: number;
  hint: string;
}

export function computeDataCoverage(
  a: UserAnalytics,
  conv: ConversationAnalytics,
): CoverageCategory[] {
  const models = aggregateModels(a.model_outcomes);
  return [
    {
      id: 'sessions',
      label: 'Session basics',
      total: 6,
      active: [
        a.stuckness.total_sessions > 0,
        a.hourly_distribution.length > 0 || a.duration_distribution.some((d) => d.count > 0),
        a.work_type_distribution.length > 0 &&
          a.work_type_distribution.reduce((s, w) => s + w.sessions, 0) > 0,
        a.work_type_outcomes.length > 0,
        a.scope_complexity.length > 0,
        a.first_edit_stats.avg_minutes_to_first_edit > 0 || a.first_edit_stats.by_tool.length > 0,
      ].filter(Boolean).length,
      hint: 'Run a few coding sessions',
    },
    {
      id: 'outcomes',
      label: 'Outcome analysis',
      total: 5,
      active: [
        a.period_comparison.current.total_sessions > 0 && a.period_comparison.previous !== null,
        a.hourly_effectiveness.length > 0,
        a.tool_outcomes.length > 0,
        a.conflict_correlation.length > 0,
        a.member_analytics.length > 0,
      ].filter(Boolean).length,
      hint: 'Complete or close some sessions',
    },
    {
      id: 'edits',
      label: 'Edit intelligence',
      total: 8,
      active: [
        a.edit_velocity.length >= 2,
        a.daily_trends.length >= 2,
        a.prompt_efficiency.length >= 2,
        a.file_heatmap.length > 0,
        a.directory_heatmap.length > 0,
        a.file_churn.length > 0,
        a.file_rework.length > 0,
        a.audit_staleness.length > 0,
      ].filter(Boolean).length,
      hint: 'Let agents make file edits',
    },
    {
      id: 'toolcalls',
      label: 'Tool call analytics',
      total: 3,
      active: [
        a.tool_call_stats.total_calls > 0,
        a.tool_call_stats.frequency.length > 0,
        a.tool_call_stats.error_patterns.length > 0,
      ].filter(Boolean).length,
      hint: 'Runs automatically with Claude Code',
    },
    {
      id: 'conversations',
      label: 'Conversation insights',
      total: 2,
      active: [
        a.conversation_edit_correlation.length > 0,
        conv.total_messages > 0 || conv.sessions_with_conversations > 0,
      ].filter(Boolean).length,
      hint: 'Use a tool with conversation capture',
    },
    {
      id: 'memory',
      label: 'Memory intelligence',
      total: 3,
      active: [
        a.memory_usage.total_memories > 0 || a.memory_usage.searches > 0,
        a.memory_outcome_correlation.length > 0,
        a.top_memories.length > 0,
      ].filter(Boolean).length,
      hint: 'Save or search shared memories',
    },
    {
      id: 'memory-safety',
      label: 'Memory pipeline',
      total: 3,
      active: [
        a.memory_usage.pending_consolidation_proposals > 0,
        a.memory_usage.formation_observations_by_recommendation
          ? (a.memory_usage.formation_observations_by_recommendation.keep ?? 0) +
              (a.memory_usage.formation_observations_by_recommendation.merge ?? 0) +
              (a.memory_usage.formation_observations_by_recommendation.evolve ?? 0) +
              (a.memory_usage.formation_observations_by_recommendation.discard ?? 0) >
            0
          : false,
        a.memory_usage.secrets_blocked_24h > 0,
      ].filter(Boolean).length,
      hint: 'Fills in as the consolidator, auditor, and secret detector run',
    },
    {
      id: 'multitool',
      label: 'Multi-tool analysis',
      total: 3,
      active: [
        models.length >= 2,
        a.tool_handoffs.length > 0,
        a.concurrent_edits.length > 0,
      ].filter(Boolean).length,
      hint: 'Connect a second tool',
    },
    {
      id: 'tokens',
      label: 'Token usage',
      total: 2,
      active: [
        a.token_usage.sessions_with_token_data > 0,
        a.data_coverage !== undefined && a.data_coverage.tools_reporting.length > 0,
      ].filter(Boolean).length,
      hint: 'Use a tool that reports tokens',
    },
    {
      id: 'tools',
      label: 'Tool comparison',
      total: 2,
      active: [a.tool_comparison.length > 0, a.tool_work_type.length > 0].filter(Boolean).length,
      hint: 'Connect at least one tool',
    },
  ];
}
