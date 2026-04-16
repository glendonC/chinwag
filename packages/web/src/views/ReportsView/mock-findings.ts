// Mock completed report content for the 4 reports. Each one demonstrates
// the full finding pattern: concrete citations into chinwag's own data and
// the user's codebase, plus actions split across state / export / spawn
// categories. Findings are deliberately varied in severity and action mix
// so the skeleton shows the full range of what a real report will look like.

import type { CompletedReport } from './types.js';

export const MOCK_COMPLETED_REPORTS: Record<string, CompletedReport> = {
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
          { type: 'file', label: 'packages/web/src/components/ConflictBanner/ConflictBanner.tsx' },
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

  'prompt-patterns': {
    runId: 'run-pp-001',
    reportId: 'prompt-patterns',
    summary:
      'Sessions with file paths in the first message complete at 78% vs 45% without. Compound goals triple abandonment before turn 5. Correlation observed across 89 sessions.',
    findings: [
      {
        id: 'f-pp-1',
        severity: 'info',
        title: 'Sessions that specify file paths first complete at 78% vs 45% without',
        body: 'The correlation is strongest on bugfix and refactor work. Feature work is less affected. The effect is consistent across Claude Code and Cursor. Correlation observed in 47 sessions, not established cause.',
        citations: [
          { type: 'session', label: '47 sessions', detail: 'path-first vs exploratory opener' },
          { type: 'metric', label: '78% / 45%', detail: 'completion rate delta' },
        ],
        actions: [
          { id: 'a-pp-1-export', category: 'export', label: 'Draft CLAUDE.md rule' },
          { id: 'a-pp-1-state', category: 'state', label: 'Save as personal reminder' },
        ],
      },
      {
        id: 'f-pp-2',
        severity: 'warning',
        title: 'Compound goals in first message correlate with 3x abandonment before turn 5',
        body: '"Also can you..." patterns triple the abandonment rate on debugging tasks. Single-goal openings resolve in half the turns on average. Correlation observed in 18 sessions.',
        citations: [
          { type: 'session', label: '18 abandoned sessions' },
          { type: 'metric', label: '3x abandonment', detail: 'compound vs single-goal opener' },
        ],
        actions: [
          { id: 'a-pp-2-state', category: 'state', label: 'Save as anti-pattern memory' },
          { id: 'a-pp-2-export', category: 'export', label: 'Copy finding' },
        ],
      },
      {
        id: 'f-pp-3',
        severity: 'info',
        title: 'Frustration markers before turn 5 correlate with 3x higher abandonment',
        body: 'Phrases like "still not working", "why doesn\'t", "it keeps" appearing in the first five turns are a strong leading indicator. Concentrated in sessions under tests/. Correlation observed in 14 sessions.',
        citations: [
          { type: 'session', label: '14 sessions, 9 abandoned' },
          { type: 'file', label: 'tests/integration/', detail: 'concentration zone' },
        ],
        actions: [
          { id: 'a-pp-3-state', category: 'state', label: 'Create watcher for this pattern' },
          { id: 'a-pp-3-spawn', category: 'spawn', label: 'Investigate tests/ with Claude Code' },
        ],
      },
    ],
    stats: {
      sessionsRead: 89,
      filesRead: 12,
      tokensUsed: 76_000,
      estimatedCost: 0.28,
      path: 'primary',
    },
  },

  'coordination-audit': {
    runId: 'run-ca-placeholder',
    reportId: 'coordination-audit',
    summary:
      "Cross-tool handoffs on router.ts are 16 points below single-tool baseline. Three files account for most of the team's concurrent-edit conflicts.",
    findings: [
      {
        id: 'f-ca-1',
        severity: 'warning',
        title: 'Cursor to Claude Code handoffs on router.ts complete at 62% vs 78% single-tool',
        body: 'The handoff pattern loses 16 points. Both tools produce working code alone; the context lost at the handoff is the cost.',
        citations: [
          { type: 'file', label: 'packages/worker/src/router.ts' },
          { type: 'session', label: '14 handoffs', detail: 'Cursor to Claude Code' },
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
        body: 'router.ts, ProjectView.tsx, and tool-registry.ts. All cross-package or cross-layer files.',
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
    runId: 'run-ob-001',
    reportId: 'onboarding-brief',
    summary:
      'Start with the auth and DO-RPC memories before touching packages/worker/. Your team runs Opus for worker code and Sonnet+Cursor for the web package. Three files need extra care.',
    findings: [
      {
        id: 'f-ob-1',
        severity: 'info',
        title: 'Read these 5 memories before touching packages/worker/',
        body: 'The DO RPC pattern, the idempotent schema guard, and the three auth notes are load-bearing across the worker package.',
        citations: [
          { type: 'memory', label: '5 memories', detail: 'tag: auth, tag: do-rpc, tag: schema' },
          { type: 'file', label: 'packages/worker/' },
        ],
        actions: [
          { id: 'a-ob-1-state', category: 'state', label: 'Pin these memories' },
          { id: 'a-ob-1-export', category: 'export', label: 'Download onboarding pack' },
        ],
      },
      {
        id: 'f-ob-2',
        severity: 'info',
        title: 'Team routing: Opus for packages/worker/, Sonnet+Cursor for packages/web/',
        body: 'Inferred from completion rates across 247 sessions.',
        citations: [
          {
            type: 'metric',
            label: '82% / 84%',
            detail: 'worker vs web completion on recommended routing',
          },
        ],
        actions: [{ id: 'a-ob-2-state', category: 'state', label: 'Apply team routing rules' }],
      },
    ],
    stats: {
      sessionsRead: 247,
      filesRead: 18,
      tokensUsed: 68_000,
      estimatedCost: 0.25,
      path: 'primary',
    },
  },
};

export function getCompletedReport(runId: string): CompletedReport | undefined {
  return Object.values(MOCK_COMPLETED_REPORTS).find((r) => r.runId === runId);
}

export function getCompletedReportFor(reportId: string): CompletedReport | undefined {
  return MOCK_COMPLETED_REPORTS[reportId];
}
