// Base reports that ship with chinmeister.
//
// These 8 are starter recipes — each one is a fixed selection of chinmeister
// data points (sessions, memory access, conversation events, conflicts,
// file claims, tool calls, commits, costs) wired into a question worth
// asking. Each report is produced internally by a pipeline of one or
// more agents; users see a generated report, not the agents. The
// product story is not "we built 8 reports." The product story is
// "chinmeister's substrate is the only place this data lives, and here are
// 8 pre-composed views of it."
//
// Four of the eight run as pure worker-side aggregation over captured
// telemetry (Coordination Audit, Failure Analysis, Cost Leak, Cross-Tool
// Effectiveness). The other four additionally read the user's codebase
// via a spawned managed agent (Test-Edit Gap, Architecture Drift,
// Failure Forensics, Memory Hygiene). The catalog doesn't expose that
// split to users — it's a runtime execution detail.
//
// Custom reports (future): users will compose their own pipelines by
// selecting which chinmeister data points to track and what question to ask
// of them. The differentiator is the substrate, not the LLM — any model
// can analyze; only chinmeister has the cross-tool, cross-session,
// cross-developer data to feed it. When that ships, custom reports live
// alongside these base ones in the same catalog shape.

import { getColorHex } from '../../lib/utils.js';

export type ReportCategory = 'analysis' | 'management';

/** Number of agents in the pipeline that powers a report — 1 (solo), 2 (plan+challenge), or 3+ (swarm) */
export type AgentCount = 1 | 2 | 3;

/** Base = ships with chinmeister. Custom = user-composed (future). */
export type ReportKind = 'base' | 'custom';

export interface ReportDef {
  id: string;
  kind: ReportKind;
  name: string;
  tagline: string;
  description: string;
  category: ReportCategory;
  /** What data sources the pipeline reads */
  reads: string[];
  /** What it produces */
  produces: string[];
  /** Example insight that makes users go "oh shit" */
  exampleInsight: string;
  /** Recommended run frequency — prose form, shown in the detail view */
  frequency: string;
  /**
   * Recommended cadence in days — drives the catalog's freshness column.
   * null for trigger-based or on-demand reports that have no calendar cadence.
   */
  cadenceDays: number | null;
  /** chinmeister palette color name (red, cyan, yellow, etc.) — resolved via getColorHex */
  colorName: string;
  /** Pipeline stages this report runs internally */
  stages: string[];
}

/**
 * Derives the default agent count from a report's pipeline structure.
 * Pipelines with a "challenge" stage are inherently 2-agent runs
 * (one analyzes, one challenges the findings). All others default
 * to a single solo agent. 3+ swarm is always an opt-in escalation.
 */
export function getDefaultCount(report: ReportDef): AgentCount {
  return report.stages.includes('challenge') ? 2 : 1;
}

/** Resolves a report's palette color name to a hex value. */
export function reportHex(report: ReportDef): string {
  return getColorHex(report.colorName) ?? '#888';
}

export const REPORT_CATALOG: ReportDef[] = [
  {
    id: 'failure-analysis',
    kind: 'base',
    name: 'Failure Analysis',
    tagline: 'Where agents fail, why, and what works',
    description:
      'Files and directories where sessions fail, the root causes behind them, and the tool/model combinations that actually finish work there. Fires on demand or when outcome anomalies trigger it.',
    category: 'analysis',
    reads: [
      'Session outcomes',
      'File rework patterns',
      'Tool call errors',
      'Retry history',
      'Per-model outcomes',
      'Git commits',
    ],
    produces: [
      'Failure-ranked file map',
      'Root cause clusters',
      'Tool/model recommendations per area',
      'Memory update suggestions for hard zones',
    ],
    exampleInsight:
      'router.ts fails 40% on Sonnet, completes 78% on Opus. tests/ retried in 9 sessions this month, all from Read errors on locked files. Extending claim coverage would have prevented 11 abandonments.',
    frequency: 'Triggered by outcome anomalies, or run on demand',
    cadenceDays: null,
    colorName: 'red',
    stages: [
      'collect',
      'cluster-errors',
      'analyze-sessions',
      'root-cause',
      'synthesize',
      'challenge',
      'report',
    ],
  },
  {
    id: 'coordination-audit',
    kind: 'base',
    name: 'Coordination Audit',
    tagline: 'Where your agents collide',
    description:
      'File contention, claim coverage, and concurrent-edit cost across your team. Gated on 2+ active agents — solo users see this only when they run parallel sessions.',
    category: 'management',
    reads: [
      'Conflict data',
      'File claims & locks',
      'Concurrent agent windows',
      'Edit collisions',
      'Member analytics',
      'Git rework',
    ],
    produces: [
      'Coordination scorecard',
      'File contention hotspots',
      'Claim coverage recommendations',
      'Concurrent-edit cost breakdown',
    ],
    exampleInsight:
      'router.ts was edited by 3 agents in 3 days with no claim overlap. Seven lock-conflict retries on tests/ could have been prevented with a glob claim on tests/integration/.',
    frequency: 'Weekly for active teams',
    cadenceDays: 7,
    colorName: 'lavender',
    stages: ['collect', 'analyze-conflicts', 'analyze-claims', 'synthesize', 'report'],
  },
  {
    id: 'cost-leak',
    kind: 'base',
    name: 'Cost Leak',
    tagline: "Where your spend doesn't convert",
    description:
      'Sessions that burned tokens without producing finished work. Breaks abandoned spend down by model, tool, and work type, with routing recommendations.',
    category: 'analysis',
    reads: [
      'Session outcomes',
      'Token usage per session',
      'Pre-calculated + derived costs',
      'Model routing',
      'Work-type classification',
    ],
    produces: [
      'Abandoned-spend breakdown',
      'Per-model waste rate',
      'Routing recommendations',
      'Cost-per-completed-session trend',
    ],
    exampleInsight:
      "$47 of this week's $112 went to abandoned refactor sessions on Opus. Sonnet completed the same work type at 82% for a third of the cost.",
    frequency: 'Weekly',
    cadenceDays: 7,
    colorName: 'yellow',
    stages: ['collect', 'analyze-cost', 'correlate-outcomes', 'synthesize', 'report'],
  },
  {
    id: 'cross-tool-effectiveness',
    kind: 'base',
    name: 'Cross-Tool Effectiveness',
    tagline: 'What each tool does best here',
    description:
      "Per-tool, per-model performance scoped by file domain in this codebase. Requires 2+ tools in active use — solo-tool users won't see findings.",
    category: 'analysis',
    reads: [
      'Sessions by tool',
      'Session outcomes',
      'File domains touched',
      'Per-model performance per domain',
      'Work-type classification',
    ],
    produces: [
      'Tool-by-domain performance matrix',
      'Model recommendations per area',
      'Cross-boundary cost observations',
    ],
    exampleInsight:
      'Cursor completes packages/web/ at 81%; Claude Code completes packages/worker/ at 74%. Sessions that cross that boundary drop 20 points on average.',
    frequency: 'Bi-weekly',
    cadenceDays: 14,
    colorName: 'cyan',
    stages: ['collect', 'analyze-tools', 'analyze-domains', 'synthesize', 'report'],
  },
  {
    id: 'test-edit-gap',
    kind: 'base',
    name: 'Test-Edit Gap',
    tagline: 'Files edited without tests touched',
    description:
      'Source files edited across multiple sessions whose corresponding test files never changed. Reads the codebase to resolve test-source pairings. Correlates with abandonment and rework.',
    category: 'analysis',
    reads: ['Edit history', 'File tree', 'Git diffs', 'Session outcomes', 'Test-source pairings'],
    produces: [
      'Edited-but-untested file list',
      'Rework correlation',
      'Recommended test files to create',
    ],
    exampleInsight:
      'router.ts was edited in 9 sessions this month. routerTest.ts was last touched 4 months ago. Sessions touching router.ts abandon 2x more often than the repo average.',
    frequency: 'Bi-weekly',
    cadenceDays: 14,
    colorName: 'lime',
    stages: [
      'collect',
      'read-codebase',
      'pair-tests',
      'correlate-outcomes',
      'synthesize',
      'report',
    ],
  },
  {
    id: 'architecture-drift',
    kind: 'base',
    name: 'Architecture Drift',
    tagline: 'Where memory and code disagree',
    description:
      'Memories describe the system one way; current code has moved on. Surfaces memories that reference renamed symbols, deleted files, or patterns the code no longer follows.',
    category: 'analysis',
    reads: ['Memories', 'Source code', 'Git history', 'Memory access patterns'],
    produces: ['Outdated memory list', 'Recommended corrections', 'Memories to promote or retire'],
    exampleInsight:
      'The do-rpc memory references fetch-based calls; the code migrated to native RPC on 2026-02-04. 4 sessions this month searched this memory before making fetch-based edits.',
    frequency: 'Monthly',
    cadenceDays: 30,
    colorName: 'magenta',
    stages: [
      'collect',
      'read-codebase',
      'analyze-memories',
      'reconcile',
      'synthesize',
      'challenge',
      'report',
    ],
  },
  {
    id: 'failure-forensics',
    kind: 'base',
    name: 'Failure Forensics',
    tagline: 'Full postmortem of one session',
    description:
      'Pick any abandoned or failed session. Reconstructs the timeline with conversation, tool calls, git state, and file content before and after the critical moments.',
    category: 'analysis',
    reads: [
      'One session transcript',
      'Tool call sequence',
      'Pre/post file state',
      'Git diff at session window',
    ],
    produces: [
      'Annotated session timeline',
      'Inflection-point analysis',
      'Root cause hypothesis',
      'Suggested next-session context',
    ],
    exampleInsight:
      "Session a3f7b2 abandoned after 11 tool calls. The turning point was a Bash error at 8:42 UTC; the agent didn't re-read router.ts before the next edit and left it in a broken state.",
    frequency: 'On demand, per session',
    cadenceDays: null,
    colorName: 'orange',
    stages: [
      'read-session',
      'read-codebase',
      'reconstruct-timeline',
      'analyze-inflections',
      'synthesize',
      'report',
    ],
  },
  {
    id: 'memory-hygiene',
    kind: 'base',
    name: 'Memory Hygiene',
    tagline: 'Stale, unused, and superseded memories',
    description:
      'Memories never returned in search, never used in a completed session, or describing code that has since moved. Drives prune, merge, and promote actions.',
    category: 'management',
    reads: [
      'Memories',
      'Memory search history',
      'Session outcomes per memory',
      'Source code (file existence)',
    ],
    produces: ['Prune candidates', 'Merge candidates', 'Promote candidates', 'Stale-memory report'],
    exampleInsight:
      '14 memories have not been searched in 60 days. 3 describe files that no longer exist. 2 overlap heavily with newer, more specific memories.',
    frequency: 'Monthly',
    cadenceDays: 30,
    colorName: 'green',
    stages: ['collect', 'analyze-usage', 'reconcile-codebase', 'synthesize', 'report'],
  },
];
