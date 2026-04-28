import { formatCost } from '../../widgets/utils.js';

/**
 * Shared delta helpers for the OverviewView detail surfaces (Usage, Outcomes,
 * Codebase, Activity, Tools, Memory). Each detail view's tab strip shows a
 * scalar value with a small arrow+magnitude pill underneath. Originally the
 * helpers were copy-pasted across three views; consolidated here so every
 * delta on every tab is computed and rendered identically.
 *
 * Em-dash placeholder for tabs without a comparable previous-period value
 * (e.g. files-touched has no per-day breakdown). Keeps the delta caption
 * visible on every tab so the strip stays visually uniform - no conditional
 * renders that hide treatment during testing.
 */
export const MISSING_DELTA = { text: '-', color: 'var(--soft)' } as const;

/**
 * In-window delta: split a daily series in half by position and compare
 * sums. Matches the widget convention (see `splitPeriodDelta` in
 * `widgets/bodies/UsageWidgets.tsx`) - preferred over `period_comparison`
 * because the worker's 30-day session retention empties the previous
 * window for production users, which would null every cross-window
 * delta. Splitting the current window sidesteps retention and keeps the
 * arrow honest at any range.
 */
export function splitDelta<T>(
  days: ReadonlyArray<T>,
  select: (row: T) => number,
): { current: number; previous: number } | null {
  if (days.length < 2) return null;
  const mid = Math.floor(days.length / 2);
  const currentStart = days.length % 2 === 0 ? mid : mid + 1;
  const previous = days.slice(0, mid).reduce((s, d) => s + select(d), 0);
  const current = days.slice(currentStart).reduce((s, d) => s + select(d), 0);
  return { current, previous };
}

/**
 * Format a numeric delta into an arrow + magnitude pill matching the
 * StatWidget convention (`↑26`, `↓4`, `→0`). Returns the placeholder
 * em-dash when the comparison can't be established (no previous data,
 * or `previous <= 0` which is divide-by-infinity territory).
 */
export function formatCountDelta(
  delta: { current: number; previous: number } | null,
  invert = false,
): { text: string; color: string } {
  if (!delta || delta.previous <= 0) return MISSING_DELTA;
  const d = delta.current - delta.previous;
  if (d === 0) return { text: '→0', color: 'var(--muted)' };
  const arrow = d > 0 ? '↑' : '↓';
  const magnitude = String(Math.abs(Math.round(d * 10) / 10));
  const isGood = invert ? d < 0 : d > 0;
  return { text: `${arrow}${magnitude}`, color: isGood ? 'var(--success)' : 'var(--danger)' };
}

/**
 * Rate-flavored delta formatter (percentage points). Used by Outcomes for
 * completion-rate-shaped tabs where the value is already a percentage and
 * the delta is a point difference, not a count difference.
 */
export function formatRateDelta(
  current: number,
  previous: number | null | undefined,
  invert = false,
): { text: string; color: string } {
  if (previous == null || previous <= 0) return MISSING_DELTA;
  const d = current - previous;
  if (d === 0) return { text: '→0', color: 'var(--muted)' };
  const arrow = d > 0 ? '↑' : '↓';
  const magnitude = Math.abs(Math.round(d * 10) / 10);
  const isGood = invert ? d < 0 : d > 0;
  return {
    text: `${arrow}${magnitude}`,
    color: isGood ? 'var(--success)' : 'var(--danger)',
  };
}

/**
 * USD-flavored delta formatter. Matches StatWidget's `usd-fine` path
 * (sub-cent precision) for cost-per-edit, and falls back to plain
 * cost formatting for whole-dollar deltas.
 */
export function formatUsdDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  digits: number,
  invert = false,
): { text: string; color: string } {
  if (current == null || previous == null || previous <= 0) return MISSING_DELTA;
  const d = current - previous;
  if (d === 0) return { text: '→0', color: 'var(--muted)' };
  const arrow = d > 0 ? '↑' : '↓';
  const isGood = invert ? d < 0 : d > 0;
  return {
    text: `${arrow}${formatCost(Math.abs(d), digits)}`,
    color: isGood ? 'var(--success)' : 'var(--danger)',
  };
}
