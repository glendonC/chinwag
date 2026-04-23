// Mock completed report content for the 8 reports. Each one demonstrates
// the full finding pattern: concrete citations into chinmeister's own data and
// (where relevant) the user's codebase, plus actions split across
// state / export / spawn categories. Findings are deliberately varied in
// severity and action mix so the skeleton shows the full range of what a
// real report will look like.

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

  'cost-leak': {
    runId: 'run-cl-002',
    reportId: 'cost-leak',
    summary:
      "$89 of this fortnight's $234 in agent spend produced abandoned sessions. Two patterns account for 70% of the waste: Opus on small refactors, and Sonnet on multi-file debugging.",
    findings: [
      {
        id: 'f-cl-1',
        severity: 'critical',
        title: '$47 wasted on abandoned Opus refactor sessions',
        body: '8 Opus refactor sessions abandoned under 5 edits, averaging $5.90 each. Sonnet completed the same work type at 82% at roughly $0.18 per session. Routing small refactors to Sonnet would recover ~$38 per fortnight at this cadence.',
        citations: [
          { type: 'session', label: '8 abandoned sessions', detail: 'all Opus, all refactor' },
          { type: 'metric', label: '$47 abandoned / $5.90 avg', detail: 'waste on this cohort' },
          { type: 'metric', label: '82% / $0.18', detail: 'Sonnet comparison baseline' },
        ],
        actions: [
          { id: 'a-cl-1-state', category: 'state', label: 'Route refactors to Sonnet' },
          { id: 'a-cl-1-state-2', category: 'state', label: 'Save routing memory' },
          { id: 'a-cl-1-spawn', category: 'spawn', label: 'Test Sonnet on next refactor' },
        ],
      },
      {
        id: 'f-cl-2',
        severity: 'warning',
        title: 'Multi-file debugging on Sonnet costs 3x more than Opus to complete',
        body: 'Sonnet sessions touching 5+ files in debug work cost $2.40 on average and completed 58%. Opus on the same cohort cost $0.80 and completed 91%. Sonnet debugging appears to cascade context retries.',
        citations: [
          {
            type: 'session',
            label: '17 debug sessions',
            detail: '5+ files touched, mixed tools',
          },
          { type: 'metric', label: '$2.40 vs $0.80', detail: 'Sonnet vs Opus avg cost' },
          { type: 'metric', label: '58% / 91%', detail: 'completion rate' },
        ],
        actions: [
          { id: 'a-cl-2-state', category: 'state', label: 'Add multi-file debug routing rule' },
          { id: 'a-cl-2-export', category: 'export', label: 'Copy finding' },
        ],
      },
      {
        id: 'f-cl-3',
        severity: 'info',
        title: 'Cache hit rate dropped 18 points this fortnight',
        body: 'Cache reads are 38% of input tokens, down from 56% two weeks ago. The drop tracks with a new session-start pattern: CLAUDE.md is being re-read without reuse. Recovering the prior hit rate would save ~$14 per fortnight.',
        citations: [
          { type: 'metric', label: '56% -> 38%', detail: 'cache read / total input' },
          { type: 'session', label: '42 sessions', detail: 'with token data' },
        ],
        actions: [
          { id: 'a-cl-3-state', category: 'state', label: 'Save as memory' },
          { id: 'a-cl-3-spawn', category: 'spawn', label: 'Investigate with Claude Code' },
        ],
      },
      {
        id: 'f-cl-4',
        severity: 'info',
        title: 'Haiku handled 4 one-shot edits at $0.02 total',
        body: 'Small single-file edits routed to Haiku completed at 100% at an order of magnitude lower cost. Currently an accidental pattern — not covered by any routing rule.',
        citations: [
          { type: 'session', label: '4 Haiku sessions', detail: 'all completed, all single-file' },
          { type: 'metric', label: '$0.02 total', detail: '~$0.005 per session' },
        ],
        actions: [
          { id: 'a-cl-4-state', category: 'state', label: 'Formalize one-shot routing to Haiku' },
        ],
      },
    ],
    stats: {
      sessionsRead: 94,
      filesRead: 0,
      tokensUsed: 52_000,
      estimatedCost: 0.19,
      path: 'primary',
    },
  },

  'cross-tool-effectiveness': {
    runId: 'run-ct-001',
    reportId: 'cross-tool-effectiveness',
    summary:
      'Cursor leads on packages/web/ at 81% completion. Claude Code leads on packages/worker/ at 74%. Sessions that cross that boundary drop 20 points on average regardless of tool.',
    findings: [
      {
        id: 'f-ct-1',
        severity: 'info',
        title: 'Cursor completes packages/web/ at 81%; Claude Code at 63% on the same surface',
        body: 'Sampled across 42 sessions in the period. The gap is largest on CSS and component work; it shrinks on data-fetch layers. Model effect is smaller than tool effect in this zone.',
        citations: [
          { type: 'session', label: '42 sessions', detail: 'packages/web/ scope' },
          { type: 'file', label: 'packages/web/src/components/' },
          { type: 'metric', label: '81% / 63%', detail: 'Cursor vs Claude Code completion' },
        ],
        actions: [
          { id: 'a-ct-1-state', category: 'state', label: 'Save routing rule for web/' },
          { id: 'a-ct-1-export', category: 'export', label: 'Draft CLAUDE.md note' },
        ],
      },
      {
        id: 'f-ct-2',
        severity: 'info',
        title: 'Claude Code owns packages/worker/ at 74%; Cursor completes the same files at 48%',
        body: 'Concentrated on Durable Object code. Cursor sessions more often abandon when the agent needs to reason about RPC ownership semantics. Opus + Claude Code is the highest-completion combination on this surface.',
        citations: [
          { type: 'session', label: '38 sessions', detail: 'packages/worker/ scope' },
          { type: 'file', label: 'packages/worker/src/dos/' },
          { type: 'metric', label: '74% / 48%', detail: 'Claude Code vs Cursor completion' },
        ],
        actions: [
          { id: 'a-ct-2-state', category: 'state', label: 'Save routing rule for worker/' },
        ],
      },
      {
        id: 'f-ct-3',
        severity: 'warning',
        title: 'Cross-package work drops 20 points regardless of tool',
        body: 'Any session touching both packages/web/ and packages/worker/ in one go completes 20 points below the single-package baseline. The effect is tool-independent; splitting such tasks would recover most of the gap.',
        citations: [
          { type: 'session', label: '16 cross-package sessions' },
          { type: 'metric', label: '-20 pts', detail: 'vs single-package baseline' },
        ],
        actions: [
          { id: 'a-ct-3-state', category: 'state', label: 'Flag cross-package pattern' },
          { id: 'a-ct-3-spawn', category: 'spawn', label: 'Plan split with Claude Code' },
        ],
      },
    ],
    stats: {
      sessionsRead: 96,
      filesRead: 0,
      tokensUsed: 58_000,
      estimatedCost: 0.22,
      path: 'primary',
    },
  },

  'test-edit-gap': {
    runId: 'run-te-001',
    reportId: 'test-edit-gap',
    summary:
      'Three source files were edited heavily this fortnight with no corresponding test changes. Sessions touching them abandon 2.2x more often than the repo average.',
    findings: [
      {
        id: 'f-te-1',
        severity: 'critical',
        title: 'router.ts: 9 edits, no test changes in 4 months',
        body: 'routerTest.ts was last modified 2025-12-14. Sessions touching router.ts abandon at 38% versus a 17% repo average. The test file still covers the pre-migration surface.',
        citations: [
          {
            type: 'file',
            label: 'packages/worker/src/router.ts',
            detail: '9 edits this fortnight',
          },
          {
            type: 'file',
            label: 'packages/worker/src/routerTest.ts',
            detail: 'last touched 2025-12-14',
          },
          { type: 'metric', label: '38% / 17%', detail: 'abandonment vs repo average' },
        ],
        actions: [
          { id: 'a-te-1-state', category: 'state', label: 'Flag router.ts for test update' },
          { id: 'a-te-1-spawn', category: 'spawn', label: 'Add tests with Claude Code' },
          { id: 'a-te-1-export', category: 'export', label: 'Download gap report' },
        ],
      },
      {
        id: 'f-te-2',
        severity: 'warning',
        title: 'ConflictBanner.tsx: 6 edits, no test file exists',
        body: 'No test file was located for this component. The first edit of the period (2026-03-11) was a logic change to conflict-detection thresholds — exactly the kind of change a test would catch.',
        citations: [
          { type: 'file', label: 'packages/web/src/components/ConflictBanner/ConflictBanner.tsx' },
          { type: 'metric', label: '6 edits, 0 tests', detail: 'test file missing' },
        ],
        actions: [
          { id: 'a-te-2-state', category: 'state', label: 'Save test-scaffold memory' },
          { id: 'a-te-2-spawn', category: 'spawn', label: 'Scaffold tests with Claude Code' },
        ],
      },
      {
        id: 'f-te-3',
        severity: 'info',
        title: 'sessions.ts: 11 edits, 1 test change',
        body: 'Test coverage is present but the ratio of edits to test changes (11:1) is 4x the repo median of 2.7:1. Gap accumulating but not yet critical.',
        citations: [
          { type: 'file', label: 'packages/worker/src/dos/team/sessions.ts' },
          { type: 'metric', label: '11:1 ratio', detail: 'edits-to-test-changes' },
        ],
        actions: [{ id: 'a-te-3-state', category: 'state', label: 'Save note' }],
      },
    ],
    stats: {
      sessionsRead: 64,
      filesRead: 138,
      tokensUsed: 89_000,
      estimatedCost: 0.31,
      path: 'primary',
    },
  },

  'architecture-drift': {
    runId: 'run-ad-001',
    reportId: 'architecture-drift',
    summary:
      'Four memories describe patterns the code has moved past. Two were referenced in recent sessions before agents made now-incorrect edits.',
    findings: [
      {
        id: 'f-ad-1',
        severity: 'critical',
        title: 'do-rpc memory describes fetch-based calls; code migrated to native RPC',
        body: 'Memory mem-a7b2 claims DO communication uses fetch. The migration completed on 2026-02-04. Four sessions searched this memory this month; two made fetch-based edits before correcting.',
        citations: [
          {
            type: 'memory',
            label: 'mem-a7b2 "do-rpc-pattern"',
            detail: 'accessed 4 times this month',
          },
          { type: 'file', label: 'packages/worker/src/dos/team/', detail: 'migration site' },
          { type: 'session', label: '2 sessions', detail: 'made fetch-based edits' },
        ],
        actions: [
          { id: 'a-ad-1-state', category: 'state', label: 'Update memory to native RPC' },
          { id: 'a-ad-1-state-2', category: 'state', label: 'Supersede with current pattern' },
          { id: 'a-ad-1-spawn', category: 'spawn', label: 'Rewrite with Claude Code' },
        ],
      },
      {
        id: 'f-ad-2',
        severity: 'warning',
        title: 'auth-middleware memory references deleted file',
        body: 'Memory mem-k9x2 describes packages/worker/src/middleware/auth.ts. The file was removed in commit 0f06ff2. Memory still describes the pattern as current and was returned in 2 searches last week.',
        citations: [
          { type: 'memory', label: 'mem-k9x2 "auth-middleware"' },
          {
            type: 'file',
            label: 'packages/worker/src/middleware/auth.ts',
            detail: 'deleted 0f06ff2',
          },
        ],
        actions: [
          { id: 'a-ad-2-state', category: 'state', label: 'Mark memory invalid' },
          { id: 'a-ad-2-export', category: 'export', label: 'Copy finding' },
        ],
      },
      {
        id: 'f-ad-3',
        severity: 'info',
        title: 'work-type memory references old taxonomy (pre-migration 018)',
        body: 'Memory mem-p3a8 mentions a "planning" work-type category that was replaced by the 7-domain taxonomy in migration 018. Content still useful; category name is outdated.',
        citations: [
          { type: 'memory', label: 'mem-p3a8 "work-types"' },
          { type: 'metric', label: 'migration 018', detail: 'normalized at write time' },
        ],
        actions: [{ id: 'a-ad-3-state', category: 'state', label: 'Update memory' }],
      },
      {
        id: 'f-ad-4',
        severity: 'info',
        title: 'cli-init memory names old entry path',
        body: 'Memory mem-r7c1 names cli/init.old.js as the init entry; current entry is cli.jsx compiled to dist/cli.js. Low access count; low-risk correction.',
        citations: [
          { type: 'memory', label: 'mem-r7c1 "cli-init"' },
          { type: 'file', label: 'packages/cli/cli.jsx' },
        ],
        actions: [{ id: 'a-ad-4-state', category: 'state', label: 'Update memory path' }],
      },
    ],
    stats: {
      sessionsRead: 0,
      filesRead: 412,
      tokensUsed: 156_000,
      estimatedCost: 0.58,
      path: 'primary',
    },
  },

  'failure-forensics': {
    runId: 'run-ff-001',
    reportId: 'failure-forensics',
    summary:
      'Session a3f7b2 abandoned after 23 minutes and 11 tool calls. The inflection point was a Bash error at 8:42 UTC that the agent never verified before continuing to edit router.ts.',
    findings: [
      {
        id: 'f-ff-1',
        severity: 'critical',
        title: 'Inflection point at 8:42 UTC: Bash error on npm install never re-checked',
        body: 'The npm install failed with a peer-dependency conflict. The agent acknowledged the error in the next turn but made four subsequent Edit calls to router.ts assuming the install had succeeded. router.ts ended the session in a broken state the agent never verified.',
        citations: [
          { type: 'tool_call', label: 'Bash (npm install)', detail: '8:42 UTC — exit 1' },
          { type: 'tool_call', label: 'Edit x4', detail: 'router.ts, post-error' },
          { type: 'session', label: 'a3f7b2' },
        ],
        actions: [
          { id: 'a-ff-1-state', category: 'state', label: 'Save as anti-pattern memory' },
          { id: 'a-ff-1-spawn', category: 'spawn', label: 'Retry with pre-check context' },
        ],
      },
      {
        id: 'f-ff-2',
        severity: 'warning',
        title: 'Agent re-read router.ts only twice in 11 tool calls',
        body: 'The research-to-edit ratio on this session was 0.3 against a 2.5 session baseline for work of this type. Low file awareness compounded the Bash-error drift.',
        citations: [
          { type: 'session', label: 'a3f7b2', detail: 'research-to-edit ratio 0.3' },
          { type: 'metric', label: '0.3 / 2.5', detail: 'session vs baseline' },
        ],
        actions: [{ id: 'a-ff-2-state', category: 'state', label: 'Save as anti-pattern' }],
      },
      {
        id: 'f-ff-3',
        severity: 'info',
        title: 'Recommended next-session context',
        body: 'Start the retry with: (1) npm install + verify exit status, (2) run npm test to establish clean baseline, (3) re-read router.ts in full before the first edit. The original goal and the three prior edits are summarized below.',
        citations: [
          { type: 'session', label: 'a3f7b2 goal summary' },
          { type: 'file', label: 'packages/worker/src/router.ts', detail: 'end-state diff' },
        ],
        actions: [
          { id: 'a-ff-3-spawn', category: 'spawn', label: 'Launch retry with this context' },
          { id: 'a-ff-3-export', category: 'export', label: 'Copy context block' },
        ],
      },
    ],
    stats: {
      sessionsRead: 1,
      filesRead: 7,
      tokensUsed: 41_000,
      estimatedCost: 0.15,
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

export function getCompletedReport(runId: string): CompletedReport | undefined {
  return Object.values(MOCK_COMPLETED_REPORTS).find((r) => r.runId === runId);
}

export function getCompletedReportFor(reportId: string): CompletedReport | undefined {
  return MOCK_COMPLETED_REPORTS[reportId];
}
