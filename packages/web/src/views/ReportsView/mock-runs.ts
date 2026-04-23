// Mock past runs across the 8 reports for the skeleton. Varied statuses
// (complete, running, queued, failed) and varied paths so the UI can show
// the full range of catalog states.

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

function hoursAgo(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return d.toISOString();
}

export const MOCK_RUNS: MockRun[] = [
  // Failure Analysis — two past runs
  {
    id: 'run-fa-003',
    reportId: 'failure-analysis',
    project: 'chinmeister',
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
    project: 'chinmeister',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(17, 9),
    completedAt: daysAgo(17, 9),
    durationMs: 7 * 60 * 1000 + 11 * 1000,
    findingsCount: 8,
    criticalCount: 3,
  },

  // Coordination Audit — one complete, one queued
  {
    id: 'run-ca-002',
    reportId: 'coordination-audit',
    project: 'chinmeister',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(5, 11),
    completedAt: daysAgo(5, 11),
    durationMs: 4 * 60 * 1000 + 52 * 1000,
    findingsCount: 3,
    criticalCount: 0,
  },
  {
    id: 'run-ca-001',
    reportId: 'coordination-audit',
    project: 'chinmeister',
    status: 'queued',
    path: 'primary',
    startedAt: minutesAgo(8),
  },

  // Cost Leak — two past runs
  {
    id: 'run-cl-002',
    reportId: 'cost-leak',
    project: 'chinmeister',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(1, 16),
    completedAt: daysAgo(1, 16),
    durationMs: 3 * 60 * 1000 + 18 * 1000,
    findingsCount: 4,
    criticalCount: 1,
  },
  {
    id: 'run-cl-001',
    reportId: 'cost-leak',
    project: 'chinmeister',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(8, 12),
    completedAt: daysAgo(8, 12),
    durationMs: 2 * 60 * 1000 + 47 * 1000,
    findingsCount: 3,
    criticalCount: 0,
  },

  // Cross-Tool Effectiveness — one past run
  {
    id: 'run-ct-001',
    reportId: 'cross-tool-effectiveness',
    project: 'chinmeister',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(6, 13),
    completedAt: daysAgo(6, 13),
    durationMs: 5 * 60 * 1000 + 22 * 1000,
    findingsCount: 3,
    criticalCount: 0,
  },

  // Test-Edit Gap — one running now, one past
  {
    id: 'run-te-002',
    reportId: 'test-edit-gap',
    project: 'chinmeister',
    status: 'running',
    path: 'primary',
    startedAt: minutesAgo(3),
  },
  {
    id: 'run-te-001',
    reportId: 'test-edit-gap',
    project: 'chinmeister',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(16, 10),
    completedAt: daysAgo(16, 10),
    durationMs: 6 * 60 * 1000 + 9 * 1000,
    findingsCount: 5,
    criticalCount: 1,
  },

  // Architecture Drift — one past run
  {
    id: 'run-ad-001',
    reportId: 'architecture-drift',
    project: 'chinmeister',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(11, 15),
    completedAt: daysAgo(11, 15),
    durationMs: 9 * 60 * 1000 + 34 * 1000,
    findingsCount: 4,
    criticalCount: 1,
  },

  // Failure Forensics — one past run (on-demand, so a single recent run)
  {
    id: 'run-ff-001',
    reportId: 'failure-forensics',
    project: 'chinmeister',
    status: 'complete',
    path: 'primary',
    startedAt: hoursAgo(1),
    completedAt: hoursAgo(1),
    durationMs: 3 * 60 * 1000 + 41 * 1000,
    findingsCount: 3,
    criticalCount: 1,
  },

  // Memory Hygiene — one past run, one older failed
  {
    id: 'run-mh-001',
    reportId: 'memory-hygiene',
    project: 'chinmeister',
    status: 'complete',
    path: 'primary',
    startedAt: daysAgo(4, 9),
    completedAt: daysAgo(4, 9),
    durationMs: 4 * 60 * 1000 + 12 * 1000,
    findingsCount: 3,
    criticalCount: 0,
  },
  {
    id: 'run-mh-000',
    reportId: 'memory-hygiene',
    project: 'chinmeister',
    status: 'failed',
    path: 'primary',
    startedAt: daysAgo(32, 14),
    completedAt: daysAgo(32, 14),
    durationMs: 47 * 1000,
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
