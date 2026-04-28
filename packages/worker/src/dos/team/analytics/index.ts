/**
 * Analytics orchestrator.
 *
 * `getExtendedAnalytics` is the single entry point that route handlers use to
 * materialise the UserAnalytics response shape. Its job is composition, not
 * computation: each field is computed by a query function in a domain module,
 * and this file wires them together.
 *
 * Domain modules (one concept per file):
 *   core.ts          - base rollup shared with the lightweight getAnalytics path
 *   activity.ts      - when + how often work happens (hourly, daily, velocity)
 *   outcomes.ts      - what came out (model/tool/work-type performance)
 *   codebase.ts      - where work happens (files, directories, churn, rework)
 *   sessions.ts      - how sessions behave (retry, conflicts, stuckness, scope)
 *   team.ts          - per-member slice
 *   memory.ts        - shared-memory usage and outcome correlation
 *   conversations.ts - conversation-level signals
 *   tokens.ts        - token usage and cost
 *   tool-calls.ts    - per-tool-call stats
 *   commits.ts       - git attribution
 *   comparison.ts    - period-over-period delta
 *   extended.ts      - prompt efficiency, hourly effectiveness, tags, handoffs
 *
 * Each module returns its slice of the UserAnalytics contract. Adding a new
 * analytics field is two steps: add a query to the right domain module, then
 * append one line to the matching section below. The return type is pinned by
 * the shared contract so additions to the contract will fail this file at
 * compile time until they're wired.
 */

import type { UserAnalytics } from '@chinmeister/shared/contracts/analytics.js';

import { type AnalyticsScope } from './scope.js';
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
  queryFilesByWorkType,
  queryFilesNewVsRevisited,
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
import { queryMemberAnalytics, queryMemberCount, queryMemberDailyLines } from './team.js';
import {
  queryMemoryUsage,
  queryMemoryOutcomeCorrelation,
  queryTopMemories,
  queryCrossToolMemoryFlow,
  queryMemoryAging,
  queryMemoryCategories,
  queryMemorySingleAuthorDirectories,
  queryMemorySupersession,
  queryMemorySecretsShield,
} from './memory.js';
import {
  queryConversationEditCorrelation,
  queryConfusedFiles,
  queryCrossToolHandoffs,
  queryUnansweredQuestions,
} from './conversations.js';
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
import { buildDataCoverage, queryActiveTools } from '../../../lib/data-coverage.js';

export { getAnalytics } from './core.js';
export { classifyWorkType } from './outcomes.js';

export function getExtendedAnalytics(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
  tzOffsetMinutes: number = 0,
): Omit<UserAnalytics, 'teams_included' | 'degraded'> {
  const base = getAnalytics(sql, scope, days, tzOffsetMinutes);
  return {
    ...base,

    // ── Core overrides ─────────────────────────────────────────────────
    // Replace the basic heatmap with the enhanced variant that carries
    // work-type, outcome-rate, and lines-touched per file.
    file_heatmap: queryFileHeatmapEnhanced(sql, scope, days),

    // ── Activity ───────────────────────────────────────────────────────
    hourly_distribution: queryHourlyDistribution(sql, scope, days, tzOffsetMinutes),
    tool_daily: queryToolDaily(sql, scope, days, tzOffsetMinutes),
    duration_distribution: queryDurationDistribution(sql, scope, days),
    edit_velocity: queryEditVelocity(sql, scope, days, tzOffsetMinutes),

    // ── Outcomes ───────────────────────────────────────────────────────
    model_outcomes: queryModelPerformance(sql, scope, days),
    tool_outcomes: queryToolOutcomes(sql, scope, days),
    completion_summary: queryCompletionSummary(sql, scope, days),
    tool_comparison: queryToolComparison(sql, scope, days),
    work_type_distribution: queryWorkTypeDistribution(sql, scope, days),
    tool_work_type: queryToolWorkType(sql, scope, days),
    work_type_outcomes: queryWorkTypeOutcomes(sql, scope, days),

    // ── Codebase ───────────────────────────────────────────────────────
    file_churn: queryFileChurn(sql, scope, days),
    concurrent_edits: queryConcurrentEdits(sql, scope, days),
    file_rework: queryFileRework(sql, scope, days),
    directory_heatmap: queryDirectoryHeatmap(sql, scope, days),
    audit_staleness: queryAuditStaleness(sql, scope),
    files_by_work_type: queryFilesByWorkType(sql, scope, days),
    files_new_vs_revisited: queryFilesNewVsRevisited(sql, scope, days),

    // ── Sessions ───────────────────────────────────────────────────────
    retry_patterns: queryRetryPatterns(sql, scope, days),
    conflict_correlation: queryConflictCorrelation(sql, scope, days),
    conflict_stats: queryConflictStats(sql, scope, days),
    stuckness: queryStuckness(sql, scope, days),
    file_overlap: queryFileOverlap(sql, scope, days),
    first_edit_stats: queryFirstEditStats(sql, scope, days),
    scope_complexity: queryScopeComplexity(sql, scope, days),

    // ── Team ───────────────────────────────────────────────────────────
    member_analytics: queryMemberAnalytics(sql, scope, days),
    member_analytics_total: queryMemberCount(sql, scope, days),
    member_daily_lines: queryMemberDailyLines(sql, scope, days),
    // per_project_lines and per_project_velocity are cross-project by
    // construction; assembled at the user route from each team's totals
    // tagged with team_id/team_name. Empty here.
    per_project_lines: [],

    // ── Memory ─────────────────────────────────────────────────────────
    memory_usage: queryMemoryUsage(sql, scope, days),
    memory_outcome_correlation: queryMemoryOutcomeCorrelation(sql, scope, days),
    top_memories: queryTopMemories(sql, scope, days),
    cross_tool_memory_flow: queryCrossToolMemoryFlow(sql, scope, days),
    memory_aging: queryMemoryAging(sql),
    memory_categories: queryMemoryCategories(sql, scope),
    memory_single_author_directories: queryMemorySingleAuthorDirectories(sql, scope),
    memory_supersession: queryMemorySupersession(sql, scope, days),
    memory_secrets_shield: queryMemorySecretsShield(sql, days),

    // ── Conversations ──────────────────────────────────────────────────
    conversation_edit_correlation: queryConversationEditCorrelation(sql, scope, days),
    confused_files: queryConfusedFiles(sql, scope, days),
    cross_tool_handoff_questions: queryCrossToolHandoffs(sql, scope, days),
    unanswered_questions: queryUnansweredQuestions(sql, scope, days),

    // ── Tokens, tool calls, commits ────────────────────────────────────
    token_usage: queryTokenUsage(sql, scope, days),
    tool_call_stats: queryToolCallStats(sql, scope, days, tzOffsetMinutes),
    commit_stats: queryCommitStats(sql, scope, days, tzOffsetMinutes),

    // ── Period comparison ──────────────────────────────────────────────
    period_comparison: queryPeriodComparison(sql, scope, days),

    // ── Extended / derived ─────────────────────────────────────────────
    prompt_efficiency: queryPromptEfficiency(sql, scope, days, tzOffsetMinutes),
    hourly_effectiveness: queryHourlyEffectiveness(sql, scope, days, tzOffsetMinutes),
    outcome_tags: queryOutcomeTags(sql, scope, days),
    tool_handoffs: queryToolHandoffs(sql, scope, days),

    // per_project_velocity is a cross-project rollup; it's assembled at
    // the user route from each team's tool_comparison, not here.
    per_project_velocity: [],

    // data_coverage on team scope lets Project-view widgets attribute
    // partial cost/token totals to the reporting tool subset. The user
    // route recomputes this over the cross-team union after merge, so
    // the two scopes stay internally consistent.
    data_coverage: buildDataCoverage(queryActiveTools(sql, scope, days)),
  };
}
