// Freshness state for a report in the catalog.
//
// Drives the "Last run" column. Unlike a raw timestamp, freshness combines
// the report's recommended cadence with the last run to answer "is this
// worth running now." A 2-day-old report looks fresh or overdue depending
// on whether cadence is weekly or yearly.
//
// Six states:
//   not-run      → 0 runs
//   running      → latest run still in progress (or queued)
//   failed       → latest run failed
//   fresh        → within cadenceDays of last completed run
//   overdue      → past cadenceDays since last completed run
//   one-time-ran → cadenceDays is null (one-time reports) and has runs

import type { ReportDef } from './report-catalog.js';
import type { MockRun } from './types.js';

export type FreshnessState =
  | { kind: 'not-run' }
  | { kind: 'running' }
  | { kind: 'failed'; ageDays: number }
  | { kind: 'fresh'; ageDays: number }
  | { kind: 'overdue'; overdueDays: number }
  | { kind: 'one-time-ran'; ageDays: number };

export function computeFreshness(
  report: ReportDef,
  latestRun: MockRun | undefined,
): FreshnessState {
  if (!latestRun) return { kind: 'not-run' };
  if (latestRun.status === 'running' || latestRun.status === 'queued') {
    return { kind: 'running' };
  }

  const anchor = latestRun.completedAt ?? latestRun.startedAt;
  const ageMs = Date.now() - new Date(anchor).getTime();
  const ageDays = Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)));

  if (latestRun.status === 'failed') return { kind: 'failed', ageDays };

  if (report.cadenceDays == null) return { kind: 'one-time-ran', ageDays };

  if (ageDays <= report.cadenceDays) return { kind: 'fresh', ageDays };
  return { kind: 'overdue', overdueDays: ageDays - report.cadenceDays };
}

// Ages are rendered with an "ago" suffix except when it would read wrong
// ("today ago"). Durations (e.g. how long a report has been overdue) drop
// the suffix entirely — "Overdue · 9d" not "Overdue · 9d ago".

function formatAge(days: number): string {
  if (days <= 0) return 'today';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatDuration(days: number): string {
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

export function formatFreshness(state: FreshnessState): string {
  switch (state.kind) {
    case 'not-run':
      return 'Not yet run';
    case 'running':
      return 'Running now';
    case 'failed':
      return `Failed · ${formatAge(state.ageDays)}`;
    case 'fresh':
      return `Fresh · ${formatAge(state.ageDays)}`;
    case 'overdue':
      return `Overdue · ${formatDuration(state.overdueDays)}`;
    case 'one-time-ran':
      return formatAge(state.ageDays);
  }
}
