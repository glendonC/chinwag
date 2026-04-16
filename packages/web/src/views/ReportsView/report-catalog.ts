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

export type ReportCategory = 'analysis' | 'optimization' | 'management';

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
    id: 'failure-hotspots',
    kind: 'base',
    name: 'Failure Hotspots',
    tagline: 'Where your agents keep failing',
    description:
      'Files and directories where sessions fail, plus the tool and model that actually finish work there.',
    category: 'analysis',
    reads: ['Session outcomes', 'File rework patterns', 'Stuckness data', 'Tool/model performance'],
    produces: [
      'Failure-ranked file map',
      'Tool/model recommendations per area',
      'Memory updates for hard zones',
    ],
    exampleInsight:
      'Sessions touching packages/worker/dos/team/ fail 40% of the time on Sonnet but complete 78% on Opus. router.ts has been reworked in 9 sessions this month — concentrate review there.',
    frequency: 'Monthly or after major refactors',
    cadenceDays: 30,
    colorName: 'red',
    stages: ['collect', 'analyze-code', 'analyze-sessions', 'synthesize', 'challenge', 'report'],
  },
  {
    id: 'prompt-coach',
    kind: 'base',
    name: 'Prompt Effectiveness',
    tagline: 'What completes sessions, what derails them',
    description:
      'How your communication style maps to session outcomes, across every tool you use.',
    category: 'optimization',
    reads: ['Conversation logs', 'Session outcomes', 'Sentiment data', 'Prompt efficiency metrics'],
    produces: [
      'Effectiveness report',
      'Personalized playbook by work type',
      'Anti-pattern warnings',
      'Memory: effective patterns',
    ],
    exampleInsight:
      'Sessions where you specify file paths in the first message complete at 78% vs 45% without. When frustration appears before turn 5, abandonment jumps 3x — concentrated in debugging tasks under tests/.',
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
    id: 'roi-optimizer',
    kind: 'base',
    name: 'Cost Allocation',
    tagline: 'Cheapest tool that finishes the job',
    description:
      'Real outcomes per tool and model, scoped to your codebase, with concrete spend recommendations.',
    category: 'optimization',
    reads: [
      'Session outcomes by tool/model',
      'Token usage & cost',
      'Work type distribution',
      'Scope complexity',
    ],
    produces: [
      'Tool/model allocation matrix',
      'Cost savings projections',
      'Per-work-type recommendations',
    ],
    exampleInsight:
      'Cursor + Sonnet handles frontend edits under 3 files at $0.20/session with the same completion rate as Claude Code + Opus at $1.00. Above 4 files, Opus completes 30% more often — the extra cost pays for itself.',
    frequency: 'Monthly or when adding new tools',
    cadenceDays: 30,
    colorName: 'green',
    stages: [
      'collect',
      'analyze-tools',
      'analyze-costs',
      'model-comparison',
      'synthesize',
      'report',
    ],
  },
  {
    id: 'knowledge-health',
    kind: 'base',
    name: 'Memory Effectiveness',
    tagline: 'Which memories actually help',
    description:
      'Ranks shared memory by what correlates with completed sessions, and flags what just clutters context.',
    category: 'management',
    reads: ['All memories', 'Memory access patterns', 'Search hit rates', 'Session outcomes'],
    produces: [
      'High-impact memory ranking',
      'Coverage gap identification',
      'Underperforming memory candidates',
    ],
    exampleInsight:
      'Memories tagged auth appear in 80% of completed auth sessions but only 12% of failed ones — write more like these. 14 memories have not been read in 60 days and are crowding out useful context every session.',
    frequency: 'Monthly',
    cadenceDays: 30,
    colorName: 'magenta',
    stages: [
      'collect',
      'analyze-quality',
      'analyze-usage',
      'cross-ref-codebase',
      'synthesize',
      'challenge',
      'report',
    ],
  },
  {
    id: 'coordination-auditor',
    kind: 'base',
    name: 'Coordination Audit',
    tagline: 'Where your agents collide',
    description: 'File contention, claim coverage, and tool handoff friction across your team.',
    category: 'management',
    reads: [
      'Conflict data',
      'File claims & locks',
      'Tool handoffs',
      'Concurrent edits',
      'Member analytics',
    ],
    produces: [
      'Coordination scorecard',
      'Handoff friction analysis',
      'File contention hotspots',
      'Team workflow recommendations',
    ],
    exampleInsight:
      'Cursor→Claude Code handoffs on the same file complete at 62% vs 78% for single-tool sessions. router.ts was edited by 3 agents in 3 days — assign ownership or refactor.',
    frequency: 'Weekly for active teams',
    cadenceDays: 7,
    colorName: 'lavender',
    stages: ['collect', 'analyze-conflicts', 'analyze-handoffs', 'synthesize', 'report'],
  },
  {
    id: 'failure-patterns',
    kind: 'base',
    name: 'Root Cause Analysis',
    tagline: 'Why your sessions keep breaking',
    description:
      'Recurring root causes across your failed sessions — by file zone, tool, model, and conversation pattern.',
    category: 'analysis',
    reads: [
      'Failed/abandoned sessions',
      'Conversation logs',
      'Tool call errors',
      'Edit patterns',
      'Retry history',
    ],
    produces: [
      'Recurring failure clusters',
      'Root cause classification',
      'Prevention recommendations',
      'Memory: failure patterns',
    ],
    exampleInsight:
      '30% of your failed sessions happen in test files on Sonnet, all involving Read errors on locked files. The same conflict pattern caused 11 abandonments this month — claim coverage in tests/ is the fix.',
    frequency: 'Weekly',
    cadenceDays: 7,
    colorName: 'yellow',
    stages: [
      'collect',
      'analyze-failures',
      'analyze-conversations',
      'root-cause',
      'synthesize',
      'report',
    ],
  },
  {
    id: 'onboarding-brief',
    kind: 'base',
    name: 'Onboarding Brief',
    tagline: 'Skip the first-week ramp',
    description:
      "A starter pack from your team's real agent activity — what works where, the memories that matter, the hard zones.",
    category: 'management',
    reads: ['All memories', 'Team analytics', 'Tool/model performance', 'Session patterns'],
    produces: [
      'Onboarding brief',
      'Tool/model recommendations',
      'Key memories summary',
      'Difficulty zone map',
      'Memory: onboarding snapshot',
    ],
    exampleInsight:
      'Backend team runs Claude Code + Opus for API work (82% completion). Frontend leans on Cursor + Sonnet at half the cost with the same success rate. Read the auth-pattern memories before touching middleware/.',
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
