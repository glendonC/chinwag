// Mock past runs across the 7 reports for the skeleton. Varied statuses
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
  // Failure Hotspots — two past runs, one recent
  {
    id: 'run-fh-003',
    reportId: 'failure-hotspots',
    project: 'chinwag',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(3, 14),
    completedAt: daysAgo(3, 14),
    durationMs: 6 * 60 * 1000 + 42 * 1000,
    findingsCount: 6,
    criticalCount: 2,
  },
  {
    id: 'run-fh-002',
    reportId: 'failure-hotspots',
    project: 'chinwag',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(17, 9),
    completedAt: daysAgo(17, 9),
    durationMs: 7 * 60 * 1000 + 11 * 1000,
    findingsCount: 8,
    criticalCount: 3,
  },

  // Cost Allocation — one recent complete, one secondary-path run
  {
    id: 'run-cost-002',
    reportId: 'roi-optimizer',
    project: 'chinwag',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(1, 11),
    completedAt: daysAgo(1, 11),
    durationMs: 4 * 60 * 1000 + 18 * 1000,
    findingsCount: 5,
    criticalCount: 1,
  },
  {
    id: 'run-cost-001',
    reportId: 'roi-optimizer',
    project: 'chinwag',
    status: 'complete',
    path: 'secondary',
    startedAt: daysAgo(12, 16),
    completedAt: daysAgo(12, 16),
    durationMs: 3 * 60 * 1000 + 9 * 1000,
    findingsCount: 4,
    criticalCount: 0,
  },

  // Memory Effectiveness — one recent complete
  {
    id: 'run-mem-001',
    reportId: 'knowledge-health',
    project: 'chinwag',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(7, 10),
    completedAt: daysAgo(7, 10),
    durationMs: 5 * 60 * 1000 + 52 * 1000,
    findingsCount: 7,
    criticalCount: 1,
  },

  // Prompt Effectiveness — one running right now
  {
    id: 'run-pc-002',
    reportId: 'prompt-coach',
    project: 'chinwag',
    status: 'running',
    path: 'primary',
    startedAt: minutesAgo(2),
    currentPhase: 'Reading your session history',
    progress: 0.35,
  },

  // Prompt Effectiveness — past complete
  {
    id: 'run-pc-001',
    reportId: 'prompt-coach',
    project: 'chinwag',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(14, 13),
    completedAt: daysAgo(14, 13),
    durationMs: 6 * 60 * 1000 + 28 * 1000,
    findingsCount: 5,
    criticalCount: 0,
  },

  // Root Cause Analysis — one past, one failed
  {
    id: 'run-rca-002',
    reportId: 'failure-patterns',
    project: 'chinwag',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(4, 15),
    completedAt: daysAgo(4, 15),
    durationMs: 8 * 60 * 1000 + 4 * 1000,
    findingsCount: 6,
    criticalCount: 2,
  },
  {
    id: 'run-rca-001',
    reportId: 'failure-patterns',
    project: 'chinwag',
    status: 'failed',
    path: 'primary',
    startedAt: daysAgo(21, 11),
    completedAt: daysAgo(21, 11),
    durationMs: 48 * 1000,
  },

  // Coordination Audit — queued waiting for CLI
  {
    id: 'run-coord-001',
    reportId: 'coordination-auditor',
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
