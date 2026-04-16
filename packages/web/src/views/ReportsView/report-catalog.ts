// Base reports that ship with chinwag.
//
// These 7 are starter recipes — each one is a fixed selection of chinwag
// data points (sessions, memory access, conversation events, conflicts,
// file claims, tool calls, commits, costs) wired into a question worth
// asking. Each report is produced internally by a pipeline of one or
// more agents; users see a generated report, not the agents. The
// product story is not "we built 7 reports." The product story is
// "chinwag's substrate is the only place this data lives, and here are
// 7 pre-composed views of it."
//
// Custom reports (future): users will compose their own pipelines by
// selecting which chinwag data points to track and what question to ask
// of them. The differentiator is the substrate, not the LLM — any model
// can analyze; only chinwag has the cross-tool, cross-session,
// cross-developer data to feed it. When that ships, custom reports live
// alongside these base ones in the same catalog shape.

import { getColorHex } from '../../lib/utils.js';

export type ReportCategory = 'analysis' | 'management';

/** Number of agents in the pipeline that powers a report — 1 (solo), 2 (plan+challenge), or 3+ (swarm) */
export type AgentCount = 1 | 2 | 3;

/** Base = ships with chinwag. Custom = user-composed (future). */
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
   * null for one-time reports (e.g. onboarding brief) that have no cadence.
   */
  cadenceDays: number | null;
  /** chinwag palette color name (red, cyan, yellow, etc.) — resolved via getColorHex */
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
      'Files and directories where sessions fail, the root causes behind them, and the tool/model combinations that actually finish work there.',
    category: 'analysis',
    reads: [
      'Session outcomes',
      'File rework patterns',
      'Tool call errors',
      'Conversation sentiment',
      'Retry history',
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
    frequency: 'Monthly or after major refactors',
    cadenceDays: 30,
    colorName: 'red',
    stages: [
      'collect',
      'analyze-code',
      'analyze-sessions',
      'root-cause',
      'synthesize',
      'challenge',
      'report',
    ],
  },
  {
    id: 'prompt-patterns',
    kind: 'base',
    name: 'Prompt Patterns',
    tagline: 'What communication patterns correlate with success',
    description:
      'How your communication patterns map to session outcomes across tools. Correlation, not prescription.',
    category: 'analysis',
    reads: [
      'Conversation logs',
      'Session outcomes',
      'Sentiment data',
      'Prompt efficiency',
      'Tool call patterns',
    ],
    produces: [
      'Pattern observations',
      'Anti-pattern warnings',
      'Per-work-type communication patterns',
    ],
    exampleInsight:
      'Sessions with file paths in the first message complete at 78% vs 45% without. Frustration before turn 5 correlates with 3x abandonment, concentrated in debugging tasks.',
    frequency: 'Bi-weekly',
    cadenceDays: 14,
    colorName: 'blue',
    stages: [
      'collect',
      'analyze-conversations',
      'correlate-outcomes',
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
      'File contention, claim coverage, tool handoff friction, and what coordination costs across your team.',
    category: 'management',
    reads: [
      'Conflict data',
      'File claims & locks',
      'Tool handoffs',
      'Concurrent edits',
      'Member analytics',
      'Git rework',
    ],
    produces: [
      'Coordination scorecard',
      'Handoff friction analysis',
      'File contention hotspots',
      'Claim coverage recommendations',
    ],
    exampleInsight:
      'Cursor to Claude Code handoffs on the same file complete at 62% vs 78% for single-tool sessions. router.ts was edited by 3 agents in 3 days.',
    frequency: 'Weekly for active teams',
    cadenceDays: 7,
    colorName: 'lavender',
    stages: ['collect', 'analyze-conflicts', 'analyze-handoffs', 'synthesize', 'report'],
  },
  {
    id: 'onboarding-brief',
    kind: 'base',
    name: 'Onboarding Brief',
    tagline: 'Skip the first-week ramp',
    description:
      "What works where, the memories that matter, the hard zones, all from your team's real agent activity.",
    category: 'management',
    reads: [
      'All memories',
      'Team analytics',
      'Tool/model performance',
      'Session patterns',
      'Codebase heatmaps',
    ],
    produces: [
      'Onboarding brief document',
      'Tool/model recommendations',
      'Key memories to read',
      'Difficulty zone map',
    ],
    exampleInsight:
      'Backend: Claude Code + Opus (82% completion). Frontend: Cursor + Sonnet at half the cost. Read the auth-pattern and DO-RPC memories before touching middleware/.',
    frequency: 'One-time per project join',
    cadenceDays: null,
    colorName: 'sky',
    stages: [
      'collect',
      'analyze-team',
      'analyze-codebase',
      'analyze-patterns',
      'synthesize',
      'challenge',
      'report',
    ],
  },
];
