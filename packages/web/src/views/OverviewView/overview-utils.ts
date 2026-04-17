import { summarizeList } from '../../lib/summarize.js';
import type { DailyTrend, HourlyBucket } from '../../lib/apiSchemas.js';

// ── Constants ─────────────────────────────────────

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

// Work-type palette. Values are CSS custom-property references declared
// in styles/tokens.css — they alias the app's semantic tokens so dark
// mode is handled at the token layer, not here.
export const WORK_TYPE_COLORS: Record<string, string> = {
  frontend: 'var(--work-frontend)',
  backend: 'var(--work-backend)',
  test: 'var(--work-test)',
  styling: 'var(--work-styling)',
  docs: 'var(--work-docs)',
  config: 'var(--work-config)',
  other: 'var(--work-other)',
};

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Helpers ────────────────────────────────────────

export function summarizeNames(items: Array<{ team_id?: string; team_name?: string }>): string {
  const names = items.map((item) => item?.team_name || item?.team_id).filter(Boolean) as string[];
  return summarizeList(names);
}

export function computeCompletionRates(trends: DailyTrend[]): number[] {
  return trends.map((d) => {
    const total = d.sessions;
    if (total === 0) return 0;
    return Math.round(((d.completed ?? 0) / total) * 100);
  });
}

export function aggregateModels(
  modelOutcomes: Array<{
    agent_model: string;
    outcome: string;
    count: number;
    avg_duration_min: number;
    total_edits: number;
    total_lines_added: number;
    total_lines_removed: number;
  }>,
): Array<{
  model: string;
  completed: number;
  total: number;
  rate: number;
  avgMin: number;
  edits: number;
  linesAdded: number;
  linesRemoved: number;
}> {
  const map = new Map<
    string,
    {
      completed: number;
      total: number;
      durationSum: number;
      edits: number;
      linesAdded: number;
      linesRemoved: number;
    }
  >();
  for (const m of modelOutcomes) {
    const existing = map.get(m.agent_model) || {
      completed: 0,
      total: 0,
      durationSum: 0,
      edits: 0,
      linesAdded: 0,
      linesRemoved: 0,
    };
    existing.total += m.count;
    if (m.outcome === 'completed') existing.completed += m.count;
    existing.durationSum += m.avg_duration_min * m.count;
    existing.edits += m.total_edits;
    existing.linesAdded += m.total_lines_added;
    existing.linesRemoved += m.total_lines_removed;
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
    }))
    .sort((a, b) => b.total - a.total);
}

export function buildHeatmapData(hourly: HourlyBucket[]): { grid: number[][]; max: number } {
  // grid[dow][hour] = session count
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let max = 0;
  for (const h of hourly) {
    grid[h.dow][h.hour] = (grid[h.dow][h.hour] || 0) + h.sessions;
    if (grid[h.dow][h.hour] > max) max = grid[h.dow][h.hour];
  }
  return { grid, max };
}

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
