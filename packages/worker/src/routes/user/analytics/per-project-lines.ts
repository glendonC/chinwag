// Per-project (team) daily line attribution.
// Unlike sibling modules, this does NOT merge by key. Each (team_id, day)
// is unique by construction, so we concat rather than sum. Reuses each
// team's already-computed `daily_trends` from its getAnalyticsForOwner
// response, tagged with the team_id/team_name from the caller's user_teams
// row. No new DO query needed; daily_trends already carries the per-day
// lines we want to attribute by project.

import type { ProjectLinesTrend } from '@chinwag/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

interface TeamEntry {
  team_id: string;
  team_name: string | null;
}

export type PerProjectLinesAcc = ProjectLinesTrend[];

export function createAcc(): PerProjectLinesAcc {
  return [];
}

// Signature differs from peer modules by taking `teamEntry`: the user
// endpoint folds team identity in during the merge loop because the
// per-team DO has no idea what its user-facing label is.
export function merge(acc: PerProjectLinesAcc, team: TeamResult, teamEntry: TeamEntry): void {
  for (const t of team.daily_trends ?? []) {
    acc.push({
      team_id: teamEntry.team_id,
      team_name: teamEntry.team_name,
      day: t.day,
      sessions: t.sessions,
      edits: t.edits,
      lines_added: t.lines_added,
      lines_removed: t.lines_removed,
    });
  }
}

export function project(acc: PerProjectLinesAcc): ProjectLinesTrend[] {
  // Sort by day ASC, then team_id so the client can render a stable
  // grouped timeline without post-sorting.
  return [...acc].sort((a, b) =>
    a.day === b.day ? a.team_id.localeCompare(b.team_id) : a.day.localeCompare(b.day),
  );
}
