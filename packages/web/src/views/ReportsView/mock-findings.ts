// Mock completed report content for the 7 reports. Each one demonstrates
// the full finding pattern: concrete citations into chinwag's own data and
// the user's codebase, plus actions split across state / export / spawn
// categories. Findings are deliberately varied in severity and action mix
// so the skeleton shows the full range of what a real report will look like.

import type { CompletedReport } from './types.js';

export const MOCK_COMPLETED_REPORTS: Record<string, CompletedReport> = {
  'failure-hotspots': {
    runId: 'run-fh-003',
    reportId: 'failure-hotspots',
    summary:
      "Three files account for 62% of this month's abandoned sessions. One is a model-fit problem, one is a test-locking gap, one is a churn signal that needs team attention.",
    findings: [
      {
        id: 'f-fh-1',
        severity: 'critical',
        title: 'router.ts reworked in 9 sessions — 78% completion on Opus, 40% on Sonnet',
        body: 'Every failed attempt was a Sonnet session that ran out of context before reaching a working edit. The Opus runs completed in half the tool calls.',
        citations: [
          { type: 'file', label: 'packages/worker/src/router.ts', detail: '9 edits · 3 rewrites' },
          { type: 'session', label: '9 sessions', detail: 'a3f7b2 · e8c104 · 5d2a91 · +6 more' },
          { type: 'metric', label: '78% / 40%', detail: 'Opus vs Sonnet completion rate' },
        ],
        actions: [
          { id: 'a-fh-1-state', category: 'state', label: 'Save as memory' },
          { id: 'a-fh-1-route', category: 'state', label: 'Route this file to Opus' },
          { id: 'a-fh-1-spawn', category: 'spawn', label: 'Review router.ts with Claude Code' },
        ],
      },
      {
        id: 'f-fh-2',
        severity: 'critical',
        title: 'tests/integration/ has 5× the retry rate of tests/unit/',
        body: 'Every retry was a Read error on a locked test file. Extending claim coverage to tests/ would have prevented 11 abandonments this month.',
        citations: [
          {
            type: 'file',
            label: 'packages/worker/tests/integration/',
            detail: '14 sessions · 47 retries',
          },
          {
            type: 'conflict',
            label: '11 lock-conflict retries',
            detail: 'Read errors on locked files',
          },
          { type: 'tool_call', label: 'Read', detail: '47 failed calls · avg 1.2s timeout' },
        ],
        actions: [
          { id: 'a-fh-2-state', category: 'state', label: 'Extend claim coverage to tests/' },
          { id: 'a-fh-2-export', category: 'export', label: 'Download conflict log' },
        ],
      },
      {
        id: 'f-fh-3',
        severity: 'warning',
        title: 'ConflictBanner.tsx: 4 concurrent-edit conflicts this week',
        body: 'Two agents touched this file within a 30-second window on four separate occasions. No coordination message was exchanged on any of them.',
        citations: [
          { type: 'file', label: 'packages/web/src/components/ConflictBanner/ConflictBanner.tsx' },
          { type: 'conflict', label: '4 concurrent edits', detail: 'session pairs · 30s window' },
        ],
        actions: [
          { id: 'a-fh-3-state', category: 'state', label: 'Create watcher for this file' },
          { id: 'a-fh-3-state-2', category: 'state', label: 'Flag for refactor' },
        ],
      },
      {
        id: 'f-fh-4',
        severity: 'info',
        title: 'Session warmup is 2.1× slower on first edit in packages/worker/dos/',
        body: 'Agents spend an average of 94 seconds reading before first edit in this directory. Compared to 44 seconds elsewhere.',
        citations: [
          { type: 'metric', label: '94s vs 44s', detail: 'time-to-first-edit' },
          { type: 'session', label: '23 sessions sampled' },
        ],
        actions: [
          { id: 'a-fh-4-state', category: 'state', label: 'Save as memory' },
          { id: 'a-fh-4-export', category: 'export', label: 'Draft CLAUDE.md note' },
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

  'prompt-coach': {
    runId: 'run-pc-001',
    reportId: 'prompt-coach',
    summary:
      'Your strongest pattern: specifying file paths in the first message. Your weakest: compound goals in a single prompt. Two small habit changes would lift completion by an estimated 18 points.',
    findings: [
      {
        id: 'f-pc-1',
        severity: 'info',
        title: 'Sessions that specify file paths first complete at 78% vs 45% without',
        body: 'The correlation is strongest on bugfix and refactor work. Feature work is less affected. The effect is consistent across Claude Code and Cursor.',
        citations: [
          { type: 'session', label: '47 sessions', detail: 'path-first vs exploratory opener' },
          { type: 'metric', label: '78% / 45%', detail: 'completion rate delta' },
        ],
        actions: [
          { id: 'a-pc-1-export', category: 'export', label: 'Draft CLAUDE.md rule' },
          { id: 'a-pc-1-state', category: 'state', label: 'Save as personal reminder' },
        ],
      },
      {
        id: 'f-pc-2',
        severity: 'warning',
        title: 'Compound goals in first message correlate with 3× abandonment before turn 5',
        body: '"Also can you..." patterns triple the abandonment rate on debugging tasks. Single-goal openings resolve in half the turns on average.',
        citations: [
          { type: 'session', label: '18 abandoned sessions' },
          { type: 'metric', label: '3× abandonment', detail: 'compound vs single-goal opener' },
        ],
        actions: [
          { id: 'a-pc-2-state', category: 'state', label: 'Save as anti-pattern memory' },
          { id: 'a-pc-2-export', category: 'export', label: 'Copy finding' },
        ],
      },
      {
        id: 'f-pc-3',
        severity: 'info',
        title: 'Frustration markers before turn 5 → 3× higher abandonment',
        body: 'Phrases like "still not working", "why doesn\'t", "it keeps" appearing in the first five turns are a strong leading indicator. Concentrated in sessions under tests/.',
        citations: [
          { type: 'session', label: '14 sessions · 9 abandoned' },
          { type: 'file', label: 'tests/integration/', detail: 'concentration zone' },
        ],
        actions: [
          { id: 'a-pc-3-state', category: 'state', label: 'Create watcher for this pattern' },
          { id: 'a-pc-3-spawn', category: 'spawn', label: 'Investigate tests/ with Claude Code' },
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

  'roi-optimizer': {
    runId: 'run-cost-002',
    reportId: 'roi-optimizer',
    summary:
      'Cursor + Sonnet handles 60% of your work at 1/5 the cost of Opus. Two routing rules would save an estimated $83/month without changing completion rate.',
    findings: [
      {
        id: 'f-cost-1',
        severity: 'info',
        title: 'Frontend edits under 3 files: Cursor + Sonnet matches Opus completion, 5× cheaper',
        body: 'No meaningful completion gap between the two for small-scope frontend work. Projected savings: $47/month if routed automatically.',
        citations: [
          { type: 'session', label: '23 sessions', detail: 'packages/web · ≤ 3 files' },
          { type: 'metric', label: '$0.20 vs $1.00', detail: 'avg cost per completed session' },
          { type: 'metric', label: '82% vs 84%', detail: 'completion rate' },
        ],
        actions: [
          { id: 'a-cost-1-state', category: 'state', label: 'Apply routing rule' },
          { id: 'a-cost-1-state-2', category: 'state', label: 'Save as memory' },
          { id: 'a-cost-1-export', category: 'export', label: 'Download projection' },
        ],
      },
      {
        id: 'f-cost-2',
        severity: 'warning',
        title: 'Claude Code + Opus on single-file test edits is 5× the needed spend',
        body: 'Sonnet completes these at the same rate for $0.18 average vs $0.85 for Opus.',
        citations: [
          { type: 'session', label: '18 sessions', detail: 'test files · 1-2 file scope' },
          { type: 'metric', label: '$0.85 → $0.18', detail: 'per-session cost' },
        ],
        actions: [
          { id: 'a-cost-2-state', category: 'state', label: 'Route tests to Sonnet' },
          { id: 'a-cost-2-export', category: 'export', label: 'Copy finding' },
        ],
      },
      {
        id: 'f-cost-3',
        severity: 'info',
        title: 'Above 4 files in scope, Opus completes 30% more often — extra cost pays for itself',
        body: 'The break-even scope is exactly 4 files. Rules below that line → Sonnet. Rules above → Opus. No inverse reasoning needed.',
        citations: [
          { type: 'metric', label: '4 files', detail: 'break-even point' },
          { type: 'session', label: '62 sessions sampled' },
        ],
        actions: [{ id: 'a-cost-3-state', category: 'state', label: 'Save routing heuristic' }],
      },
    ],
    stats: {
      sessionsRead: 214,
      filesRead: 6,
      tokensUsed: 58_000,
      estimatedCost: 0.22,
      path: 'primary',
    },
  },

  'knowledge-health': {
    runId: 'run-mem-001',
    reportId: 'knowledge-health',
    summary:
      "14 memories haven't been read in 60+ days and are averaging 8K tokens of context bloat per session. Your top 5 memories correlate with +28% completion rate.",
    findings: [
      {
        id: 'f-mem-1',
        severity: 'critical',
        title: '14 memories unused in 60+ days, ~8K tokens of context overhead per session',
        body: 'Every managed agent session loads them into context. Archiving would reduce average prompt size by ~12% on bigger sessions.',
        citations: [
          { type: 'memory', label: '14 memory IDs', detail: 'mem-a3f2 · mem-b81c · +12 more' },
          { type: 'metric', label: '~8K tokens', detail: 'per-session context overhead' },
        ],
        actions: [
          { id: 'a-mem-1-state', category: 'state', label: 'Review & archive' },
          { id: 'a-mem-1-state-2', category: 'state', label: 'Snooze 30 days' },
        ],
      },
      {
        id: 'f-mem-2',
        severity: 'info',
        title:
          'Memories tagged "auth" appear in 80% of completed auth sessions, 12% of failed ones',
        body: 'Strongest positive signal in the memory bank. Write more like these.',
        citations: [
          { type: 'memory', label: '5 memories · tag: auth' },
          { type: 'metric', label: '80% / 12%', detail: 'presence in completed vs failed' },
        ],
        actions: [
          { id: 'a-mem-2-state', category: 'state', label: 'Pin these memories' },
          { id: 'a-mem-2-state-2', category: 'state', label: 'Save pattern as rule' },
        ],
      },
      {
        id: 'f-mem-3',
        severity: 'warning',
        title: 'No memories about the DO RPC pattern despite 34 sessions touching DO code',
        body: 'The coding convention is in CLAUDE.md but not surfaced as a memory, so only Claude Code reads it. Cursor sessions are missing this context.',
        citations: [
          { type: 'file', label: 'CLAUDE.md', detail: 'DO RPC section' },
          { type: 'session', label: '34 DO sessions', detail: '11 Cursor · 23 Claude Code' },
        ],
        actions: [
          { id: 'a-mem-3-export', category: 'export', label: 'Draft memory from CLAUDE.md' },
          { id: 'a-mem-3-state', category: 'state', label: 'Save now' },
        ],
      },
    ],
    stats: {
      sessionsRead: 98,
      filesRead: 4,
      tokensUsed: 42_000,
      estimatedCost: 0.16,
      path: 'primary',
    },
  },

  'coordination-auditor': {
    runId: 'run-coord-placeholder',
    reportId: 'coordination-auditor',
    summary:
      "Cross-tool handoffs on router.ts are 16 points below single-tool baseline. Three files account for most of the team's concurrent-edit conflicts.",
    findings: [
      {
        id: 'f-coord-1',
        severity: 'warning',
        title: 'Cursor → Claude Code handoffs on router.ts complete at 62% vs 78% single-tool',
        body: 'The handoff pattern loses 16 points. Both tools produce working code alone; the context lost at the handoff is the cost.',
        citations: [
          { type: 'file', label: 'packages/worker/src/router.ts' },
          { type: 'session', label: '14 handoffs', detail: 'Cursor → Claude Code' },
        ],
        actions: [
          { id: 'a-coord-1-state', category: 'state', label: 'Assign file owner' },
          { id: 'a-coord-1-state-2', category: 'state', label: 'Flag for refactor' },
          { id: 'a-coord-1-spawn', category: 'spawn', label: 'Investigate with Claude Code' },
        ],
      },
      {
        id: 'f-coord-2',
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
          { id: 'a-coord-2-state', category: 'state', label: 'Create watchers' },
          { id: 'a-coord-2-export', category: 'export', label: 'Download conflict report' },
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

  'failure-patterns': {
    runId: 'run-rca-002',
    reportId: 'failure-patterns',
    summary:
      '30% of your failed sessions trace to one pattern: Read errors on locked test files. Two other patterns account for another 22%.',
    findings: [
      {
        id: 'f-rca-1',
        severity: 'critical',
        title: '30% of failed sessions: Read errors on locked files in tests/',
        body: 'Same conflict pattern caused 11 abandonments this month. Extending claim coverage to tests/ would prevent most of them.',
        citations: [
          { type: 'tool_call', label: 'Read', detail: '47 failed calls · tests/ directory' },
          { type: 'conflict', label: '11 abandonments', detail: 'same lock pattern' },
          { type: 'session', label: '14 failed sessions' },
        ],
        actions: [
          { id: 'a-rca-1-state', category: 'state', label: 'Extend claim coverage' },
          { id: 'a-rca-1-state-2', category: 'state', label: 'Create watcher' },
          { id: 'a-rca-1-export', category: 'export', label: 'Download incident summary' },
        ],
      },
      {
        id: 'f-rca-2',
        severity: 'warning',
        title: 'Sonnet sessions abandon 2.3× more often after their first Bash error',
        body: 'The error cascade is specific to Sonnet. Opus and Haiku recover from the same errors. Concentrated in shell-heavy tasks.',
        citations: [
          { type: 'tool_call', label: 'Bash', detail: 'error cascade signature' },
          { type: 'session', label: '9 Sonnet abandonments' },
        ],
        actions: [
          { id: 'a-rca-2-state', category: 'state', label: 'Save as model warning' },
          { id: 'a-rca-2-spawn', category: 'spawn', label: 'Debug pattern with Claude Code' },
        ],
      },
    ],
    stats: {
      sessionsRead: 134,
      filesRead: 23,
      tokensUsed: 95_000,
      estimatedCost: 0.34,
      path: 'primary',
    },
  },

  'onboarding-brief': {
    runId: 'run-ob-001',
    reportId: 'onboarding-brief',
    summary:
      'Start with the auth and router memories before touching packages/worker/. Your team runs Opus for worker code and Sonnet+Cursor for the web package. Three files need extra care.',
    findings: [
      {
        id: 'f-ob-1',
        severity: 'info',
        title: 'Read these 5 memories before touching packages/worker/',
        body: 'The DO RPC pattern, the idempotent schema guard, and the three auth notes are load-bearing across the worker package.',
        citations: [
          { type: 'memory', label: '5 memories', detail: 'tag: auth · tag: do-rpc · tag: schema' },
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
        body: 'Inferred from completion rates. Matches what the Cost Allocation report recommends.',
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
