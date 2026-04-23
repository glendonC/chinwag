// Member (per-handle) rollup analytics.
// A member bucket tracks primary tool via a nested Map, which is noisy
// enough that giving it its own module keeps the session-shape code
// readable.

import type { MemberAnalytics } from '@chinmeister/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

const rate = (num: number, denom: number) =>
  denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

// Audit 2026-04-21: Bucket trimmed to match the pruned MemberAnalytics shape.
// abandoned/failed/avg_duration_min/total_lines_added/removed/total_commits
// all dropped — see memberAnalyticsSchema comment for rationale. `completed`
// stays because cross-team completion_rate = sum(completed) / sum(sessions);
// averaging per-team rates would be wrong.
interface MemberBucket {
  sessions: number;
  completed: number;
  total_edits: number;
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
      total_edits: 0,
      total_session_hours: 0,
      tools: new Map<string, number>(),
    };
    existing.sessions += ma.sessions;
    existing.completed += ma.completed;
    existing.total_edits += ma.total_edits;
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
        completion_rate: rate(v.completed, v.sessions),
        total_edits: v.total_edits,
        primary_tool: primaryTool,
        total_session_hours: Math.round(v.total_session_hours * 100) / 100,
      };
    });
}
