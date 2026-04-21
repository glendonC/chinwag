// Member (per-handle) rollup analytics.
// A member bucket tracks primary tool via a nested Map, which is noisy
// enough that giving it its own module keeps the session-shape code
// readable.

import type { MemberAnalytics } from '@chinwag/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

const round1 = (n: number) => Math.round(n * 10) / 10;
const rate = (num: number, denom: number) =>
  denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

interface MemberBucket {
  sessions: number;
  completed: number;
  abandoned: number;
  failed: number;
  duration_sum: number;
  duration_count: number;
  total_edits: number;
  total_lines_added: number;
  total_lines_removed: number;
  total_commits: number;
  total_session_hours: number;
  tools: Map<string, number>;
}

export type MemberAcc = Map<string, MemberBucket>;

export function createAcc(): MemberAcc {
  return new Map();
}

export function merge(acc: MemberAcc, team: TeamResult): void {
  for (const ma of team.member_analytics ?? []) {
    const existing = acc.get(ma.handle) ?? {
      sessions: 0,
      completed: 0,
      abandoned: 0,
      failed: 0,
      duration_sum: 0,
      duration_count: 0,
      total_edits: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
      total_commits: 0,
      total_session_hours: 0,
      tools: new Map<string, number>(),
    };
    existing.sessions += ma.sessions;
    existing.completed += ma.completed;
    existing.abandoned += ma.abandoned;
    existing.failed += ma.failed;
    existing.duration_sum += ma.avg_duration_min * ma.sessions;
    existing.duration_count += ma.sessions;
    existing.total_edits += ma.total_edits;
    existing.total_lines_added += ma.total_lines_added;
    existing.total_lines_removed += ma.total_lines_removed;
    existing.total_commits += ma.total_commits ?? 0;
    existing.total_session_hours += ma.total_session_hours;
    if (ma.primary_tool) {
      existing.tools.set(ma.primary_tool, (existing.tools.get(ma.primary_tool) ?? 0) + ma.sessions);
    }
    acc.set(ma.handle, existing);
  }
}

export function project(acc: MemberAcc): MemberAnalytics[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.sessions - a.sessions)
    .slice(0, 50)
    .map(([handle, v]) => {
      let primaryTool: string | null = null;
      let maxCount = 0;
      for (const [tool, count] of v.tools) {
        if (count > maxCount) {
          primaryTool = tool;
          maxCount = count;
        }
      }
      return {
        handle,
        sessions: v.sessions,
        completed: v.completed,
        abandoned: v.abandoned,
        failed: v.failed,
        completion_rate: rate(v.completed, v.sessions),
        avg_duration_min: v.duration_count > 0 ? round1(v.duration_sum / v.duration_count) : 0,
        total_edits: v.total_edits,
        total_lines_added: v.total_lines_added,
        total_lines_removed: v.total_lines_removed,
        total_commits: v.total_commits,
        primary_tool: primaryTool,
        total_session_hours: Math.round(v.total_session_hours * 100) / 100,
      };
    });
}
