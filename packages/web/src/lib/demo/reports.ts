// Reports demo data. Mirrors the live.ts pattern: a baseline payload for
// the "Healthy" scenario, an empty variant, and pure helpers that take a
// payload as input so the same fixtures work across scenarios without
// globals.
//
// The Reports backend is not yet wired up. When it lands, callers swap
// useDemoReports() for a real fetch hook and these helpers stay; the
// payload shape matches what the API will return.

import type { CompletedReport, MockRun } from '../../views/ReportsView/types.js';

export interface ReportsDemoData {
  runs: MockRun[];
  completed: Record<string, CompletedReport>;
}

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

export function createBaselineReports(): ReportsDemoData {
  const runs: MockRun[] = [
    // Failures - two past runs
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

    // Collisions - one complete, one queued
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

    // Project Primer - one past run (on teammate join)
    {
      id: 'run-op-001',
      reportId: 'onboarding-brief',
      project: 'chinmeister',
      status: 'complete',
      path: 'primary',
      startedAt: daysAgo(2, 10),
      completedAt: daysAgo(2, 10),
      durationMs: 4 * 60 * 1000 + 18 * 1000,
      findingsCount: 3,
      criticalCount: 0,
    },

    // Memory Cleanup - one past run, one older failed
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

  const completed: Record<string, CompletedReport> = {
    'failure-analysis': {
      runId: 'run-fa-003',
      reportId: 'failure-analysis',
      summary:
        "Three files account for 62% of this month's abandoned sessions. One is a model-fit problem, one is a test-locking gap, and 30% of all failures trace to Read errors on locked files.",
      findings: [
        {
          id: 'f-fa-1',
          severity: 'critical',
          title: 'router.ts reworked in 9 sessions: 78% completion on Opus, 40% on Sonnet',
          body: 'Every failed attempt was a Sonnet session that ran out of context before reaching a working edit. The Opus runs completed in half the tool calls.',
          citations: [
            { type: 'file', label: 'packages/worker/src/router.ts', detail: '9 edits, 3 rewrites' },
            { type: 'session', label: '9 sessions', detail: 'a3f7b2, e8c104, 5d2a91, +6 more' },
            { type: 'metric', label: '78% / 40%', detail: 'Opus vs Sonnet completion rate' },
          ],
          actions: [
            { id: 'a-fa-1-state', category: 'state', label: 'Save as memory' },
            { id: 'a-fa-1-route', category: 'state', label: 'Route this file to Opus' },
            { id: 'a-fa-1-spawn', category: 'spawn', label: 'Review router.ts with Claude Code' },
          ],
        },
        {
          id: 'f-fa-2',
          severity: 'critical',
          title: '30% of failed sessions: Read errors on locked files in tests/',
          body: 'Same conflict pattern caused 11 abandonments this month. Extending claim coverage to tests/ would prevent most of them. Integration tests have 5x the retry rate of unit tests.',
          citations: [
            {
              type: 'file',
              label: 'packages/worker/tests/integration/',
              detail: '14 sessions, 47 retries',
            },
            { type: 'tool_call', label: 'Read', detail: '47 failed calls, avg 1.2s timeout' },
            {
              type: 'conflict',
              label: '11 lock-conflict retries',
              detail: 'Read errors on locked files',
            },
          ],
          actions: [
            { id: 'a-fa-2-state', category: 'state', label: 'Extend claim coverage to tests/' },
            { id: 'a-fa-2-export', category: 'export', label: 'Download conflict log' },
          ],
        },
        {
          id: 'f-fa-3',
          severity: 'warning',
          title: 'Sonnet sessions abandon 2.3x more often after their first Bash error',
          body: 'The error cascade is specific to Sonnet. Opus and Haiku recover from the same errors. Concentrated in shell-heavy tasks.',
          citations: [
            { type: 'tool_call', label: 'Bash', detail: 'error cascade signature' },
            { type: 'session', label: '9 Sonnet abandonments' },
          ],
          actions: [
            { id: 'a-fa-3-state', category: 'state', label: 'Save as model warning' },
            { id: 'a-fa-3-spawn', category: 'spawn', label: 'Debug pattern with Claude Code' },
          ],
        },
        {
          id: 'f-fa-4',
          severity: 'warning',
          title: 'ConflictBanner.tsx: 4 concurrent-edit conflicts this week',
          body: 'Two agents touched this file within a 30-second window on four separate occasions. No coordination message was exchanged on any of them.',
          citations: [
            {
              type: 'file',
              label: 'packages/web/src/components/ConflictBanner/ConflictBanner.tsx',
            },
            { type: 'conflict', label: '4 concurrent edits', detail: 'session pairs, 30s window' },
          ],
          actions: [
            { id: 'a-fa-4-state', category: 'state', label: 'Create watcher for this file' },
            { id: 'a-fa-4-state-2', category: 'state', label: 'Flag for refactor' },
          ],
        },
        {
          id: 'f-fa-5',
          severity: 'info',
          title: 'Session warmup is 2.1x slower on first edit in packages/worker/dos/',
          body: 'Agents spend an average of 94 seconds reading before first edit in this directory. Compared to 44 seconds elsewhere.',
          citations: [
            { type: 'metric', label: '94s vs 44s', detail: 'time-to-first-edit' },
            { type: 'session', label: '23 sessions sampled' },
          ],
          actions: [
            { id: 'a-fa-5-state', category: 'state', label: 'Save as memory' },
            { id: 'a-fa-5-export', category: 'export', label: 'Draft CLAUDE.md note' },
          ],
        },
      ],
      stats: {
        sessionsRead: 147,
        filesRead: 58,
        tokensUsed: 124_000,
        estimatedCost: 0.42,
        path: 'primary',
      },
    },

    'coordination-audit': {
      runId: 'run-ca-002',
      reportId: 'coordination-audit',
      summary:
        "Three files account for 70% of this team's concurrent-edit conflicts. Seven lock-conflict retries on tests/ could have been prevented with one glob claim.",
      findings: [
        {
          id: 'f-ca-1',
          severity: 'warning',
          title: 'router.ts edited by 3 agents over 3 days with no claim overlap',
          body: 'Three separate agents touched this file within a 72-hour window. None held a claim for longer than the single edit, so neither lock-conflict warnings nor coordination messages fired.',
          citations: [
            { type: 'file', label: 'packages/worker/src/router.ts' },
            { type: 'session', label: '3 sessions', detail: 'agents: aria, vex, nova' },
            { type: 'conflict', label: '2 re-edits', detail: 'conflicting edits within 30 min' },
          ],
          actions: [
            { id: 'a-ca-1-state', category: 'state', label: 'Assign file owner' },
            { id: 'a-ca-1-state-2', category: 'state', label: 'Flag for refactor' },
            { id: 'a-ca-1-spawn', category: 'spawn', label: 'Investigate with Claude Code' },
          ],
        },
        {
          id: 'f-ca-2',
          severity: 'info',
          title: 'Three files cause 70% of your concurrent-edit conflicts',
          body: 'router.ts, ProjectView.tsx, and tool-registry.ts. All cross-package or cross-layer files. The coordination cost compounds: each conflict on these files averages 40 seconds of agent re-read time.',
          citations: [
            { type: 'file', label: 'packages/worker/src/router.ts' },
            { type: 'file', label: 'packages/web/src/views/ProjectView/ProjectView.tsx' },
            { type: 'file', label: 'packages/shared/src/tool-registry.ts' },
            { type: 'conflict', label: '47 conflicts this month', detail: '70% in these 3 files' },
          ],
          actions: [
            { id: 'a-ca-2-state', category: 'state', label: 'Create watchers' },
            { id: 'a-ca-2-export', category: 'export', label: 'Download conflict report' },
          ],
        },
        {
          id: 'f-ca-3',
          severity: 'info',
          title: 'Seven lock-conflict retries on tests/ would be prevented by one glob claim',
          body: 'The retries all happened on files under tests/integration/. No agent currently holds a glob claim for this directory; individual file claims are granted and released on single edits.',
          citations: [
            { type: 'file', label: 'packages/worker/tests/integration/' },
            { type: 'conflict', label: '7 lock-conflict retries', detail: 'Read-after-claim' },
          ],
          actions: [
            {
              id: 'a-ca-3-state',
              category: 'state',
              label: 'Suggest glob claim: tests/integration/**',
            },
            { id: 'a-ca-3-export', category: 'export', label: 'Copy claim suggestion' },
          ],
        },
      ],
      stats: {
        sessionsRead: 182,
        filesRead: 8,
        tokensUsed: 61_000,
        estimatedCost: 0.23,
        path: 'primary',
      },
    },

    'onboarding-brief': {
      runId: 'run-op-001',
      reportId: 'onboarding-brief',
      summary:
        'Backend (packages/worker/) completes 82% on Claude Code + Opus. Frontend (packages/web/) works well on Cursor + Sonnet at half the cost. Tests under packages/worker/tests/integration/ retry 5x more without claim coverage.',
      findings: [
        {
          id: 'f-op-1',
          severity: 'info',
          title: 'Where to run what',
          body: 'Backend completes 82% on Claude Code + Opus across 38 sessions in packages/worker/. Frontend (packages/web/) is most reliable on Cursor + Sonnet at roughly half the cost per session. Cross-package work drops 20 points regardless of tool, so split tasks at the package boundary when possible.',
          citations: [
            {
              type: 'metric',
              label: '82% / Claude Code + Opus',
              detail: 'packages/worker/, 38 sessions',
            },
            { type: 'metric', label: 'Cursor + Sonnet', detail: 'packages/web/, half the cost' },
            {
              type: 'session',
              label: '16 cross-package sessions',
              detail: '-20 pts vs single-package',
            },
          ],
          actions: [],
        },
        {
          id: 'f-op-2',
          severity: 'info',
          title: 'Memories to read first',
          body: 'Two memories are touched by most sessions in this repo. The do-rpc memory describes the native RPC pattern (not fetch). The auth-pattern memory documents JWT validation via checkAuth(). Read both before editing middleware or any DO method.',
          citations: [
            { type: 'memory', label: 'do-rpc', detail: 'touched by 14 sessions' },
            {
              type: 'memory',
              label: 'auth-pattern',
              detail: 'referenced in every middleware session',
            },
          ],
          actions: [],
        },
        {
          id: 'f-op-3',
          severity: 'warning',
          title: 'Hard zones',
          body: 'packages/worker/dos/team/ completes at 35%. Approach with context, prefer Opus, and read the memory bank first. packages/worker/src/router.ts has been reworked 9 times this month - consult the Failures report before editing.',
          citations: [
            { type: 'file', label: 'packages/worker/dos/team/', detail: '35% completion' },
            { type: 'file', label: 'packages/worker/src/router.ts', detail: 'reworked 9 times' },
          ],
          actions: [],
        },
      ],
      stats: {
        sessionsRead: 92,
        filesRead: 0,
        tokensUsed: 38_000,
        estimatedCost: 0.14,
        path: 'primary',
      },
    },

    'memory-hygiene': {
      runId: 'run-mh-001',
      reportId: 'memory-hygiene',
      summary:
        '19 memories are candidates for cleanup. 3 describe files that no longer exist, 8 have not been surfaced in any search in 60+ days, and 8 overlap with newer, more specific entries.',
      findings: [
        {
          id: 'f-mh-1',
          severity: 'warning',
          title: '3 memories reference files that no longer exist',
          body: 'Each references a path that was deleted or renamed more than a month ago. None has been used in a completed session since the delete. Safe to invalidate.',
          citations: [
            { type: 'memory', label: 'mem-k9x2 "auth-middleware"', detail: 'file deleted 0f06ff2' },
            { type: 'memory', label: 'mem-p3a8 "old-test-harness"', detail: 'file deleted' },
            { type: 'memory', label: 'mem-r7c1 "cli-init.old.js"', detail: 'file renamed' },
          ],
          actions: [
            { id: 'a-mh-1-state', category: 'state', label: 'Invalidate all 3' },
            { id: 'a-mh-1-export', category: 'export', label: 'Download decision log' },
          ],
        },
        {
          id: 'f-mh-2',
          severity: 'info',
          title: '8 memories have not been surfaced in any search in 60+ days',
          body: 'Prune candidates. None are tagged as load-bearing. Memory access patterns suggest these have been superseded by newer entries with better search recall.',
          citations: [
            { type: 'memory', label: '8 stale memories', detail: 'no hit in 60 days' },
            { type: 'metric', label: '0 searches / 0 uses', detail: 'this quarter' },
          ],
          actions: [
            { id: 'a-mh-2-state', category: 'state', label: 'Bulk archive' },
            { id: 'a-mh-2-export', category: 'export', label: 'Review list' },
          ],
        },
        {
          id: 'f-mh-3',
          severity: 'info',
          title: '8 memories overlap heavily with newer, more specific entries',
          body: 'Merge candidates. Newer memories are more recent, have higher access counts, and cite more specific file paths. The merge proposer has already drafted 3 suggestions waiting review.',
          citations: [
            { type: 'memory', label: '8 overlap pairs' },
            { type: 'metric', label: '3 drafted merges', detail: 'awaiting review' },
          ],
          actions: [
            { id: 'a-mh-3-state', category: 'state', label: 'Open merge proposals' },
            { id: 'a-mh-3-export', category: 'export', label: 'Copy finding' },
          ],
        },
      ],
      stats: {
        sessionsRead: 0,
        filesRead: 104,
        tokensUsed: 47_000,
        estimatedCost: 0.17,
        path: 'primary',
      },
    },
  };

  return { runs, completed };
}

export function createEmptyReports(): ReportsDemoData {
  return { runs: [], completed: {} };
}

// ── Pure helpers ────────────────────────────────────────────────────
//
// These take the payload as input so the same implementations work for
// every scenario. Call sites get their payload from useDemoReports().

export function getRunsForReport(data: ReportsDemoData, reportId: string): MockRun[] {
  return data.runs
    .filter((r) => r.reportId === reportId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getLatestRun(data: ReportsDemoData, reportId: string): MockRun | undefined {
  return getRunsForReport(data, reportId)[0];
}

export function getRun(data: ReportsDemoData, runId: string): MockRun | undefined {
  return data.runs.find((r) => r.id === runId);
}

export function getCompletedReport(
  data: ReportsDemoData,
  runId: string,
): CompletedReport | undefined {
  return Object.values(data.completed).find((r) => r.runId === runId);
}

export function getCompletedReportFor(
  data: ReportsDemoData,
  reportId: string,
): CompletedReport | undefined {
  return data.completed[reportId];
}
