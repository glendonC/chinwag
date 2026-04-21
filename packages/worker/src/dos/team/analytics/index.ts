/**
 * Analytics orchestrator.
 *
 * `getExtendedAnalytics` is the single entry point that route handlers use to
 * materialise the UserAnalytics response shape. Its job is composition, not
 * computation: each field is computed by a query function in a domain module,
 * and this file wires them together.
 *
 * Domain modules (one concept per file):
 *   core.ts          — base rollup shared with the lightweight getAnalytics path
 *   activity.ts      — when + how often work happens (hourly, daily, velocity)
 *   outcomes.ts      — what came out (model/tool/work-type performance)
 *   codebase.ts      — where work happens (files, directories, churn, rework)
 *   sessions.ts      — how sessions behave (retry, conflicts, stuckness, scope)
 *   team.ts          — per-member slice
 *   memory.ts        — shared-memory usage and outcome correlation
 *   conversations.ts — conversation-level signals
 *   tokens.ts        — token usage and cost
 *   tool-calls.ts    — per-tool-call stats
 *   commits.ts       — git attribution
 *   comparison.ts    — period-over-period delta
 *   extended.ts      — prompt efficiency, hourly effectiveness, tags, handoffs
 *
 * Each module returns its slice of the UserAnalytics contract. Adding a new
 * analytics field is two steps: add a query to the right domain module, then
 * append one line to the matching section below. The return type is pinned by
 * the shared contract so additions to the contract will fail this file at
 * compile time until they're wired.
 */

import type { UserAnalytics } from '@chinwag/shared/contracts/analytics.js';

import { getAnalytics } from './core.js';
import {
  queryHourlyDistribution,
  queryToolDaily,
  queryDurationDistribution,
  queryEditVelocity,
} from './activity.js';
import {
  queryModelPerformance,
  queryToolOutcomes,
  queryCompletionSummary,
  queryToolComparison,
  queryWorkTypeDistribution,
  queryToolWorkType,
  queryWorkTypeOutcomes,
} from './outcomes.js';
import {
  queryFileChurn,
  queryConcurrentEdits,
  queryFileHeatmapEnhanced,
  queryFileRework,
  queryDirectoryHeatmap,
  queryAuditStaleness,
} from './codebase.js';
import {
  queryRetryPatterns,
  queryConflictCorrelation,
  queryConflictStats,
  queryStuckness,
  queryFileOverlap,
  queryFirstEditStats,
  queryScopeComplexity,
} from './sessions.js';
import { queryMemberAnalytics } from './team.js';
import { queryMemoryUsage, queryMemoryOutcomeCorrelation, queryTopMemories } from './memory.js';
import { queryConversationEditCorrelation } from './conversations.js';
import { queryTokenUsage } from './tokens.js';
import { queryToolCallStats } from './tool-calls.js';
import { queryCommitStats } from './commits.js';
import { queryPeriodComparison } from './comparison.js';
import {
  queryPromptEfficiency,
  queryHourlyEffectiveness,
  queryOutcomeTags,
  queryToolHandoffs,
} from './extended.js';

export { getAnalytics } from './core.js';
export { classifyWorkType } from './outcomes.js';

export function getExtendedAnalytics(
  sql: SqlStorage,
  days: number,
): Omit<UserAnalytics, 'teams_included' | 'degraded'> {
  const base = getAnalytics(sql, days);
  return {
    ...base,

    // ── Core overrides ─────────────────────────────────────────────────
    // Replace the basic heatmap with the enhanced variant that carries
    // work-type, outcome-rate, and lines-touched per file.
    file_heatmap: queryFileHeatmapEnhanced(sql, days),

    // ── Activity ───────────────────────────────────────────────────────
    hourly_distribution: queryHourlyDistribution(sql, days),
    tool_daily: queryToolDaily(sql, days),
    duration_distribution: queryDurationDistribution(sql, days),
    edit_velocity: queryEditVelocity(sql, days),

    // ── Outcomes ───────────────────────────────────────────────────────
    model_outcomes: queryModelPerformance(sql, days),
    tool_outcomes: queryToolOutcomes(sql, days),
    completion_summary: queryCompletionSummary(sql, days),
    tool_comparison: queryToolComparison(sql, days),
    work_type_distribution: queryWorkTypeDistribution(sql, days),
    tool_work_type: queryToolWorkType(sql, days),
    work_type_outcomes: queryWorkTypeOutcomes(sql, days),

    // ── Codebase ───────────────────────────────────────────────────────
    file_churn: queryFileChurn(sql, days),
    concurrent_edits: queryConcurrentEdits(sql, days),
    file_rework: queryFileRework(sql, days),
    directory_heatmap: queryDirectoryHeatmap(sql, days),
    audit_staleness: queryAuditStaleness(sql, days),

    // ── Sessions ───────────────────────────────────────────────────────
    retry_patterns: queryRetryPatterns(sql, days),
    conflict_correlation: queryConflictCorrelation(sql, days),
    conflict_stats: queryConflictStats(sql, days),
    stuckness: queryStuckness(sql, days),
    file_overlap: queryFileOverlap(sql, days),
    first_edit_stats: queryFirstEditStats(sql, days),
    scope_complexity: queryScopeComplexity(sql, days),

    // ── Team ───────────────────────────────────────────────────────────
    member_analytics: queryMemberAnalytics(sql, days),

    // ── Memory ─────────────────────────────────────────────────────────
    memory_usage: queryMemoryUsage(sql, days),
    memory_outcome_correlation: queryMemoryOutcomeCorrelation(sql, days),
    top_memories: queryTopMemories(sql, days),

    // ── Conversations ──────────────────────────────────────────────────
    conversation_edit_correlation: queryConversationEditCorrelation(sql, days),

    // ── Tokens, tool calls, commits ────────────────────────────────────
    token_usage: queryTokenUsage(sql, days),
    tool_call_stats: queryToolCallStats(sql, days),
    commit_stats: queryCommitStats(sql, days),

    // ── Period comparison ──────────────────────────────────────────────
    period_comparison: queryPeriodComparison(sql, days),

    // ── Extended / derived ─────────────────────────────────────────────
    prompt_efficiency: queryPromptEfficiency(sql, days),
    hourly_effectiveness: queryHourlyEffectiveness(sql, days),
    outcome_tags: queryOutcomeTags(sql, days),
    tool_handoffs: queryToolHandoffs(sql, days),
  };
}
