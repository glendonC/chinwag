// Each entry is a base report: stable id, display name, tagline,
// action scope, and toggleable sections. A subscription combines
// (report, sections, cadence, channel) into a scheduled notification.
//
// kind: 'custom' is reserved for user-composed reports. No composer
// ships today, and ad-hoc questions are handled by a separate
// natural-language chat surface over the same data.

import { getColorHex } from '../../lib/utils.js';

export type ReportCategory = 'analysis' | 'management';

/** Number of agents in the pipeline that powers a report. 1 is solo, 2 is plan-plus-challenge, 3 or more is a swarm. */
export type AgentCount = 1 | 2 | 3;

/** Base = ships with chinmeister. Custom = user-composed (deferred). */
export type ReportKind = 'base' | 'custom';

/**
 * What pressing a button on this report can do. Plain-English badge
 * in the catalog table so the user knows the blast radius before clicking.
 *
 * - `read-only`           = no buttons, reading material
 * - `updates-chinmeister` = mutates chinmeister state (memory, rules, claims). Nothing leaves chinmeister.
 * - `runs-your-agent`     = may spawn your agent into your repo. Code in your branch can change.
 *
 * The badge reflects the most consequential action available across all
 * sections of the report. A report with one spawn button and ten state
 * buttons is `runs-your-agent`, because the worst-case is what the user
 * needs to know about up front.
 */
export type ActionScope = 'read-only' | 'updates-chinmeister' | 'runs-your-agent';

/** A toggleable lens inside a base report. The user picks which lenses
 *  to include in their subscription; the runner composes the included
 *  sections into the final findings. */
export interface ReportSection {
  id: string;
  name: string;
  description: string;
}

export interface ReportDef {
  id: string;
  kind: ReportKind;
  name: string;
  tagline: string;
  description: string;
  category: ReportCategory;
  /** What pressing a button on this report can do. */
  actionScope: ActionScope;
  /** Toggleable lenses the user picks per subscription. */
  sections: ReportSection[];
  /** What data sources the pipeline reads */
  reads: string[];
  /** What it produces */
  produces: string[];
  /** Example insight that makes users go "oh shit" */
  exampleInsight: string;
  /** Recommended run frequency in prose form, shown in the detail view. */
  frequency: string;
  /**
   * Recommended cadence in days. Drives the catalog's freshness column.
   * null for trigger-based or on-demand reports that have no calendar cadence.
   */
  cadenceDays: number | null;
  /** chinmeister palette color name (red, cyan, yellow, etc.), resolved via getColorHex. */
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
    name: 'Failures',
    tagline: 'Where your agents keep failing, and why',
    description:
      'Files where sessions abandon or fail, the error patterns behind them, and the tool/model combinations that finish work there. Toggle in cost lens to see where spend did not convert, or tests lens to see edits without test coverage.',
    category: 'analysis',
    actionScope: 'runs-your-agent',
    sections: [
      {
        id: 'by-file',
        name: 'By file',
        description: 'Which files concentrate failures, ranked by abandonment count.',
      },
      {
        id: 'by-model',
        name: 'By model',
        description:
          'Per-model completion rates scoped by file domain to avoid raw model-vs-model comparison.',
      },
      {
        id: 'by-tool',
        name: 'By tool',
        description: 'Per-tool completion rates scoped by file domain.',
      },
      {
        id: 'cost-lens',
        name: 'Cost lens',
        description:
          'Where spend did not convert to finished work. Abandoned-token breakdown by model, tool, and work type.',
      },
      {
        id: 'tests-lens',
        name: 'Tests lens',
        description:
          'Files edited across many sessions whose corresponding test files have not been touched. Requires codebase spawn.',
      },
    ],
    reads: [
      'Session outcomes',
      'File rework patterns',
      'Tool call errors',
      'Retry history',
      'Per-model outcomes',
      'Token usage and cost',
      'Git commits',
    ],
    produces: [
      'Failure-ranked file map',
      'Root cause clusters',
      'Tool/model recommendations per area',
      'Memory update suggestions for hard zones',
      'Abandoned-spend breakdown (cost lens)',
      'Untested-hotspot list (tests lens)',
    ],
    exampleInsight:
      'router.ts fails 40% on Sonnet, completes 78% on Opus. Across 9 abandoned sessions this month, $47 went to Opus refactors that did not finish. Tests on this file have not been touched in 4 months.',
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
    name: 'Collisions',
    tagline: 'Where your agents step on each other',
    description:
      'File contention, claim coverage, and handoff cost across your team. Hidden when you are solo and not running parallel agents.',
    category: 'management',
    actionScope: 'updates-chinmeister',
    sections: [
      {
        id: 'file-contention',
        name: 'File contention',
        description:
          'Files multiple agents touched in overlapping windows. Ranked by collision count.',
      },
      {
        id: 'claim-coverage',
        name: 'Claim coverage',
        description:
          'Where the file-claim system was used and where it was not. Suggests glob claims for hot directories.',
      },
      {
        id: 'handoff-cost',
        name: 'Handoff cost',
        description:
          'Cross-tool handoffs (Cursor → Claude Code, etc.) and the completion-rate impact of each.',
      },
    ],
    reads: [
      'Conflict events',
      'File claims and locks',
      'Concurrent agent windows',
      'Edit collisions',
      'Cross-tool session pairs',
    ],
    produces: [
      'File contention hotspots',
      'Claim coverage recommendations',
      'Handoff cost breakdown',
      'Suggested watcher rules',
    ],
    exampleInsight:
      'router.ts was edited by 3 agents in 3 days with no claim overlap. Cursor → Claude Code handoffs on this file dropped completion 16 points compared to single-tool sessions.',
    frequency: 'Weekly for active teams',
    cadenceDays: 7,
    colorName: 'lavender',
    stages: [
      'collect',
      'analyze-conflicts',
      'analyze-claims',
      'analyze-handoffs',
      'synthesize',
      'report',
    ],
  },
  {
    id: 'onboarding-brief',
    kind: 'base',
    name: 'Project Primer',
    tagline: 'What this project needs you to know',
    description:
      'Generated orientation for a new teammate, a returning developer, or an audit. Toggle which sections to include based on the audience.',
    category: 'analysis',
    actionScope: 'read-only',
    sections: [
      {
        id: 'where-to-run',
        name: 'Where to run what',
        description:
          'Per-directory recommendation of the tool and model combination that completes work there.',
      },
      {
        id: 'memories-to-read',
        name: 'Memories to read first',
        description: 'High-signal memories ranked by access count and outcome correlation.',
      },
      {
        id: 'hard-zones',
        name: 'Hard zones',
        description: 'Files and directories with low completion rates. Approach with context.',
      },
    ],
    reads: [
      'Per-directory completion rates',
      'Per-tool and per-model performance',
      'Memory access patterns',
      'Retry and rework history',
    ],
    produces: ['Where-to-run-what guide', 'Memory reading list', 'Hard-zone advisory'],
    exampleInsight:
      'Backend (packages/worker/) completes 82% on Claude Code + Opus. Frontend (packages/web/) works well on Cursor + Sonnet at half the cost. Read the do-rpc and auth-pattern memories first; both are touched by most sessions in this repo.',
    frequency: 'On teammate join, or on demand',
    cadenceDays: null,
    colorName: 'cyan',
    stages: ['collect', 'analyze-domains', 'rank-memories', 'synthesize', 'report'],
  },
  {
    id: 'memory-hygiene',
    kind: 'base',
    name: 'Memory Cleanup',
    tagline: 'Stale, drifted, and overlapping memories',
    description:
      'Memories that have not been used, that disagree with current code, or that overlap with newer entries. One-click prune, merge, or promote.',
    category: 'management',
    actionScope: 'updates-chinmeister',
    sections: [
      {
        id: 'stale',
        name: 'Stale',
        description:
          'Memories never returned in search and never used in a completed session for the past 60 days.',
      },
      {
        id: 'drift',
        name: 'Drift',
        description:
          'Memories that reference renamed symbols, deleted files, or patterns the code no longer follows. Requires codebase spawn.',
      },
      {
        id: 'merge-candidates',
        name: 'Merge candidates',
        description:
          'Memory pairs with overlapping content that should be merged or one deprecated.',
      },
    ],
    reads: [
      'Memories',
      'Memory search results',
      'Session outcomes per memory',
      'Source code (file existence and symbol references)',
    ],
    produces: [
      'Prune candidates',
      'Drift-corrected memory drafts',
      'Merge candidates',
      'Promote candidates',
    ],
    exampleInsight:
      '14 memories have not been searched in 60 days. The do-rpc memory references fetch-based calls but the code migrated to native RPC on 2026-02-04, and 4 sessions this month read the stale version before making fetch-based edits. 2 memory pairs overlap heavily.',
    frequency: 'Monthly',
    cadenceDays: 30,
    colorName: 'green',
    stages: [
      'collect',
      'analyze-usage',
      'reconcile-codebase',
      'detect-overlap',
      'synthesize',
      'report',
    ],
  },
];
