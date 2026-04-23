// Commit analytics.
// The commit_stats payload bundles five related analytics: totals, by_tool,
// daily_commits, outcome_correlation, and commit_edit_ratio. They all derive
// from commits.* tables and share weighted averages, so merging them in one
// module keeps the math coherent.

import type { CommitStats } from '@chinmeister/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const rate = (num: number, denom: number) =>
  denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

interface ToolBucket {
  commits: number;
  files_sum: number;
  lines_sum: number;
}

interface OutcomeCorrBucket {
  sessions: number;
  completed: number;
}

interface EditRatioBucket {
  sessions: number;
  completed: number;
  edits_sum: number;
  commits_sum: number;
}

export interface CommitsAcc {
  total_commits: number;
  sessions_with_commits: number;
  ttfc_sum: number;
  ttfc_count: number;
  byTool: Map<string, ToolBucket>;
  daily: Map<string, number>;
  outcomeCorr: Map<string, OutcomeCorrBucket>;
  editRatio: Map<string, EditRatioBucket>;
}

export function createAcc(): CommitsAcc {
  return {
    total_commits: 0,
    sessions_with_commits: 0,
    ttfc_sum: 0,
    ttfc_count: 0,
    byTool: new Map(),
    daily: new Map(),
    outcomeCorr: new Map(),
    editRatio: new Map(),
  };
}

export function merge(acc: CommitsAcc, team: TeamResult): void {
  const cs = team.commit_stats;
  if (!cs) return;
  acc.total_commits += cs.total_commits;
  acc.sessions_with_commits += cs.sessions_with_commits;
  if (cs.avg_time_to_first_commit_min != null && cs.sessions_with_commits > 0) {
    acc.ttfc_sum += cs.avg_time_to_first_commit_min * cs.sessions_with_commits;
    acc.ttfc_count += cs.sessions_with_commits;
  }
  for (const bt of cs.by_tool ?? []) {
    const existing = acc.byTool.get(bt.host_tool) ?? { commits: 0, files_sum: 0, lines_sum: 0 };
    existing.commits += bt.commits;
    existing.files_sum += bt.avg_files_changed * bt.commits;
    existing.lines_sum += bt.avg_lines * bt.commits;
    acc.byTool.set(bt.host_tool, existing);
  }
  for (const dc of cs.daily_commits ?? []) {
    acc.daily.set(dc.day, (acc.daily.get(dc.day) ?? 0) + dc.commits);
  }
  for (const oc of cs.outcome_correlation ?? []) {
    const existing = acc.outcomeCorr.get(oc.bucket) ?? { sessions: 0, completed: 0 };
    existing.sessions += oc.sessions;
    existing.completed += oc.completed;
    acc.outcomeCorr.set(oc.bucket, existing);
  }
  for (const cr of cs.commit_edit_ratio ?? []) {
    const existing = acc.editRatio.get(cr.bucket) ?? {
      sessions: 0,
      completed: 0,
      edits_sum: 0,
      commits_sum: 0,
    };
    existing.sessions += cr.sessions;
    existing.completed += Math.round((cr.completion_rate / 100) * cr.sessions);
    existing.edits_sum += cr.avg_edits * cr.sessions;
    existing.commits_sum += cr.avg_commits * cr.sessions;
    acc.editRatio.set(cr.bucket, existing);
  }
}

/**
 * Project into the CommitStats shape. Needs `totalSessions` to compute
 * commits_per_session — the handler has that figure from the completion
 * accumulator, so it's passed in explicitly rather than duplicated here.
 */
export function project(acc: CommitsAcc, totalSessions: number): CommitStats {
  const denom = totalSessions || 1;
  return {
    total_commits: acc.total_commits,
    commits_per_session: denom > 0 ? round2(acc.total_commits / denom) : 0,
    sessions_with_commits: acc.sessions_with_commits,
    avg_time_to_first_commit_min: acc.ttfc_count > 0 ? round1(acc.ttfc_sum / acc.ttfc_count) : null,
    by_tool: [...acc.byTool.entries()]
      .sort(([, a], [, b]) => b.commits - a.commits)
      .map(([host_tool, v]) => ({
        host_tool,
        commits: v.commits,
        avg_files_changed: v.commits > 0 ? round1(v.files_sum / v.commits) : 0,
        avg_lines: v.commits > 0 ? round1(v.lines_sum / v.commits) : 0,
      })),
    daily_commits: [...acc.daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, commits]) => ({ day, commits })),
    outcome_correlation: [...acc.outcomeCorr.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, v]) => ({
        bucket,
        sessions: v.sessions,
        completed: v.completed,
        completion_rate: rate(v.completed, v.sessions),
      })),
    commit_edit_ratio: [...acc.editRatio.entries()].map(([bucket, v]) => ({
      bucket,
      sessions: v.sessions,
      completion_rate: rate(v.completed, v.sessions),
      avg_edits: v.sessions > 0 ? round1(v.edits_sum / v.sessions) : 0,
      avg_commits: v.sessions > 0 ? round1(v.commits_sum / v.sessions) : 0,
    })),
  };
}
