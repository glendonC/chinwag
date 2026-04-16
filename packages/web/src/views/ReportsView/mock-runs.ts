// Mock past runs across the 4 reports for the skeleton. Varied statuses
// (some complete, one running, one queued) and varied paths (primary vs
// secondary) so the UI can show the full range of states.

import type { MockRun } from './types.js';

function daysAgo(days: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 30, 0, 0);
  return d.toISOString();
}

function minutesAgo(mins: number): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - mins);
  return d.toISOString();
}

export const MOCK_RUNS: MockRun[] = [
  // Failure Analysis — two past runs
  {
    id: 'run-fa-003',
    reportId: 'failure-analysis',
    project: 'chinwag',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(3, 14),
    completedAt: daysAgo(3, 14),
    durationMs: 8 * 60 * 1000 + 4 * 1000,
    findingsCount: 6,
    criticalCount: 2,
  },
  {
    id: 'run-fa-002',
    reportId: 'failure-analysis',
    project: 'chinwag',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(17, 9),
    completedAt: daysAgo(17, 9),
    durationMs: 7 * 60 * 1000 + 11 * 1000,
    findingsCount: 8,
    criticalCount: 3,
  },

  // Prompt Patterns — one running right now, one past
  {
    id: 'run-pp-002',
    reportId: 'prompt-patterns',
    project: 'chinwag',
    status: 'running',
    path: 'primary',
    startedAt: minutesAgo(2),
    currentPhase: 'Reading your session history',
    progress: 0.35,
  },
  {
    id: 'run-pp-001',
    reportId: 'prompt-patterns',
    project: 'chinwag',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(14, 13),
    completedAt: daysAgo(14, 13),
    durationMs: 6 * 60 * 1000 + 28 * 1000,
    findingsCount: 5,
    criticalCount: 0,
  },

  // Coordination Audit — queued waiting for CLI
  {
    id: 'run-ca-001',
    reportId: 'coordination-audit',
    project: 'chinwag',
    status: 'queued',
    path: 'primary',
    startedAt: minutesAgo(8),
  },
];

/** Returns all runs for a given report, newest first. */
export function getRunsForReport(reportId: string): MockRun[] {
  return MOCK_RUNS.filter((r) => r.reportId === reportId).sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
}

/** Returns the most recent run for a given report. */
export function getLatestRun(reportId: string): MockRun | undefined {
  return getRunsForReport(reportId)[0];
}

/** Returns a single run by id. */
export function getRun(runId: string): MockRun | undefined {
  return MOCK_RUNS.find((r) => r.id === runId);
}
