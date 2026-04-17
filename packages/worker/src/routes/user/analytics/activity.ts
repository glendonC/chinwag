// Time-of-day / calendar-day activity analytics.
// Bucketed by clock dimensions (hour / day-of-week / date), so the formatting
// and sort rules are shared across all three analytics in this module.
//
// Owns: hourly_distribution, hourly_effectiveness, daily_metrics,
// prompt_efficiency.

import type {
  DailyMetricEntry,
  HourlyBucket,
  HourlyEffectiveness,
  PromptEfficiencyTrend,
} from '@chinwag/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

const round1 = (n: number) => Math.round(n * 10) / 10;
const rate = (num: number, denom: number) =>
  denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

// ── hourly_distribution ──────────────────────────

interface HourlyBucketAcc {
  sessions: number;
  edits: number;
}

export type HourlyAcc = Map<string, HourlyBucketAcc>;

export function createHourlyAcc(): HourlyAcc {
  return new Map();
}

export function mergeHourly(acc: HourlyAcc, team: TeamResult): void {
  for (const h of team.hourly_distribution ?? []) {
    const key = `${h.hour}-${h.dow}`;
    const existing = acc.get(key) ?? { sessions: 0, edits: 0 };
    existing.sessions += h.sessions;
    existing.edits += h.edits;
    acc.set(key, existing);
  }
}

export function projectHourly(acc: HourlyAcc): HourlyBucket[] {
  return [...acc.entries()].map(([key, v]) => {
    const [hourStr, dowStr] = key.split('-');
    const hour = Number(hourStr);
    const dow = Number(dowStr);
    return { hour, dow, sessions: v.sessions, edits: v.edits };
  });
}

// ── hourly_effectiveness ─────────────────────────

interface HourlyEffBucket {
  sessions: number;
  completed: number;
  edits_sum: number;
}

export type HourlyEffAcc = Map<number, HourlyEffBucket>;

export function createHourlyEffAcc(): HourlyEffAcc {
  return new Map();
}

export function mergeHourlyEff(acc: HourlyEffAcc, team: TeamResult): void {
  for (const he of team.hourly_effectiveness ?? []) {
    const existing = acc.get(he.hour) ?? { sessions: 0, completed: 0, edits_sum: 0 };
    existing.sessions += he.sessions;
    existing.completed += Math.round((he.completion_rate / 100) * he.sessions);
    existing.edits_sum += he.avg_edits * he.sessions;
    acc.set(he.hour, existing);
  }
}

export function projectHourlyEff(acc: HourlyEffAcc): HourlyEffectiveness[] {
  return [...acc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, v]) => ({
      hour,
      sessions: v.sessions,
      completion_rate: rate(v.completed, v.sessions),
      avg_edits: v.sessions > 0 ? Math.round(v.edits_sum / v.sessions) : 0,
    }));
}

// ── daily_metrics ────────────────────────────────

export type DailyMetricsAcc = Map<string, number>;

export function createDailyMetricsAcc(): DailyMetricsAcc {
  return new Map();
}

export function mergeDailyMetrics(acc: DailyMetricsAcc, team: TeamResult): void {
  for (const dm of team.daily_metrics ?? []) {
    const key = `${dm.date}:${dm.metric}`;
    acc.set(key, (acc.get(key) ?? 0) + dm.count);
  }
}

export function projectDailyMetrics(acc: DailyMetricsAcc): DailyMetricEntry[] {
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => {
      const idx = key.indexOf(':');
      return { date: key.slice(0, idx), metric: key.slice(idx + 1), count };
    });
}

// ── prompt_efficiency ────────────────────────────

interface PromptEffBucket {
  turns_sum: number;
  sessions: number;
}

export type PromptEffAcc = Map<string, PromptEffBucket>;

export function createPromptEffAcc(): PromptEffAcc {
  return new Map();
}

export function mergePromptEff(acc: PromptEffAcc, team: TeamResult): void {
  for (const pe of team.prompt_efficiency ?? []) {
    const existing = acc.get(pe.day) ?? { turns_sum: 0, sessions: 0 };
    existing.turns_sum += pe.avg_turns_per_edit * pe.sessions;
    existing.sessions += pe.sessions;
    acc.set(pe.day, existing);
  }
}

export function projectPromptEff(acc: PromptEffAcc): PromptEfficiencyTrend[] {
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({
      day,
      avg_turns_per_edit: v.sessions > 0 ? round1(v.turns_sum / v.sessions) : 0,
      sessions: v.sessions,
    }));
}
