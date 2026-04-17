// Outcome-shaped analytics.
// Grouped together because every analytic here partitions sessions by their
// final outcome (completed / abandoned / failed), and a shared helper for
// completion_rate math keeps the formulas consistent.
//
// Owns: outcome_distribution, completion_summary, tool_outcomes,
// model_outcomes, work_type_outcomes, conflict_correlation.

import type {
  CompletionSummary,
  ConflictCorrelation,
  ModelOutcome,
  OutcomeCount,
  ToolOutcome,
  WorkTypeOutcome,
} from '@chinwag/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

const round1 = (n: number) => Math.round(n * 10) / 10;
const rate = (num: number, denom: number) =>
  denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

// ── outcome_distribution ─────────────────────────

export type OutcomeDistAcc = Map<string, number>;

export function createOutcomeDistAcc(): OutcomeDistAcc {
  return new Map();
}

export function mergeOutcomeDist(acc: OutcomeDistAcc, team: TeamResult): void {
  for (const o of team.outcome_distribution ?? []) {
    acc.set(o.outcome, (acc.get(o.outcome) ?? 0) + o.count);
  }
}

export function projectOutcomeDist(acc: OutcomeDistAcc): OutcomeCount[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([outcome, count]) => ({ outcome, count }));
}

// ── completion_summary ───────────────────────────

export interface CompletionAcc {
  total_sessions: number;
  completed: number;
  abandoned: number;
  failed: number;
  unknown: number;
  prev_total: number;
  prev_completed: number;
}

export function createCompletionAcc(): CompletionAcc {
  return {
    total_sessions: 0,
    completed: 0,
    abandoned: 0,
    failed: 0,
    unknown: 0,
    prev_total: 0,
    prev_completed: 0,
  };
}

export function mergeCompletion(acc: CompletionAcc, team: TeamResult): void {
  const cs = team.completion_summary;
  if (!cs) return;
  acc.total_sessions += cs.total_sessions;
  acc.completed += cs.completed;
  acc.abandoned += cs.abandoned;
  acc.failed += cs.failed;
  acc.unknown += cs.unknown;
  if (cs.prev_completion_rate != null) {
    const prevTotal = cs.total_sessions; // approximate — DO doesn't report previous-window total separately
    acc.prev_total += prevTotal;
    acc.prev_completed += Math.round((cs.prev_completion_rate / 100) * prevTotal);
  }
}

export function projectCompletion(acc: CompletionAcc): CompletionSummary {
  return {
    total_sessions: acc.total_sessions,
    completed: acc.completed,
    abandoned: acc.abandoned,
    failed: acc.failed,
    unknown: acc.unknown,
    completion_rate: rate(acc.completed, acc.total_sessions),
    prev_completion_rate: acc.prev_total > 0 ? rate(acc.prev_completed, acc.prev_total) : null,
  };
}

// ── tool_outcomes ────────────────────────────────

export type ToolOutcomesAcc = Map<string, number>;

export function createToolOutcomesAcc(): ToolOutcomesAcc {
  return new Map();
}

export function mergeToolOutcomes(acc: ToolOutcomesAcc, team: TeamResult): void {
  for (const to of team.tool_outcomes ?? []) {
    const key = `${to.host_tool}:${to.outcome}`;
    acc.set(key, (acc.get(key) ?? 0) + to.count);
  }
}

export function projectToolOutcomes(acc: ToolOutcomesAcc): ToolOutcome[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([key, count]) => {
      const sep = key.indexOf(':');
      return { host_tool: key.slice(0, sep), outcome: key.slice(sep + 1), count };
    });
}

// ── model_outcomes ───────────────────────────────

interface ModelBucket {
  count: number;
  total_edits: number;
  duration_sum: number;
  lines_added: number;
  lines_removed: number;
}

export type ModelOutcomesAcc = Map<string, ModelBucket>;

export function createModelOutcomesAcc(): ModelOutcomesAcc {
  return new Map();
}

export function mergeModelOutcomes(acc: ModelOutcomesAcc, team: TeamResult): void {
  for (const m of team.model_outcomes ?? []) {
    const key = `${m.agent_model}:${m.outcome}`;
    const existing = acc.get(key) ?? {
      count: 0,
      total_edits: 0,
      duration_sum: 0,
      lines_added: 0,
      lines_removed: 0,
    };
    existing.count += m.count;
    existing.total_edits += m.total_edits;
    existing.duration_sum += m.avg_duration_min * m.count;
    existing.lines_added += m.total_lines_added;
    existing.lines_removed += m.total_lines_removed;
    acc.set(key, existing);
  }
}

export function projectModelOutcomes(acc: ModelOutcomesAcc): ModelOutcome[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([key, v]) => {
      const [agent_model = '', outcome = ''] = key.split(':');
      return {
        agent_model,
        outcome,
        count: v.count,
        avg_duration_min: v.count > 0 ? round1(v.duration_sum / v.count) : 0,
        total_edits: v.total_edits,
        total_lines_added: v.lines_added,
        total_lines_removed: v.lines_removed,
      };
    });
}

// ── work_type_outcomes ───────────────────────────

interface WorkTypeOutcomeBucket {
  sessions: number;
  completed: number;
  abandoned: number;
  failed: number;
}

export type WorkTypeOutcomesAcc = Map<string, WorkTypeOutcomeBucket>;

export function createWorkTypeOutcomesAcc(): WorkTypeOutcomesAcc {
  return new Map();
}

export function mergeWorkTypeOutcomes(acc: WorkTypeOutcomesAcc, team: TeamResult): void {
  for (const wo of team.work_type_outcomes ?? []) {
    const existing = acc.get(wo.work_type) ?? {
      sessions: 0,
      completed: 0,
      abandoned: 0,
      failed: 0,
    };
    existing.sessions += wo.sessions;
    existing.completed += wo.completed;
    existing.abandoned += wo.abandoned;
    existing.failed += wo.failed;
    acc.set(wo.work_type, existing);
  }
}

export function projectWorkTypeOutcomes(acc: WorkTypeOutcomesAcc): WorkTypeOutcome[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.sessions - a.sessions)
    .map(([work_type, v]) => ({
      work_type,
      sessions: v.sessions,
      completed: v.completed,
      abandoned: v.abandoned,
      failed: v.failed,
      completion_rate: rate(v.completed, v.sessions),
    }));
}

// ── conflict_correlation ─────────────────────────

interface ConflictBucket {
  sessions: number;
  completed: number;
}

export type ConflictAcc = Map<string, ConflictBucket>;

export function createConflictAcc(): ConflictAcc {
  return new Map();
}

export function mergeConflict(acc: ConflictAcc, team: TeamResult): void {
  for (const cc of team.conflict_correlation ?? []) {
    const existing = acc.get(cc.bucket) ?? { sessions: 0, completed: 0 };
    existing.sessions += cc.sessions;
    existing.completed += cc.completed;
    acc.set(cc.bucket, existing);
  }
}

export function projectConflict(acc: ConflictAcc): ConflictCorrelation[] {
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => ({
      bucket,
      sessions: v.sessions,
      completed: v.completed,
      completion_rate: rate(v.completed, v.sessions),
    }));
}
