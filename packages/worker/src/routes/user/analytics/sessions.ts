// Session-shape analytics: things that describe individual sessions or
// aggregate session-level signal (duration, retries, velocity, stuckness).
//
// Owns: duration_distribution, edit_velocity, first_edit_stats, stuckness,
// retry_patterns, concurrent_edits, outcome_tags, work_type_distribution.
// Larger unit-scoped analytics (member rollups, period comparison, memory
// usage) live in their own modules to keep this file focused.

import type {
  ConcurrentEditEntry,
  ConflictStats,
  DurationBucket,
  EditVelocityTrend,
  FirstEditStats,
  OutcomeTagCount,
  RetryPattern,
  StucknessStats,
  WorkTypeDistribution,
} from '@chinmeister/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const rate = (num: number, denom: number) =>
  denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

// ── duration_distribution ────────────────────────

const DURATION_BUCKETS = ['0-5m', '5-15m', '15-30m', '30-60m', '60m+'] as const;
export type DurationAcc = Map<string, number>;

export function createDurationAcc(): DurationAcc {
  return new Map();
}

export function mergeDuration(acc: DurationAcc, team: TeamResult): void {
  for (const db of team.duration_distribution ?? []) {
    acc.set(db.bucket, (acc.get(db.bucket) ?? 0) + db.count);
  }
}

export function projectDuration(acc: DurationAcc): DurationBucket[] {
  return DURATION_BUCKETS.map((bucket) => ({ bucket, count: acc.get(bucket) ?? 0 }));
}

// ── edit_velocity ────────────────────────────────

interface VelocityBucket {
  edits: number;
  lines: number;
  hours: number;
}

export type VelocityAcc = Map<string, VelocityBucket>;

export function createVelocityAcc(): VelocityAcc {
  return new Map();
}

export function mergeVelocity(acc: VelocityAcc, team: TeamResult): void {
  for (const ev of team.edit_velocity ?? []) {
    const existing = acc.get(ev.day) ?? { edits: 0, lines: 0, hours: 0 };
    const hours = ev.total_session_hours;
    existing.edits += ev.edits_per_hour * hours;
    existing.lines += ev.lines_per_hour * hours;
    existing.hours += hours;
    acc.set(ev.day, existing);
  }
}

export function projectVelocity(acc: VelocityAcc): EditVelocityTrend[] {
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({
      day,
      edits_per_hour: v.hours > 0 ? round1(v.edits / v.hours) : 0,
      lines_per_hour: v.hours > 0 ? round1(v.lines / v.hours) : 0,
      total_session_hours: round2(v.hours),
    }));
}

// ── first_edit_stats ─────────────────────────────

export interface FirstEditAcc {
  sum_avg: number;
  sum_median: number;
  count: number;
  by_tool: Map<string, { sum_avg: number; sessions: number }>;
}

export function createFirstEditAcc(): FirstEditAcc {
  return { sum_avg: 0, sum_median: 0, count: 0, by_tool: new Map() };
}

export function mergeFirstEdit(acc: FirstEditAcc, team: TeamResult): void {
  const fe = team.first_edit_stats;
  if (!fe) return;
  // Weight each team's averages by its total_sessions so teams with more
  // activity pull the cross-team mean harder.
  const teamSessions = team.completion_summary?.total_sessions ?? 1;
  acc.sum_avg += fe.avg_minutes_to_first_edit * teamSessions;
  acc.sum_median += fe.median_minutes_to_first_edit * teamSessions;
  acc.count += teamSessions;
  for (const bt of fe.by_tool ?? []) {
    const existing = acc.by_tool.get(bt.host_tool) ?? { sum_avg: 0, sessions: 0 };
    existing.sum_avg += bt.avg_minutes * bt.sessions;
    existing.sessions += bt.sessions;
    acc.by_tool.set(bt.host_tool, existing);
  }
}

export function projectFirstEdit(acc: FirstEditAcc): FirstEditStats {
  return {
    avg_minutes_to_first_edit: acc.count > 0 ? round1(acc.sum_avg / acc.count) : 0,
    median_minutes_to_first_edit: acc.count > 0 ? round1(acc.sum_median / acc.count) : 0,
    by_tool: [...acc.by_tool.entries()]
      .sort(([, a], [, b]) => b.sessions - a.sessions)
      .map(([host_tool, v]) => ({
        host_tool,
        avg_minutes: v.sessions > 0 ? round1(v.sum_avg / v.sessions) : 0,
        sessions: v.sessions,
      })),
  };
}

// ── stuckness ────────────────────────────────────

export interface StucknessAcc {
  total_sessions: number;
  stuck_sessions: number;
  stuck_completed: number;
  stuck_total: number;
  normal_completed: number;
  normal_total: number;
}

export function createStucknessAcc(): StucknessAcc {
  return {
    total_sessions: 0,
    stuck_sessions: 0,
    stuck_completed: 0,
    stuck_total: 0,
    normal_completed: 0,
    normal_total: 0,
  };
}

export function mergeStuckness(acc: StucknessAcc, team: TeamResult): void {
  const st = team.stuckness;
  if (!st) return;
  acc.total_sessions += st.total_sessions;
  acc.stuck_sessions += st.stuck_sessions;
  const stuckTotal = st.stuck_sessions;
  const normalTotal = st.total_sessions - stuckTotal;
  acc.stuck_completed += Math.round((st.stuck_completion_rate / 100) * stuckTotal);
  acc.stuck_total += stuckTotal;
  acc.normal_completed += Math.round((st.normal_completion_rate / 100) * normalTotal);
  acc.normal_total += normalTotal;
}

export function projectStuckness(acc: StucknessAcc): StucknessStats {
  return {
    total_sessions: acc.total_sessions,
    stuck_sessions: acc.stuck_sessions,
    stuckness_rate: rate(acc.stuck_sessions, acc.total_sessions),
    stuck_completion_rate: rate(acc.stuck_completed, acc.stuck_total),
    normal_completion_rate: rate(acc.normal_completed, acc.normal_total),
  };
}

// ── conflict_stats ───────────────────────────────

export interface ConflictStatsAcc {
  blocked: number;
  found: number;
  daily: Map<string, number>;
}

export function createConflictStatsAcc(): ConflictStatsAcc {
  return { blocked: 0, found: 0, daily: new Map() };
}

export function mergeConflictStats(acc: ConflictStatsAcc, team: TeamResult): void {
  const cs = team.conflict_stats;
  if (!cs) return;
  acc.blocked += cs.blocked_period;
  acc.found += cs.found_period;
  for (const d of cs.daily_blocked ?? []) {
    acc.daily.set(d.day, (acc.daily.get(d.day) ?? 0) + d.blocked);
  }
}

export function projectConflictStats(acc: ConflictStatsAcc): ConflictStats {
  const daily_blocked = [...acc.daily.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, blocked]) => ({ day, blocked }));
  return { blocked_period: acc.blocked, found_period: acc.found, daily_blocked };
}

// ── retry_patterns ───────────────────────────────

// Audit 2026-04-21: Post-regroup shape - key is file (not handle:file). Attempts
// sum across teams because the same path appearing in team-A and team-B
// genuinely means more pain for this user. Agents is max-across-teams - the
// union of distinct counts is not itself a distinct count, and max is a
// truthful lower bound when the same person may appear in multiple teams.
// Tools union normally because set semantics hold across teams.
interface RetryBucket {
  attempts: number;
  max_agents: number;
  tools: Set<string>;
  final_outcome: string | null;
  resolved: boolean;
}

export type RetryAcc = Map<string, RetryBucket>;

export function createRetryAcc(): RetryAcc {
  return new Map();
}

export function mergeRetry(acc: RetryAcc, team: TeamResult): void {
  for (const rp of team.retry_patterns ?? []) {
    const key = rp.file;
    const existing = acc.get(key) ?? {
      attempts: 0,
      max_agents: 0,
      tools: new Set<string>(),
      final_outcome: null,
      resolved: false,
    };
    existing.attempts += rp.attempts;
    existing.max_agents = Math.max(existing.max_agents, rp.agents);
    for (const t of rp.tools) existing.tools.add(t);
    existing.final_outcome = rp.final_outcome ?? existing.final_outcome;
    existing.resolved = existing.final_outcome === 'completed';
    acc.set(key, existing);
  }
}

export function projectRetry(acc: RetryAcc): RetryPattern[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.attempts - a.attempts)
    .slice(0, 30)
    .map(([file, v]) => ({
      file,
      attempts: v.attempts,
      agents: v.max_agents,
      tools: [...v.tools],
      final_outcome: v.final_outcome,
      resolved: v.resolved,
    }));
}

// ── concurrent_edits ─────────────────────────────

interface ConcurrentBucket {
  // agents is a per-team figure; we approximate cross-team as a union of
  // disjoint team-scoped tokens so the count scales with participation.
  agents: Set<string>;
  edit_count: number;
}

export type ConcurrentAcc = Map<string, ConcurrentBucket>;

export function createConcurrentAcc(): ConcurrentAcc {
  return new Map();
}

export function mergeConcurrent(acc: ConcurrentAcc, team: TeamResult, teamIndex: number): void {
  for (const ce of team.concurrent_edits ?? []) {
    const existing = acc.get(ce.file) ?? { agents: new Set<string>(), edit_count: 0 };
    for (let i = 0; i < ce.agents; i++) existing.agents.add(`${ce.file}:${teamIndex}:${i}`);
    existing.edit_count += ce.edit_count;
    acc.set(ce.file, existing);
  }
}

export function projectConcurrent(acc: ConcurrentAcc): ConcurrentEditEntry[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.agents.size - a.agents.size)
    .slice(0, 20)
    .map(([file, v]) => ({ file, agents: v.agents.size, edit_count: v.edit_count }));
}

// ── outcome_tags ─────────────────────────────────

export type OutcomeTagsAcc = Map<string, number>;

export function createOutcomeTagsAcc(): OutcomeTagsAcc {
  return new Map();
}

export function mergeOutcomeTags(acc: OutcomeTagsAcc, team: TeamResult): void {
  for (const ot of team.outcome_tags ?? []) {
    const key = `${ot.tag}:${ot.outcome}`;
    acc.set(key, (acc.get(key) ?? 0) + ot.count);
  }
}

export function projectOutcomeTags(acc: OutcomeTagsAcc): OutcomeTagCount[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 30)
    .map(([key, count]) => {
      const sep = key.lastIndexOf(':');
      return { tag: key.slice(0, sep), outcome: key.slice(sep + 1), count };
    });
}

// ── work_type_distribution ───────────────────────

interface WorkTypeBucket {
  sessions: number;
  edits: number;
  lines_added: number;
  lines_removed: number;
  files: Set<string>;
}

export type WorkTypeAcc = Map<string, WorkTypeBucket>;

export function createWorkTypeAcc(): WorkTypeAcc {
  return new Map();
}

export function mergeWorkType(acc: WorkTypeAcc, team: TeamResult, teamIndex: number): void {
  for (const wt of team.work_type_distribution ?? []) {
    const existing = acc.get(wt.work_type) ?? {
      sessions: 0,
      edits: 0,
      lines_added: 0,
      lines_removed: 0,
      files: new Set<string>(),
    };
    existing.sessions += wt.sessions;
    existing.edits += wt.edits;
    existing.lines_added += wt.lines_added;
    existing.lines_removed += wt.lines_removed;
    // files is a per-team count; approximate the cross-team total by tagging
    // with the team index so disjoint team files don't collide.
    existing.files.add(`${wt.work_type}:${teamIndex}`);
    acc.set(wt.work_type, existing);
  }
}

export function projectWorkType(acc: WorkTypeAcc): WorkTypeDistribution[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.sessions - a.sessions)
    .map(([work_type, v]) => ({
      work_type,
      sessions: v.sessions,
      edits: v.edits,
      lines_added: v.lines_added,
      lines_removed: v.lines_removed,
      files: v.files.size,
    }));
}
