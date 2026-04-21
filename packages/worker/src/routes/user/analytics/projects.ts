// Per-project (team) velocity rollup.
//
// Other merge modules collapse multiple teams into a single aggregate.
// This one does the opposite: each team entry becomes one rollup entry,
// preserving team identity so the Edits drill can answer "which project
// runs fastest." The orchestrator passes the teamEntry (team_id +
// team_name) alongside the TeamResult because the per-team response
// doesn't carry its own identity.
//
// Totals are sourced from the per-team `tool_comparison`, which already
// applies the `ended_at IS NOT NULL` hour filter (see queryToolComparison
// in dos/team/analytics/outcomes.ts). That matches queryEditVelocity's
// denominator semantics, so per-project rates reconcile with the global
// sparkline's math.

import type { ProjectVelocityRollup } from '@chinwag/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface ProjectBucket {
  team_id: string;
  team_name: string | null;
  sessions: number;
  total_edits: number;
  total_session_hours: number;
  primary_tool: string | null;
}

export type ProjectsAcc = ProjectBucket[];

export function createAcc(): ProjectsAcc {
  return [];
}

export function merge(
  acc: ProjectsAcc,
  team: TeamResult,
  teamEntry: { team_id: string; team_name: string | null },
): void {
  // tool_comparison filters out `host_tool IS NULL OR host_tool = 'unknown'`
  // in the DO query — for project totals that's the right scope, since
  // unknown-host sessions have no attributable tool anyway and would
  // otherwise inflate the total without a sensible primary_tool.
  let totalEdits = 0;
  let totalSessionHours = 0;
  let primaryTool: string | null = null;
  let primarySessions = 0;
  for (const tc of team.tool_comparison ?? []) {
    totalEdits += tc.total_edits;
    totalSessionHours += tc.total_session_hours;
    if (tc.sessions > primarySessions) {
      primarySessions = tc.sessions;
      primaryTool = tc.host_tool;
    }
  }
  const sessions = team.completion_summary?.total_sessions ?? 0;
  acc.push({
    team_id: teamEntry.team_id,
    team_name: teamEntry.team_name,
    sessions,
    total_edits: totalEdits,
    total_session_hours: totalSessionHours,
    primary_tool: primaryTool,
  });
}

export function project(acc: ProjectsAcc): ProjectVelocityRollup[] {
  return [...acc]
    .sort((a, b) => b.sessions - a.sessions)
    .map((v) => ({
      team_id: v.team_id,
      team_name: v.team_name,
      sessions: v.sessions,
      total_edits: v.total_edits,
      total_session_hours: round2(v.total_session_hours),
      edits_per_hour: v.total_session_hours > 0 ? round1(v.total_edits / v.total_session_hours) : 0,
      primary_tool: v.primary_tool,
    }));
}
