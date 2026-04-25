// User analytics aggregation -- cross-team analytics and session listing.
//
// This handler fans out to every team the caller belongs to, collects each
// team's analytics in parallel, then merges them through a set of
// per-analytic modules under ./analytics/. Each module owns one analytic
// (accumulator + merge + project), so this file only knows how to iterate
// them — not what any particular one computes.

import { getDB, getTeam, rpc } from '../../lib/env.js';
import { getErrorMessage } from '../../lib/errors.js';
import { json } from '../../lib/http.js';
import { createLogger } from '../../lib/logger.js';
import { enrichTokenUsageWithPricing } from '../../lib/pricing-enrich.js';
import { authedRoute } from '../../lib/middleware.js';
import { MAX_DASHBOARD_TEAMS } from '../../lib/constants.js';
import { buildDataCoverage } from '../../lib/data-coverage.js';
import { userAnalyticsSchema } from '@chinmeister/shared/contracts/analytics.js';
import { DO_CALL_TIMEOUT_MS, withTimeout } from './helpers.js';

import { ANALYTICS_MAX_DAYS, CROSS_TEAM_MAX_DAYS } from './analytics/constants.js';
import { buildEmptyAnalyticsResponse } from './analytics/empty.js';
import type { TeamResult } from './analytics/types.js';
import * as dailyTrends from './analytics/daily-trends.js';
import * as outcomes from './analytics/outcomes.js';
import * as tokens from './analytics/tokens.js';
import * as commits from './analytics/commits.js';
import * as conversations from './analytics/conversations.js';
import * as tools from './analytics/tools.js';
import * as codebase from './analytics/codebase.js';
import * as activity from './analytics/activity.js';
import * as sessions from './analytics/sessions.js';
import * as members from './analytics/members.js';
import * as memberDailyLines from './analytics/member-daily-lines.js';
import * as perProjectLines from './analytics/per-project-lines.js';
import * as projects from './analytics/projects.js';
import * as period from './analytics/period.js';
import * as toolCalls from './analytics/tool-calls.js';

const log = createLogger('routes.user.teams');

// ± 14 hours covers every real-world IANA offset (Samoa is +13, Kiribati is
// +14, American Samoa is -11). Reject anything outside the range so a garbage
// bind value can't be smuggled into the SQL modifier.
const TZ_OFFSET_MIN = -14 * 60;
const TZ_OFFSET_MAX = 14 * 60;

function parseTzOffset(raw: string | null): number {
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  if (isNaN(n)) return 0;
  return Math.max(TZ_OFFSET_MIN, Math.min(n, TZ_OFFSET_MAX));
}

export const handleUserAnalytics = authedRoute(async ({ request, user, env }) => {
  const url = new URL(request.url);
  const parsed = parseInt(url.searchParams.get('days') || '30', 10);
  const days = Math.max(1, Math.min(isNaN(parsed) ? 30 : parsed, ANALYTICS_MAX_DAYS));
  const tzOffsetMinutes = parseTzOffset(url.searchParams.get('tz_offset_minutes'));

  // Optional project filter: comma-separated team IDs.
  const teamIdsParam = url.searchParams.get('team_ids');
  const teamIdsFilter = teamIdsParam
    ? new Set(
        teamIdsParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;

  const db = getDB(env);
  const teamsResult = rpc(await db.getUserTeams(user.id));
  const allTeams: Array<{ team_id: string; team_name: string | null }> = teamsResult.teams;
  const teamsList = teamIdsFilter ? allTeams.filter((t) => teamIdsFilter.has(t.team_id)) : allTeams;

  // Cap days for multi-team aggregation to bound memory usage.
  const effectiveDays = teamsList.length > 1 ? Math.min(days, CROSS_TEAM_MAX_DAYS) : days;

  if (teamsList.length === 0) {
    return json(buildEmptyAnalyticsResponse(days), 200, { schema: userAnalyticsSchema });
  }

  const capped = teamsList.slice(0, MAX_DASHBOARD_TEAMS);
  const results = await Promise.allSettled(
    capped.map(async (teamEntry) => {
      const team = getTeam(env, teamEntry.team_id);
      try {
        // Privacy-by-default: cross-team analytics are scoped to the caller's
        // own data. STRATEGY.md is explicit that developer-level data is
        // private by default; aggregating teammates' sessions, edits, tokens,
        // sentiment, etc. into one user's dashboard is the leak the analytics
        // scope refactor closes. Team-tier admin views (when they ship) build
        // a separate route that explicitly passes empty scope and gates on a
        // role check.
        return rpc(
          await withTimeout(
            team.getAnalyticsForOwner(user.id, effectiveDays, tzOffsetMinutes, {
              handle: user.handle,
            }) as unknown as Promise<TeamResult>,
            DO_CALL_TIMEOUT_MS,
          ),
        );
      } catch (err) {
        log.error('failed to fetch team analytics', {
          teamId: teamEntry.team_id,
          error: getErrorMessage(err),
        });
        return { error: 'timeout' } satisfies TeamResult;
      }
    }),
  );

  // Create one accumulator per analytic.
  const dailyTrendsAcc = dailyTrends.createAcc();
  const outcomeDistAcc = outcomes.createOutcomeDistAcc();
  const completionAcc = outcomes.createCompletionAcc();
  const toolOutcomesAcc = outcomes.createToolOutcomesAcc();
  const modelOutcomesAcc = outcomes.createModelOutcomesAcc();
  const workTypeOutcomesAcc = outcomes.createWorkTypeOutcomesAcc();
  const conflictAcc = outcomes.createConflictAcc();

  const toolDistAcc = tools.createToolDistAcc();
  const toolCompAcc = tools.createToolCompAcc();
  const toolDailyAcc = tools.createToolDailyAcc();
  const toolWorkTypeAcc = tools.createToolWorkTypeAcc();
  const toolHandoffsAcc = tools.createToolHandoffsAcc();
  const activeToolsAcc = tools.createActiveToolsAcc();

  const heatmapAcc = codebase.createHeatmapAcc();
  const filesTouchedTotalAcc = codebase.createFilesTouchedTotalAcc();
  const filesTouchedHalfSplitAcc = codebase.createFilesTouchedHalfSplitAcc();
  const filesByWorkTypeAcc = codebase.createFilesByWorkTypeAcc();
  const filesNewVsRevisitedAcc = codebase.createFilesNewVsRevisitedAcc();
  const fileChurnAcc = codebase.createFileChurnAcc();
  const fileReworkAcc = codebase.createFileReworkAcc();
  const dirHeatmapAcc = codebase.createDirHeatmapAcc();
  const scopeComplexityAcc = codebase.createScopeComplexityAcc();
  const fileOverlapAcc = codebase.createFileOverlapAcc();
  const auditStalenessAcc = codebase.createAuditStalenessAcc();

  const hourlyAcc = activity.createHourlyAcc();
  const hourlyEffAcc = activity.createHourlyEffAcc();
  const dailyMetricsAcc = activity.createDailyMetricsAcc();
  const promptEffAcc = activity.createPromptEffAcc();

  const durationAcc = sessions.createDurationAcc();
  const velocityAcc = sessions.createVelocityAcc();
  const firstEditAcc = sessions.createFirstEditAcc();
  const stucknessAcc = sessions.createStucknessAcc();
  const conflictStatsAcc = sessions.createConflictStatsAcc();
  const retryAcc = sessions.createRetryAcc();
  const concurrentAcc = sessions.createConcurrentAcc();
  const outcomeTagsAcc = sessions.createOutcomeTagsAcc();
  const workTypeAcc = sessions.createWorkTypeAcc();

  const memberAcc = members.createAcc();
  const memberDailyLinesAcc = memberDailyLines.createAcc();
  const perProjectLinesAcc = perProjectLines.createAcc();
  const projectsAcc = projects.createAcc();
  const periodComparisonAcc = period.createAcc();

  const convEditAcc = conversations.createConvEditAcc();
  const memOutcomeAcc = conversations.createMemOutcomeAcc();
  const topMemoriesAcc = conversations.createTopMemoriesAcc();
  const memoryUsageAcc = conversations.createMemoryUsageAcc();

  const tokensAcc = tokens.createAcc();
  const commitsAcc = commits.createAcc();
  const toolCallsAcc = toolCalls.createAcc();

  let included = 0;
  let failed = 0;

  // Iterate team results and fold each into every accumulator. Indexed
  // loop so per-project merges can correlate `results[i]` with the
  // team_id / team_name metadata at `capped[i]`. noUncheckedIndexedAccess
  // makes both reads `| undefined` — the index math is sound (we iterate
  // results.length, capped and results are same length), so a single
  // defensive guard at the top keeps the rest of the body narrowed.
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const teamEntry = capped[i];
    if (!r || !teamEntry) {
      failed++;
      continue;
    }
    if (r.status === 'rejected') {
      failed++;
      continue;
    }
    const team = r.value;
    if (team.error) {
      failed++;
      continue;
    }
    const teamIndex = included;
    included++;

    dailyTrends.merge(dailyTrendsAcc, team);
    outcomes.mergeOutcomeDist(outcomeDistAcc, team);
    outcomes.mergeCompletion(completionAcc, team);
    outcomes.mergeToolOutcomes(toolOutcomesAcc, team);
    outcomes.mergeModelOutcomes(modelOutcomesAcc, team);
    outcomes.mergeWorkTypeOutcomes(workTypeOutcomesAcc, team);
    outcomes.mergeConflict(conflictAcc, team);

    tools.mergeToolDist(toolDistAcc, team);
    tools.mergeToolComp(toolCompAcc, team);
    tools.mergeToolDaily(toolDailyAcc, team);
    tools.mergeToolWorkType(toolWorkTypeAcc, team);
    tools.mergeToolHandoffs(toolHandoffsAcc, team);
    tools.mergeActiveTools(activeToolsAcc, team);

    codebase.mergeHeatmap(heatmapAcc, team);
    codebase.mergeFilesTouchedTotal(filesTouchedTotalAcc, team);
    codebase.mergeFilesTouchedHalfSplit(filesTouchedHalfSplitAcc, team);
    codebase.mergeFilesByWorkType(filesByWorkTypeAcc, team);
    codebase.mergeFilesNewVsRevisited(filesNewVsRevisitedAcc, team);
    codebase.mergeFileChurn(fileChurnAcc, team);
    codebase.mergeFileRework(fileReworkAcc, team);
    codebase.mergeDirHeatmap(dirHeatmapAcc, team);
    codebase.mergeScopeComplexity(scopeComplexityAcc, team);
    codebase.mergeFileOverlap(fileOverlapAcc, team);
    codebase.mergeAuditStaleness(auditStalenessAcc, team);

    activity.mergeHourly(hourlyAcc, team);
    activity.mergeHourlyEff(hourlyEffAcc, team);
    activity.mergeDailyMetrics(dailyMetricsAcc, team);
    activity.mergePromptEff(promptEffAcc, team);

    sessions.mergeDuration(durationAcc, team);
    sessions.mergeVelocity(velocityAcc, team);
    sessions.mergeFirstEdit(firstEditAcc, team);
    sessions.mergeStuckness(stucknessAcc, team);
    sessions.mergeConflictStats(conflictStatsAcc, team);
    sessions.mergeRetry(retryAcc, team);
    sessions.mergeConcurrent(concurrentAcc, team, teamIndex);
    sessions.mergeOutcomeTags(outcomeTagsAcc, team);
    sessions.mergeWorkType(workTypeAcc, team, teamIndex);

    members.merge(memberAcc, team);
    memberDailyLines.merge(memberDailyLinesAcc, team);
    perProjectLines.merge(perProjectLinesAcc, team, teamEntry);
    projects.merge(projectsAcc, team, teamEntry);
    period.merge(periodComparisonAcc, team);

    conversations.mergeConvEdit(convEditAcc, team);
    conversations.mergeMemOutcome(memOutcomeAcc, team);
    conversations.mergeTopMemories(topMemoriesAcc, team);
    conversations.mergeMemoryUsage(memoryUsageAcc, team);

    tokens.merge(tokensAcc, team);
    commits.merge(commitsAcc, team);
    toolCalls.merge(toolCallsAcc, team);
  }

  // Token usage needs pricing enrichment before shipping; do it once against
  // the merged shape so the pricing cache lookup happens a single time per
  // request.
  const tokenUsagePayload = tokens.project(tokensAcc);
  await enrichTokenUsageWithPricing(tokenUsagePayload, env);

  const completionSummary = outcomes.projectCompletion(completionAcc);

  return json(
    {
      ok: true,
      period_days: effectiveDays,
      daily_trends: dailyTrends.project(dailyTrendsAcc),
      outcome_distribution: outcomes.projectOutcomeDist(outcomeDistAcc),
      tool_distribution: tools.projectToolDist(toolDistAcc),
      file_heatmap: codebase.projectHeatmap(heatmapAcc),
      files_touched_total: codebase.projectFilesTouchedTotal(filesTouchedTotalAcc),
      files_touched_half_split: codebase.projectFilesTouchedHalfSplit(filesTouchedHalfSplitAcc),
      hourly_distribution: activity.projectHourly(hourlyAcc),
      tool_daily: tools.projectToolDaily(toolDailyAcc),
      model_outcomes: outcomes.projectModelOutcomes(modelOutcomesAcc),
      tool_outcomes: outcomes.projectToolOutcomes(toolOutcomesAcc),
      daily_metrics: activity.projectDailyMetrics(dailyMetricsAcc),
      completion_summary: completionSummary,
      tool_comparison: tools.projectToolComp(toolCompAcc),
      work_type_distribution: sessions.projectWorkType(workTypeAcc),
      tool_work_type: tools.projectToolWorkType(toolWorkTypeAcc),
      file_churn: codebase.projectFileChurn(fileChurnAcc),
      duration_distribution: sessions.projectDuration(durationAcc),
      concurrent_edits: sessions.projectConcurrent(concurrentAcc),
      member_analytics: members.project(memberAcc),
      // Honest lower bound: take the max of post-merge distinct count and
      // per-team uncapped totals. First catches cross-team dedupe (same
      // handle in two teams = one person); second catches per-team LIMIT 50
      // truncation that the merge never saw. Sum would double-count shared
      // handles, which is the common case (user + collaborator teams).
      member_analytics_total: (() => {
        let maxTotal = memberAcc.size;
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (!r || r.status !== 'fulfilled') continue;
          const t = r.value;
          if (t.error) continue;
          const teamTotal = t.member_analytics_total ?? 0;
          if (teamTotal > maxTotal) maxTotal = teamTotal;
        }
        return maxTotal;
      })(),
      member_daily_lines: memberDailyLines.project(memberDailyLinesAcc),
      per_project_lines: perProjectLines.project(perProjectLinesAcc),
      retry_patterns: sessions.projectRetry(retryAcc),
      conflict_correlation: outcomes.projectConflict(conflictAcc),
      edit_velocity: sessions.projectVelocity(velocityAcc),
      per_project_velocity: projects.project(projectsAcc),
      memory_usage: conversations.projectMemoryUsage(memoryUsageAcc),
      work_type_outcomes: outcomes.projectWorkTypeOutcomes(workTypeOutcomesAcc),
      conversation_edit_correlation: conversations.projectConvEdit(convEditAcc),
      file_rework: codebase.projectFileRework(fileReworkAcc),
      directory_heatmap: codebase.projectDirHeatmap(dirHeatmapAcc),
      files_by_work_type: codebase.projectFilesByWorkType(filesByWorkTypeAcc),
      files_new_vs_revisited: codebase.projectFilesNewVsRevisited(filesNewVsRevisitedAcc),
      stuckness: sessions.projectStuckness(stucknessAcc),
      conflict_stats: sessions.projectConflictStats(conflictStatsAcc),
      file_overlap: codebase.projectFileOverlap(fileOverlapAcc),
      audit_staleness: codebase.projectAuditStaleness(auditStalenessAcc),
      first_edit_stats: sessions.projectFirstEdit(firstEditAcc),
      memory_outcome_correlation: conversations.projectMemOutcome(memOutcomeAcc),
      top_memories: conversations.projectTopMemories(topMemoriesAcc),
      period_comparison: period.project(periodComparisonAcc),
      token_usage: tokenUsagePayload,
      scope_complexity: codebase.projectScopeComplexity(scopeComplexityAcc),
      prompt_efficiency: activity.projectPromptEff(promptEffAcc),
      hourly_effectiveness: activity.projectHourlyEff(hourlyEffAcc),
      outcome_tags: sessions.projectOutcomeTags(outcomeTagsAcc),
      tool_handoffs: tools.projectToolHandoffs(toolHandoffsAcc),
      commit_stats: commits.project(commitsAcc, completionSummary.total_sessions),
      tool_call_stats: toolCalls.project(toolCallsAcc),
      data_coverage: buildDataCoverage(activeToolsAcc),
      teams_included: included,
      degraded: failed > 0,
    },
    200,
    { schema: userAnalyticsSchema },
  );
});
