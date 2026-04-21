// Tool-dimensioned analytics.
// All bucketed by host_tool so they share the same fan-out pattern and sort
// rule ("most sessions first"). Kept together so any future tool naming /
// normalization rule only needs one edit.
//
// Owns: tool_distribution, tool_comparison, tool_daily, tool_work_type,
// tool_handoffs. It also tracks the active-tool set used by the handler's
// data_coverage computation.

import type {
  ToolComparison,
  ToolDailyTrend,
  ToolDistribution,
  ToolHandoff,
  ToolWorkTypeBreakdown,
} from '@chinwag/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

const round1 = (n: number) => Math.round(n * 10) / 10;
const rate = (num: number, denom: number) =>
  denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

// ── tool_distribution ────────────────────────────

interface ToolDistBucket {
  sessions: number;
  edits: number;
}

export type ToolDistAcc = Map<string, ToolDistBucket>;

export function createToolDistAcc(): ToolDistAcc {
  return new Map();
}

export function mergeToolDist(acc: ToolDistAcc, team: TeamResult): void {
  for (const t of team.tool_distribution ?? []) {
    const existing = acc.get(t.host_tool) ?? { sessions: 0, edits: 0 };
    existing.sessions += t.sessions;
    existing.edits += t.edits;
    acc.set(t.host_tool, existing);
  }
}

export function projectToolDist(acc: ToolDistAcc): ToolDistribution[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.sessions - a.sessions)
    .map(([host_tool, v]) => ({ host_tool, sessions: v.sessions, edits: v.edits }));
}

// ── tool_comparison ──────────────────────────────

interface ToolCompBucket {
  sessions: number;
  completed: number;
  abandoned: number;
  failed: number;
  duration_sum: number;
  duration_count: number;
  total_edits: number;
  total_lines_added: number;
  total_lines_removed: number;
  total_session_hours: number;
}

export type ToolCompAcc = Map<string, ToolCompBucket>;

export function createToolCompAcc(): ToolCompAcc {
  return new Map();
}

export function mergeToolComp(acc: ToolCompAcc, team: TeamResult): void {
  for (const tc of team.tool_comparison ?? []) {
    const existing = acc.get(tc.host_tool) ?? {
      sessions: 0,
      completed: 0,
      abandoned: 0,
      failed: 0,
      duration_sum: 0,
      duration_count: 0,
      total_edits: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
      total_session_hours: 0,
    };
    existing.sessions += tc.sessions;
    existing.completed += tc.completed;
    existing.abandoned += tc.abandoned;
    existing.failed += tc.failed;
    existing.duration_sum += tc.avg_duration_min * tc.sessions;
    existing.duration_count += tc.sessions;
    existing.total_edits += tc.total_edits;
    existing.total_lines_added += tc.total_lines_added;
    existing.total_lines_removed += tc.total_lines_removed;
    existing.total_session_hours += tc.total_session_hours;
    acc.set(tc.host_tool, existing);
  }
}

export function projectToolComp(acc: ToolCompAcc): ToolComparison[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.sessions - a.sessions)
    .map(([host_tool, v]) => ({
      host_tool,
      sessions: v.sessions,
      completed: v.completed,
      abandoned: v.abandoned,
      failed: v.failed,
      completion_rate: rate(v.completed, v.sessions),
      avg_duration_min: v.duration_count > 0 ? round1(v.duration_sum / v.duration_count) : 0,
      total_edits: v.total_edits,
      total_lines_added: v.total_lines_added,
      total_lines_removed: v.total_lines_removed,
      total_session_hours: Math.round(v.total_session_hours * 100) / 100,
    }));
}

// ── tool_daily ───────────────────────────────────

interface ToolDailyBucket {
  sessions: number;
  edits: number;
  lines_added: number;
  lines_removed: number;
  duration_sum: number;
  duration_count: number;
}

export type ToolDailyAcc = Map<string, ToolDailyBucket>;

export function createToolDailyAcc(): ToolDailyAcc {
  return new Map();
}

export function mergeToolDaily(acc: ToolDailyAcc, team: TeamResult): void {
  for (const td of team.tool_daily ?? []) {
    const key = `${td.host_tool}:${td.day}`;
    const existing = acc.get(key) ?? {
      sessions: 0,
      edits: 0,
      lines_added: 0,
      lines_removed: 0,
      duration_sum: 0,
      duration_count: 0,
    };
    existing.sessions += td.sessions;
    existing.edits += td.edits;
    existing.lines_added += td.lines_added;
    existing.lines_removed += td.lines_removed;
    existing.duration_sum += td.avg_duration_min * td.sessions;
    existing.duration_count += td.sessions;
    acc.set(key, existing);
  }
}

export function projectToolDaily(acc: ToolDailyAcc): ToolDailyTrend[] {
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => {
      const sep = key.indexOf(':');
      return {
        host_tool: key.slice(0, sep),
        day: key.slice(sep + 1),
        sessions: v.sessions,
        edits: v.edits,
        lines_added: v.lines_added,
        lines_removed: v.lines_removed,
        avg_duration_min: v.duration_count > 0 ? round1(v.duration_sum / v.duration_count) : 0,
      };
    });
}

// ── tool_work_type ───────────────────────────────

interface ToolWorkTypeBucket {
  sessions: number;
  edits: number;
}

export type ToolWorkTypeAcc = Map<string, ToolWorkTypeBucket>;

export function createToolWorkTypeAcc(): ToolWorkTypeAcc {
  return new Map();
}

export function mergeToolWorkType(acc: ToolWorkTypeAcc, team: TeamResult): void {
  for (const tw of team.tool_work_type ?? []) {
    const key = `${tw.host_tool}:${tw.work_type}`;
    const existing = acc.get(key) ?? { sessions: 0, edits: 0 };
    existing.sessions += tw.sessions;
    existing.edits += tw.edits;
    acc.set(key, existing);
  }
}

export function projectToolWorkType(acc: ToolWorkTypeAcc): ToolWorkTypeBreakdown[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.sessions - a.sessions)
    .map(([key, v]) => {
      const sep = key.indexOf(':');
      return {
        host_tool: key.slice(0, sep),
        work_type: key.slice(sep + 1),
        sessions: v.sessions,
        edits: v.edits,
      };
    });
}

// ── tool_handoffs ────────────────────────────────

interface ToolHandoffBucket {
  file_count: number;
  completed: number;
  total: number;
  gap_minutes_sum: number; // file_count-weighted sum for averaging
  gap_weight: number;
  recent_files: ToolHandoff['recent_files'];
}

export type ToolHandoffsAcc = Map<string, ToolHandoffBucket>;

export function createToolHandoffsAcc(): ToolHandoffsAcc {
  return new Map();
}

export function mergeToolHandoffs(acc: ToolHandoffsAcc, team: TeamResult): void {
  for (const th of team.tool_handoffs ?? []) {
    const key = `${th.from_tool}:${th.to_tool}`;
    const existing = acc.get(key) ?? {
      file_count: 0,
      completed: 0,
      total: 0,
      gap_minutes_sum: 0,
      gap_weight: 0,
      recent_files: [],
    };
    existing.file_count += th.file_count;
    existing.total += th.file_count;
    existing.completed += Math.round((th.handoff_completion_rate / 100) * th.file_count);
    if (th.avg_gap_minutes > 0 && th.file_count > 0) {
      existing.gap_minutes_sum += th.avg_gap_minutes * th.file_count;
      existing.gap_weight += th.file_count;
    }
    if (th.recent_files && th.recent_files.length > 0) {
      existing.recent_files.push(...th.recent_files);
    }
    acc.set(key, existing);
  }
}

export function projectToolHandoffs(acc: ToolHandoffsAcc): ToolHandoff[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.file_count - a.file_count)
    .slice(0, 20)
    .map(([key, v]) => {
      const sep = key.indexOf(':');
      // Sort merged files newest-first, dedupe by path keeping freshest,
      // cap at 20. Prevents cross-team duplicates from starving real entries.
      const sortedFiles = [...v.recent_files].sort((a, b) =>
        b.last_transition_at.localeCompare(a.last_transition_at),
      );
      const seen = new Set<string>();
      const dedupedFiles: ToolHandoff['recent_files'] = [];
      for (const f of sortedFiles) {
        if (seen.has(f.file_path)) continue;
        seen.add(f.file_path);
        dedupedFiles.push(f);
        if (dedupedFiles.length >= 20) break;
      }
      return {
        from_tool: key.slice(0, sep),
        to_tool: key.slice(sep + 1),
        file_count: v.file_count,
        handoff_completion_rate: rate(v.completed, v.total),
        avg_gap_minutes: v.gap_weight > 0 ? Math.round(v.gap_minutes_sum / v.gap_weight) : 0,
        recent_files: dedupedFiles,
      };
    });
}

// ── active tools (for data_coverage) ─────────────

export type ActiveToolsAcc = Set<string>;

export function createActiveToolsAcc(): ActiveToolsAcc {
  return new Set();
}

export function mergeActiveTools(acc: ActiveToolsAcc, team: TeamResult): void {
  for (const t of team.tool_distribution ?? []) {
    if (t.host_tool && t.host_tool !== 'unknown') acc.add(t.host_tool);
  }
  for (const tc of team.tool_comparison ?? []) {
    if (tc.host_tool && tc.host_tool !== 'unknown') acc.add(tc.host_tool);
  }
}
