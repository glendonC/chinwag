// User analytics aggregation -- cross-team analytics and session listing.

import { getDB, getTeam, rpc } from '../../lib/env.js';
import { getErrorMessage } from '../../lib/errors.js';
import { json } from '../../lib/http.js';
import { createLogger } from '../../lib/logger.js';
import { enrichTokenUsageWithPricing } from '../../lib/pricing-enrich.js';
import { authedRoute } from '../../lib/middleware.js';
import { MAX_DASHBOARD_TEAMS } from '../../lib/constants.js';
import { getToolsWithCapability } from '@chinwag/shared/tool-registry.js';
import { DO_CALL_TIMEOUT_MS, withTimeout } from './helpers.js';

const log = createLogger('routes.user.teams');

const ANALYTICS_MAX_DAYS = 90;

export const handleUserAnalytics = authedRoute(async ({ request, user, env }) => {
  const url = new URL(request.url);
  const parsed = parseInt(url.searchParams.get('days') || '30', 10);
  const days = Math.max(1, Math.min(isNaN(parsed) ? 30 : parsed, ANALYTICS_MAX_DAYS));

  // Optional project filter: comma-separated team IDs
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

  // Filter to requested subset (intersection with user's actual teams)
  const teams = teamIdsFilter ? allTeams.filter((t) => teamIdsFilter.has(t.team_id)) : allTeams;

  if (teams.length === 0) {
    return json({
      ok: true,
      period_days: days,
      file_heatmap: [],
      daily_trends: [],
      tool_distribution: [],
      outcome_distribution: [],
      daily_metrics: [],
      hourly_distribution: [],
      tool_hourly: [],
      tool_daily: [],
      model_outcomes: [],
      tool_outcomes: [],
      completion_summary: {
        total_sessions: 0,
        completed: 0,
        abandoned: 0,
        failed: 0,
        unknown: 0,
        completion_rate: 0,
        prev_completion_rate: null,
      },
      tool_comparison: [],
      work_type_distribution: [],
      tool_work_type: [],
      file_churn: [],
      duration_distribution: [],
      concurrent_edits: [],
      member_analytics: [],
      retry_patterns: [],
      conflict_correlation: [],
      edit_velocity: [],
      memory_usage: {
        total_memories: 0,
        searches: 0,
        searches_with_results: 0,
        search_hit_rate: 0,
        memories_created_period: 0,
        memories_updated_period: 0,
        stale_memories: 0,
        avg_memory_age_days: 0,
      },
      period_comparison: {
        current: {
          completion_rate: 0,
          avg_duration_min: 0,
          stuckness_rate: 0,
          memory_hit_rate: 0,
          edit_velocity: 0,
          total_sessions: 0,
        },
        previous: null,
      },
      token_usage: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_read_tokens: 0,
        total_cache_creation_tokens: 0,
        avg_input_per_session: 0,
        avg_output_per_session: 0,
        sessions_with_token_data: 0,
        sessions_without_token_data: 0,
        total_estimated_cost_usd: 0,
        pricing_refreshed_at: null,
        pricing_is_stale: false,
        models_without_pricing: [],
        models_without_pricing_total: 0,
        by_model: [],
        by_tool: [],
      },
      commit_stats: {
        total_commits: 0,
        commits_per_session: 0,
        sessions_with_commits: 0,
        avg_time_to_first_commit_min: null,
        by_tool: [],
        daily_commits: [],
        outcome_correlation: [],
        commit_edit_ratio: [],
      },
      teams_included: 0,
      degraded: false,
    });
  }

  const capped = teams.slice(0, MAX_DASHBOARD_TEAMS);
  const results = await Promise.allSettled(
    capped.map(async (teamEntry) => {
      const team = getTeam(env, teamEntry.team_id);
      try {
        return rpc(
          await withTimeout(
            team.getAnalyticsForOwner(user.id, days) as unknown as Promise<Record<string, unknown>>,
            DO_CALL_TIMEOUT_MS,
          ),
        );
      } catch (err) {
        log.error('failed to fetch team analytics', {
          teamId: teamEntry.team_id,
          error: getErrorMessage(err),
        });
        return { error: 'timeout' };
      }
    }),
  );

  // Merge analytics across teams
  const dailyTrends = new Map<
    string,
    {
      sessions: number;
      edits: number;
      lines_added: number;
      lines_removed: number;
      duration_sum: number;
      duration_count: number;
      completed: number;
      abandoned: number;
      failed: number;
    }
  >();
  const outcomes = new Map<string, number>();
  const tools = new Map<string, { sessions: number; edits: number }>();
  const toolOutcomes = new Map<string, number>();
  const heatmap = new Map<
    string,
    {
      touch_count: number;
      work_type: string;
      outcome_sum: number;
      outcome_count: number;
      lines_added: number;
      lines_removed: number;
    }
  >();
  const hourly = new Map<string, { sessions: number; edits: number }>();
  const toolHourly = new Map<string, { sessions: number; edits: number }>();
  const toolDaily = new Map<
    string,
    {
      sessions: number;
      edits: number;
      lines_added: number;
      lines_removed: number;
      duration_sum: number;
      duration_count: number;
    }
  >();
  const models = new Map<
    string,
    {
      count: number;
      total_edits: number;
      duration_sum: number;
      lines_added: number;
      lines_removed: number;
    }
  >();
  const dailyMetrics = new Map<string, number>();

  // New analytics merge accumulators
  const completionAcc = {
    total_sessions: 0,
    completed: 0,
    abandoned: 0,
    failed: 0,
    unknown: 0,
    prev_total: 0,
    prev_completed: 0,
  };
  const toolComp = new Map<
    string,
    {
      sessions: number;
      completed: number;
      abandoned: number;
      failed: number;
      duration_sum: number;
      duration_count: number;
      total_edits: number;
      total_lines_added: number;
      total_lines_removed: number;
    }
  >();
  const workTypes = new Map<
    string,
    {
      sessions: number;
      edits: number;
      lines_added: number;
      lines_removed: number;
      files: Set<string>;
    }
  >();
  const toolWorkTypes = new Map<string, { sessions: number; edits: number }>();
  const fileChurn = new Map<
    string,
    { session_count: number; total_edits: number; total_lines: number }
  >();
  const durationBuckets = new Map<string, number>();
  const concurrentEdits = new Map<string, { agents: Set<string>; edit_count: number }>();
  const memberAcc = new Map<
    string,
    {
      sessions: number;
      completed: number;
      abandoned: number;
      failed: number;
      duration_sum: number;
      duration_count: number;
      total_edits: number;
      total_lines_added: number;
      total_lines_removed: number;
      total_commits: number;
      tools: Map<string, number>;
    }
  >();
  const retryAcc = new Map<
    string,
    { attempts: number; final_outcome: string | null; resolved: boolean }
  >();
  const conflictAcc = new Map<string, { sessions: number; completed: number }>();
  const velocityAcc = new Map<string, { edits: number; lines: number; hours: number }>();
  const memoryAcc = {
    total_memories: 0,
    searches: 0,
    searches_with_results: 0,
    memories_created_period: 0,
    memories_updated_period: 0,
    stale_memories: 0,
    age_sum: 0,
    age_count: 0,
  };

  // Extended analytics merge accumulators (10 types previously missing)
  const workTypeOutcomesAcc = new Map<
    string,
    { sessions: number; completed: number; abandoned: number; failed: number }
  >();
  const convEditAcc = new Map<
    string,
    { sessions: number; total_edits: number; total_lines: number; completed: number }
  >();
  const fileReworkAcc = new Map<string, { total_edits: number; failed_edits: number }>();
  const dirHeatmapAcc = new Map<
    string,
    {
      touch_count: number;
      file_count: number;
      total_lines: number;
      rate_sum: number;
      rate_count: number;
    }
  >();
  const stucknessAcc = {
    total_sessions: 0,
    stuck_sessions: 0,
    stuck_completed: 0,
    stuck_total: 0,
    normal_completed: 0,
    normal_total: 0,
  };
  const fileOverlapAcc = { total_files: 0, overlapping_files: 0 };
  const auditStalenessAcc = new Map<
    string,
    { last_edit: string; days_since: number; prior_edit_count: number }
  >();
  const firstEditAcc = {
    sum_avg: 0,
    sum_median: 0,
    count: 0,
    by_tool: new Map<string, { sum_avg: number; sessions: number }>(),
  };
  const memOutcomeAcc = new Map<string, { sessions: number; completed: number }>();
  const topMemoriesAcc = new Map<
    string,
    {
      text_preview: string;
      access_count: number;
      last_accessed_at: string | null;
      created_at: string;
    }
  >();

  // Period comparison accumulators
  const periodCurrentAcc = {
    completion_sum: 0,
    duration_sum: 0,
    stuck_sum: 0,
    memory_hit_sum: 0,
    velocity_sum: 0,
    total_sessions_sum: 0,
    count: 0,
  };
  const periodPreviousAcc = {
    completion_sum: 0,
    duration_sum: 0,
    stuck_sum: 0,
    memory_hit_sum: 0,
    velocity_sum: 0,
    total_sessions_sum: 0,
    count: 0,
  };

  // Token usage accumulators
  const tokenTotalAcc = {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_creation: 0,
    with_data: 0,
    without_data: 0,
  };
  const tokenByModel = new Map<
    string,
    {
      input: number;
      output: number;
      cache_read: number;
      cache_creation: number;
      sessions: number;
    }
  >();
  const tokenByTool = new Map<
    string,
    {
      input: number;
      output: number;
      cache_read: number;
      cache_creation: number;
      sessions: number;
    }
  >();

  // Extended analytics accumulators (6 remaining types)
  const scopeComplexityAcc = new Map<
    string,
    { sessions: number; edits_sum: number; duration_sum: number; completed: number }
  >();
  const promptEfficiencyAcc = new Map<string, { turns_sum: number; sessions: number }>();
  const hourlyEffectivenessAcc = new Map<
    number,
    { sessions: number; completed: number; edits_sum: number }
  >();
  const outcomeTagsAcc = new Map<string, number>();
  const toolHandoffsAcc = new Map<
    string,
    { file_count: number; completed: number; total: number }
  >();

  // Commit stats accumulators
  const commitAcc = {
    total_commits: 0,
    sessions_with_commits: 0,
    ttfc_sum: 0,
    ttfc_count: 0,
  };
  const commitByTool = new Map<string, { commits: number; files_sum: number; lines_sum: number }>();
  const commitDaily = new Map<string, number>();
  const commitOutcomeAcc = new Map<string, { sessions: number; completed: number }>();
  const commitEditRatioAcc = new Map<
    string,
    { sessions: number; completed: number; edits_sum: number; commits_sum: number }
  >();

  // Active tools tracker for data_coverage computation
  const activeToolsSet = new Set<string>();

  let included = 0;
  let failed = 0;

  for (const r of results) {
    if (r.status === 'rejected') {
      failed++;
      continue;
    }
    const data = r.value as Record<string, unknown>;
    if (data.error) {
      failed++;
      continue;
    }
    included++;

    for (const t of (data.daily_trends as Array<Record<string, unknown>>) || []) {
      const key = t.day as string;
      const existing = dailyTrends.get(key) || {
        sessions: 0,
        edits: 0,
        lines_added: 0,
        lines_removed: 0,
        duration_sum: 0,
        duration_count: 0,
        completed: 0,
        abandoned: 0,
        failed: 0,
      };
      existing.sessions += (t.sessions as number) || 0;
      existing.edits += (t.edits as number) || 0;
      existing.lines_added += (t.lines_added as number) || 0;
      existing.lines_removed += (t.lines_removed as number) || 0;
      const avg = (t.avg_duration_min as number) || 0;
      const sess = (t.sessions as number) || 0;
      existing.duration_sum += avg * sess;
      existing.duration_count += sess;
      existing.completed += (t.completed as number) || 0;
      existing.abandoned += (t.abandoned as number) || 0;
      existing.failed += (t.failed as number) || 0;
      dailyTrends.set(key, existing);
    }

    for (const o of (data.outcome_distribution as Array<Record<string, unknown>>) || []) {
      const key = o.outcome as string;
      outcomes.set(key, (outcomes.get(key) || 0) + ((o.count as number) || 0));
    }

    for (const t of (data.tool_distribution as Array<Record<string, unknown>>) || []) {
      const key = t.host_tool as string;
      const existing = tools.get(key) || { sessions: 0, edits: 0 };
      existing.sessions += (t.sessions as number) || 0;
      existing.edits += (t.edits as number) || 0;
      tools.set(key, existing);
    }

    for (const f of (data.file_heatmap as Array<Record<string, unknown>>) || []) {
      const key = f.file as string;
      const tc = (f.touch_count as number) || 0;
      const existing = heatmap.get(key) || {
        touch_count: 0,
        work_type: (f.work_type as string) || 'other',
        outcome_sum: 0,
        outcome_count: 0,
        lines_added: 0,
        lines_removed: 0,
      };
      existing.touch_count += tc;
      const rate = (f.outcome_rate as number) || 0;
      existing.outcome_sum += rate * tc;
      existing.outcome_count += tc;
      existing.lines_added += (f.total_lines_added as number) || 0;
      existing.lines_removed += (f.total_lines_removed as number) || 0;
      heatmap.set(key, existing);
    }

    for (const h of (data.hourly_distribution as Array<Record<string, unknown>>) || []) {
      const key = `${h.hour}-${h.dow}`;
      const existing = hourly.get(key) || { sessions: 0, edits: 0 };
      existing.sessions += (h.sessions as number) || 0;
      existing.edits += (h.edits as number) || 0;
      hourly.set(key, existing);
    }

    for (const th of (data.tool_hourly as Array<Record<string, unknown>>) || []) {
      const key = `${th.host_tool}:${th.hour}-${th.dow}`;
      const existing = toolHourly.get(key) || { sessions: 0, edits: 0 };
      existing.sessions += (th.sessions as number) || 0;
      existing.edits += (th.edits as number) || 0;
      toolHourly.set(key, existing);
    }

    for (const td of (data.tool_daily as Array<Record<string, unknown>>) || []) {
      const key = `${td.host_tool}:${td.day}`;
      const existing = toolDaily.get(key) || {
        sessions: 0,
        edits: 0,
        lines_added: 0,
        lines_removed: 0,
        duration_sum: 0,
        duration_count: 0,
      };
      existing.sessions += (td.sessions as number) || 0;
      existing.edits += (td.edits as number) || 0;
      existing.lines_added += (td.lines_added as number) || 0;
      existing.lines_removed += (td.lines_removed as number) || 0;
      const avg = (td.avg_duration_min as number) || 0;
      const sess = (td.sessions as number) || 0;
      existing.duration_sum += avg * sess;
      existing.duration_count += sess;
      toolDaily.set(key, existing);
    }

    for (const m of (data.model_outcomes as Array<Record<string, unknown>>) || []) {
      const key = `${m.agent_model}:${m.outcome}`;
      const existing = models.get(key) || {
        count: 0,
        total_edits: 0,
        duration_sum: 0,
        lines_added: 0,
        lines_removed: 0,
      };
      existing.count += (m.count as number) || 0;
      existing.total_edits += (m.total_edits as number) || 0;
      existing.duration_sum += ((m.avg_duration_min as number) || 0) * ((m.count as number) || 0);
      existing.lines_added += (m.total_lines_added as number) || 0;
      existing.lines_removed += (m.total_lines_removed as number) || 0;
      models.set(key, existing);
    }

    for (const to of (data.tool_outcomes as Array<Record<string, unknown>>) || []) {
      const key = `${to.host_tool}:${to.outcome}`;
      toolOutcomes.set(key, (toolOutcomes.get(key) || 0) + ((to.count as number) || 0));
    }

    for (const dm of (data.daily_metrics as Array<Record<string, unknown>>) || []) {
      const key = `${dm.date}:${dm.metric}`;
      dailyMetrics.set(key, (dailyMetrics.get(key) || 0) + ((dm.count as number) || 0));
    }

    // Merge completion summary
    const cs = data.completion_summary as Record<string, unknown> | undefined;
    if (cs) {
      completionAcc.total_sessions += (cs.total_sessions as number) || 0;
      completionAcc.completed += (cs.completed as number) || 0;
      completionAcc.abandoned += (cs.abandoned as number) || 0;
      completionAcc.failed += (cs.failed as number) || 0;
      completionAcc.unknown += (cs.unknown as number) || 0;
      // Track previous period across teams for weighted average
      if (cs.prev_completion_rate != null) {
        const prevTotal = (cs.total_sessions as number) || 0; // approximate
        completionAcc.prev_total += prevTotal;
        completionAcc.prev_completed += Math.round(
          ((cs.prev_completion_rate as number) / 100) * prevTotal,
        );
      }
    }

    // Merge tool comparison
    for (const tc of (data.tool_comparison as Array<Record<string, unknown>>) || []) {
      const key = tc.host_tool as string;
      const existing = toolComp.get(key) || {
        sessions: 0,
        completed: 0,
        abandoned: 0,
        failed: 0,
        duration_sum: 0,
        duration_count: 0,
        total_edits: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
      };
      const sess = (tc.sessions as number) || 0;
      existing.sessions += sess;
      existing.completed += (tc.completed as number) || 0;
      existing.abandoned += (tc.abandoned as number) || 0;
      existing.failed += (tc.failed as number) || 0;
      existing.duration_sum += ((tc.avg_duration_min as number) || 0) * sess;
      existing.duration_count += sess;
      existing.total_edits += (tc.total_edits as number) || 0;
      existing.total_lines_added += (tc.total_lines_added as number) || 0;
      existing.total_lines_removed += (tc.total_lines_removed as number) || 0;
      toolComp.set(key, existing);
    }

    // Merge work type distribution
    for (const wt of (data.work_type_distribution as Array<Record<string, unknown>>) || []) {
      const key = wt.work_type as string;
      const existing = workTypes.get(key) || {
        sessions: 0,
        edits: 0,
        lines_added: 0,
        lines_removed: 0,
        files: new Set<string>(),
      };
      existing.sessions += (wt.sessions as number) || 0;
      existing.edits += (wt.edits as number) || 0;
      existing.lines_added += (wt.lines_added as number) || 0;
      existing.lines_removed += (wt.lines_removed as number) || 0;
      // files count is approximate across teams (can't dedupe without file names)
      existing.files.add(`${key}:${included}`);
      workTypes.set(key, existing);
    }

    // Merge tool work type
    for (const tw of (data.tool_work_type as Array<Record<string, unknown>>) || []) {
      const key = `${tw.host_tool}:${tw.work_type}`;
      const existing = toolWorkTypes.get(key) || { sessions: 0, edits: 0 };
      existing.sessions += (tw.sessions as number) || 0;
      existing.edits += (tw.edits as number) || 0;
      toolWorkTypes.set(key, existing);
    }

    // Merge file churn
    for (const fc of (data.file_churn as Array<Record<string, unknown>>) || []) {
      const key = fc.file as string;
      const existing = fileChurn.get(key) || { session_count: 0, total_edits: 0, total_lines: 0 };
      existing.session_count += (fc.session_count as number) || 0;
      existing.total_edits += (fc.total_edits as number) || 0;
      existing.total_lines += (fc.total_lines as number) || 0;
      fileChurn.set(key, existing);
    }

    // Merge duration distribution
    for (const db of (data.duration_distribution as Array<Record<string, unknown>>) || []) {
      const key = db.bucket as string;
      durationBuckets.set(key, (durationBuckets.get(key) || 0) + ((db.count as number) || 0));
    }

    // Merge concurrent edits
    for (const ce of (data.concurrent_edits as Array<Record<string, unknown>>) || []) {
      const key = ce.file as string;
      const existing = concurrentEdits.get(key) || { agents: new Set<string>(), edit_count: 0 };
      // agents count is per-team, so take the max across teams
      const agentCount = (ce.agents as number) || 0;
      for (let i = 0; i < agentCount; i++) existing.agents.add(`${key}:${included}:${i}`);
      existing.edit_count += (ce.edit_count as number) || 0;
      concurrentEdits.set(key, existing);
    }

    // Merge member analytics
    for (const ma of (data.member_analytics as Array<Record<string, unknown>>) || []) {
      const key = ma.handle as string;
      const existing = memberAcc.get(key) || {
        sessions: 0,
        completed: 0,
        abandoned: 0,
        failed: 0,
        duration_sum: 0,
        duration_count: 0,
        total_edits: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
        total_commits: 0,
        tools: new Map<string, number>(),
      };
      const sess = (ma.sessions as number) || 0;
      existing.sessions += sess;
      existing.completed += (ma.completed as number) || 0;
      existing.abandoned += (ma.abandoned as number) || 0;
      existing.failed += (ma.failed as number) || 0;
      existing.duration_sum += ((ma.avg_duration_min as number) || 0) * sess;
      existing.duration_count += sess;
      existing.total_edits += (ma.total_edits as number) || 0;
      existing.total_lines_added += (ma.total_lines_added as number) || 0;
      existing.total_lines_removed += (ma.total_lines_removed as number) || 0;
      existing.total_commits += (ma.total_commits as number) || 0;
      const tool = ma.primary_tool as string | null;
      if (tool) existing.tools.set(tool, (existing.tools.get(tool) || 0) + sess);
      memberAcc.set(key, existing);
    }

    // Merge retry patterns
    for (const rp of (data.retry_patterns as Array<Record<string, unknown>>) || []) {
      const key = `${rp.handle}:${rp.file}`;
      const existing = retryAcc.get(key) || { attempts: 0, final_outcome: null, resolved: false };
      existing.attempts += (rp.attempts as number) || 0;
      existing.final_outcome = (rp.final_outcome as string) || existing.final_outcome;
      existing.resolved = existing.final_outcome === 'completed';
      retryAcc.set(key, existing);
    }

    // Merge conflict correlation
    for (const cc of (data.conflict_correlation as Array<Record<string, unknown>>) || []) {
      const key = cc.bucket as string;
      const existing = conflictAcc.get(key) || { sessions: 0, completed: 0 };
      existing.sessions += (cc.sessions as number) || 0;
      existing.completed += (cc.completed as number) || 0;
      conflictAcc.set(key, existing);
    }

    // Merge edit velocity
    for (const ev of (data.edit_velocity as Array<Record<string, unknown>>) || []) {
      const key = ev.day as string;
      const existing = velocityAcc.get(key) || { edits: 0, lines: 0, hours: 0 };
      const hours = (ev.total_session_hours as number) || 0;
      existing.edits += ((ev.edits_per_hour as number) || 0) * hours;
      existing.lines += ((ev.lines_per_hour as number) || 0) * hours;
      existing.hours += hours;
      velocityAcc.set(key, existing);
    }

    // Merge memory usage
    const mu = data.memory_usage as Record<string, unknown> | undefined;
    if (mu) {
      memoryAcc.total_memories += (mu.total_memories as number) || 0;
      memoryAcc.searches += (mu.searches as number) || 0;
      memoryAcc.searches_with_results += (mu.searches_with_results as number) || 0;
      memoryAcc.memories_created_period += (mu.memories_created_period as number) || 0;
      memoryAcc.memories_updated_period += (mu.memories_updated_period as number) || 0;
      memoryAcc.stale_memories += (mu.stale_memories as number) || 0;
      const avgAge = (mu.avg_memory_age_days as number) || 0;
      const totalMem = (mu.total_memories as number) || 0;
      if (totalMem > 0) {
        memoryAcc.age_sum += avgAge * totalMem;
        memoryAcc.age_count += totalMem;
      }
    }

    // Merge work type outcomes
    for (const wo of (data.work_type_outcomes as Array<Record<string, unknown>>) || []) {
      const key = wo.work_type as string;
      const existing = workTypeOutcomesAcc.get(key) || {
        sessions: 0,
        completed: 0,
        abandoned: 0,
        failed: 0,
      };
      existing.sessions += (wo.sessions as number) || 0;
      existing.completed += (wo.completed as number) || 0;
      existing.abandoned += (wo.abandoned as number) || 0;
      existing.failed += (wo.failed as number) || 0;
      workTypeOutcomesAcc.set(key, existing);
    }

    // Merge conversation-edit correlation
    for (const ce of (data.conversation_edit_correlation as Array<Record<string, unknown>>) || []) {
      const key = ce.bucket as string;
      const existing = convEditAcc.get(key) || {
        sessions: 0,
        total_edits: 0,
        total_lines: 0,
        completed: 0,
      };
      const sess = (ce.sessions as number) || 0;
      existing.sessions += sess;
      existing.total_edits += ((ce.avg_edits as number) || 0) * sess;
      existing.total_lines += ((ce.avg_lines as number) || 0) * sess;
      existing.completed += Math.round((((ce.completion_rate as number) || 0) / 100) * sess);
      convEditAcc.set(key, existing);
    }

    // Merge file rework
    for (const fr of (data.file_rework as Array<Record<string, unknown>>) || []) {
      const key = fr.file as string;
      const existing = fileReworkAcc.get(key) || { total_edits: 0, failed_edits: 0 };
      existing.total_edits += (fr.total_edits as number) || 0;
      existing.failed_edits += (fr.failed_edits as number) || 0;
      fileReworkAcc.set(key, existing);
    }

    // Merge directory heatmap
    for (const dh of (data.directory_heatmap as Array<Record<string, unknown>>) || []) {
      const key = dh.directory as string;
      const tc = (dh.touch_count as number) || 0;
      const existing = dirHeatmapAcc.get(key) || {
        touch_count: 0,
        file_count: 0,
        total_lines: 0,
        rate_sum: 0,
        rate_count: 0,
      };
      existing.touch_count += tc;
      existing.file_count += (dh.file_count as number) || 0;
      existing.total_lines += (dh.total_lines as number) || 0;
      existing.rate_sum += ((dh.completion_rate as number) || 0) * tc;
      existing.rate_count += tc;
      dirHeatmapAcc.set(key, existing);
    }

    // Merge stuckness
    const st = data.stuckness as Record<string, unknown> | undefined;
    if (st) {
      stucknessAcc.total_sessions += (st.total_sessions as number) || 0;
      stucknessAcc.stuck_sessions += (st.stuck_sessions as number) || 0;
      const stuckTotal = (st.stuck_sessions as number) || 0;
      const normalTotal = ((st.total_sessions as number) || 0) - stuckTotal;
      stucknessAcc.stuck_completed += Math.round(
        (((st.stuck_completion_rate as number) || 0) / 100) * stuckTotal,
      );
      stucknessAcc.stuck_total += stuckTotal;
      stucknessAcc.normal_completed += Math.round(
        (((st.normal_completion_rate as number) || 0) / 100) * normalTotal,
      );
      stucknessAcc.normal_total += normalTotal;
    }

    // Merge file overlap
    const fo = data.file_overlap as Record<string, unknown> | undefined;
    if (fo) {
      fileOverlapAcc.total_files += (fo.total_files as number) || 0;
      fileOverlapAcc.overlapping_files += (fo.overlapping_files as number) || 0;
    }

    // Merge audit staleness
    for (const as_ of (data.audit_staleness as Array<Record<string, unknown>>) || []) {
      const key = as_.directory as string;
      const existing = auditStalenessAcc.get(key);
      if (!existing || ((as_.days_since as number) || 0) > existing.days_since) {
        auditStalenessAcc.set(key, {
          last_edit: (as_.last_edit as string) || '',
          days_since: (as_.days_since as number) || 0,
          prior_edit_count:
            (existing?.prior_edit_count || 0) + ((as_.prior_edit_count as number) || 0),
        });
      } else {
        existing.prior_edit_count += (as_.prior_edit_count as number) || 0;
      }
    }

    // Merge first edit stats
    const fe = data.first_edit_stats as Record<string, unknown> | undefined;
    if (fe) {
      const avg = (fe.avg_minutes_to_first_edit as number) || 0;
      const med = (fe.median_minutes_to_first_edit as number) || 0;
      const teamSessions =
        ((data.completion_summary as Record<string, unknown> | undefined)
          ?.total_sessions as number) || 1;
      firstEditAcc.sum_avg += avg * teamSessions;
      firstEditAcc.sum_median += med * teamSessions;
      firstEditAcc.count += teamSessions;
      for (const bt of (fe.by_tool as Array<Record<string, unknown>>) || []) {
        const toolKey = bt.host_tool as string;
        const existing = firstEditAcc.by_tool.get(toolKey) || { sum_avg: 0, sessions: 0 };
        const btSess = (bt.sessions as number) || 0;
        existing.sum_avg += ((bt.avg_minutes as number) || 0) * btSess;
        existing.sessions += btSess;
        firstEditAcc.by_tool.set(toolKey, existing);
      }
    }

    // Merge memory outcome correlation
    for (const mo of (data.memory_outcome_correlation as Array<Record<string, unknown>>) || []) {
      const key = mo.bucket as string;
      const existing = memOutcomeAcc.get(key) || { sessions: 0, completed: 0 };
      existing.sessions += (mo.sessions as number) || 0;
      existing.completed += (mo.completed as number) || 0;
      memOutcomeAcc.set(key, existing);
    }

    // Merge top memories
    for (const tm of (data.top_memories as Array<Record<string, unknown>>) || []) {
      const id = tm.id as string;
      if (!topMemoriesAcc.has(id)) {
        topMemoriesAcc.set(id, {
          text_preview: (tm.text_preview as string) || '',
          access_count: (tm.access_count as number) || 0,
          last_accessed_at: (tm.last_accessed_at as string) || null,
          created_at: (tm.created_at as string) || '',
        });
      } else {
        const existing = topMemoriesAcc.get(id)!;
        existing.access_count += (tm.access_count as number) || 0;
      }
    }

    // Merge period comparison (weighted average by total_sessions)
    const pc = data.period_comparison as Record<string, unknown> | undefined;
    if (pc) {
      const cur = pc.current as Record<string, unknown> | undefined;
      if (cur) {
        const ts = (cur.total_sessions as number) || 0;
        periodCurrentAcc.completion_sum += ((cur.completion_rate as number) || 0) * ts;
        periodCurrentAcc.duration_sum += ((cur.avg_duration_min as number) || 0) * ts;
        periodCurrentAcc.stuck_sum += ((cur.stuckness_rate as number) || 0) * ts;
        periodCurrentAcc.memory_hit_sum += ((cur.memory_hit_rate as number) || 0) * ts;
        periodCurrentAcc.velocity_sum += ((cur.edit_velocity as number) || 0) * ts;
        periodCurrentAcc.total_sessions_sum += ts;
        periodCurrentAcc.count++;
      }
      const prev = pc.previous as Record<string, unknown> | undefined;
      if (prev) {
        const ts = (prev.total_sessions as number) || 0;
        periodPreviousAcc.completion_sum += ((prev.completion_rate as number) || 0) * ts;
        periodPreviousAcc.duration_sum += ((prev.avg_duration_min as number) || 0) * ts;
        periodPreviousAcc.stuck_sum += ((prev.stuckness_rate as number) || 0) * ts;
        periodPreviousAcc.memory_hit_sum += ((prev.memory_hit_rate as number) || 0) * ts;
        periodPreviousAcc.velocity_sum += ((prev.edit_velocity as number) || 0) * ts;
        periodPreviousAcc.total_sessions_sum += ts;
        periodPreviousAcc.count++;
      }
    }

    // Merge token usage
    const tu = data.token_usage as Record<string, unknown> | undefined;
    if (tu) {
      tokenTotalAcc.input += (tu.total_input_tokens as number) || 0;
      tokenTotalAcc.output += (tu.total_output_tokens as number) || 0;
      tokenTotalAcc.cache_read += (tu.total_cache_read_tokens as number) || 0;
      tokenTotalAcc.cache_creation += (tu.total_cache_creation_tokens as number) || 0;
      tokenTotalAcc.with_data += (tu.sessions_with_token_data as number) || 0;
      tokenTotalAcc.without_data += (tu.sessions_without_token_data as number) || 0;
      for (const m of (tu.by_model as Array<Record<string, unknown>>) || []) {
        const key = m.agent_model as string;
        const existing = tokenByModel.get(key) || {
          input: 0,
          output: 0,
          cache_read: 0,
          cache_creation: 0,
          sessions: 0,
        };
        existing.input += (m.input_tokens as number) || 0;
        existing.output += (m.output_tokens as number) || 0;
        existing.cache_read += (m.cache_read_tokens as number) || 0;
        existing.cache_creation += (m.cache_creation_tokens as number) || 0;
        existing.sessions += (m.sessions as number) || 0;
        tokenByModel.set(key, existing);
      }
      for (const t of (tu.by_tool as Array<Record<string, unknown>>) || []) {
        const key = t.host_tool as string;
        const existing = tokenByTool.get(key) || {
          input: 0,
          output: 0,
          cache_read: 0,
          cache_creation: 0,
          sessions: 0,
        };
        existing.input += (t.input_tokens as number) || 0;
        existing.output += (t.output_tokens as number) || 0;
        existing.cache_read += (t.cache_read_tokens as number) || 0;
        existing.cache_creation += (t.cache_creation_tokens as number) || 0;
        existing.sessions += (t.sessions as number) || 0;
        tokenByTool.set(key, existing);
      }
    }

    // Merge scope complexity
    for (const sc of (data.scope_complexity as Array<Record<string, unknown>>) || []) {
      const key = sc.bucket as string;
      const sess = (sc.sessions as number) || 0;
      const existing = scopeComplexityAcc.get(key) || {
        sessions: 0,
        edits_sum: 0,
        duration_sum: 0,
        completed: 0,
      };
      existing.sessions += sess;
      existing.edits_sum += ((sc.avg_edits as number) || 0) * sess;
      existing.duration_sum += ((sc.avg_duration_min as number) || 0) * sess;
      existing.completed += Math.round((((sc.completion_rate as number) || 0) / 100) * sess);
      scopeComplexityAcc.set(key, existing);
    }

    // Merge prompt efficiency
    for (const pe of (data.prompt_efficiency as Array<Record<string, unknown>>) || []) {
      const key = pe.day as string;
      const sess = (pe.sessions as number) || 0;
      const existing = promptEfficiencyAcc.get(key) || { turns_sum: 0, sessions: 0 };
      existing.turns_sum += ((pe.avg_turns_per_edit as number) || 0) * sess;
      existing.sessions += sess;
      promptEfficiencyAcc.set(key, existing);
    }

    // Merge hourly effectiveness
    for (const he of (data.hourly_effectiveness as Array<Record<string, unknown>>) || []) {
      const hour = (he.hour as number) || 0;
      const sess = (he.sessions as number) || 0;
      const existing = hourlyEffectivenessAcc.get(hour) || {
        sessions: 0,
        completed: 0,
        edits_sum: 0,
      };
      existing.sessions += sess;
      existing.completed += Math.round((((he.completion_rate as number) || 0) / 100) * sess);
      existing.edits_sum += ((he.avg_edits as number) || 0) * sess;
      hourlyEffectivenessAcc.set(hour, existing);
    }

    // Merge outcome tags
    for (const ot of (data.outcome_tags as Array<Record<string, unknown>>) || []) {
      const key = `${ot.tag}:${ot.outcome}`;
      outcomeTagsAcc.set(key, (outcomeTagsAcc.get(key) || 0) + ((ot.count as number) || 0));
    }

    // Merge tool handoffs
    for (const th of (data.tool_handoffs as Array<Record<string, unknown>>) || []) {
      const key = `${th.from_tool}:${th.to_tool}`;
      const fc = (th.file_count as number) || 0;
      const existing = toolHandoffsAcc.get(key) || { file_count: 0, completed: 0, total: 0 };
      existing.file_count += fc;
      existing.total += fc;
      existing.completed += Math.round((((th.handoff_completion_rate as number) || 0) / 100) * fc);
      toolHandoffsAcc.set(key, existing);
    }

    // Merge commit stats
    const cs_ = data.commit_stats as Record<string, unknown> | undefined;
    if (cs_) {
      commitAcc.total_commits += (cs_.total_commits as number) || 0;
      commitAcc.sessions_with_commits += (cs_.sessions_with_commits as number) || 0;
      const ttfc = cs_.avg_time_to_first_commit_min as number | null;
      const swc = (cs_.sessions_with_commits as number) || 0;
      if (ttfc != null && swc > 0) {
        commitAcc.ttfc_sum += ttfc * swc;
        commitAcc.ttfc_count += swc;
      }
      for (const bt of (cs_.by_tool as Array<Record<string, unknown>>) || []) {
        const key = bt.host_tool as string;
        const c = (bt.commits as number) || 0;
        const existing = commitByTool.get(key) || { commits: 0, files_sum: 0, lines_sum: 0 };
        existing.commits += c;
        existing.files_sum += ((bt.avg_files_changed as number) || 0) * c;
        existing.lines_sum += ((bt.avg_lines as number) || 0) * c;
        commitByTool.set(key, existing);
      }
      for (const dc of (cs_.daily_commits as Array<Record<string, unknown>>) || []) {
        const key = dc.day as string;
        commitDaily.set(key, (commitDaily.get(key) || 0) + ((dc.commits as number) || 0));
      }
      for (const oc of (cs_.outcome_correlation as Array<Record<string, unknown>>) || []) {
        const key = oc.bucket as string;
        const existing = commitOutcomeAcc.get(key) || { sessions: 0, completed: 0 };
        existing.sessions += (oc.sessions as number) || 0;
        existing.completed += (oc.completed as number) || 0;
        commitOutcomeAcc.set(key, existing);
      }
      for (const cr of (cs_.commit_edit_ratio as Array<Record<string, unknown>>) || []) {
        const key = cr.bucket as string;
        const sess = (cr.sessions as number) || 0;
        const existing = commitEditRatioAcc.get(key) || {
          sessions: 0,
          completed: 0,
          edits_sum: 0,
          commits_sum: 0,
        };
        existing.sessions += sess;
        existing.completed += Math.round((((cr.completion_rate as number) || 0) / 100) * sess);
        existing.edits_sum += ((cr.avg_edits as number) || 0) * sess;
        existing.commits_sum += ((cr.avg_commits as number) || 0) * sess;
        commitEditRatioAcc.set(key, existing);
      }
    }

    // Track active tools for data_coverage
    for (const t of (data.tool_distribution as Array<Record<string, unknown>>) || []) {
      const tool = t.host_tool as string;
      if (tool && tool !== 'unknown') activeToolsSet.add(tool);
    }
  }

  // Build token_usage once, then enrich with pricing in a single pass so the
  // cross-team dashboard makes exactly one DatabaseDO pricing lookup per
  // request (the isolate cache then fronts subsequent requests). The legacy
  // path computed cost per team inside queryTokenUsage; phase 3 moves it here.
  const tokenUsagePayload = {
    total_input_tokens: tokenTotalAcc.input,
    total_output_tokens: tokenTotalAcc.output,
    total_cache_read_tokens: tokenTotalAcc.cache_read,
    total_cache_creation_tokens: tokenTotalAcc.cache_creation,
    avg_input_per_session:
      tokenTotalAcc.with_data > 0 ? Math.round(tokenTotalAcc.input / tokenTotalAcc.with_data) : 0,
    avg_output_per_session:
      tokenTotalAcc.with_data > 0 ? Math.round(tokenTotalAcc.output / tokenTotalAcc.with_data) : 0,
    sessions_with_token_data: tokenTotalAcc.with_data,
    sessions_without_token_data: tokenTotalAcc.without_data,
    total_estimated_cost_usd: 0,
    pricing_refreshed_at: null as string | null,
    pricing_is_stale: false,
    models_without_pricing: [] as string[],
    models_without_pricing_total: 0,
    by_model: [...tokenByModel.entries()]
      .sort(([, a], [, b]) => b.input - a.input)
      .map(([agent_model, v]) => ({
        agent_model,
        input_tokens: v.input,
        output_tokens: v.output,
        cache_read_tokens: v.cache_read,
        cache_creation_tokens: v.cache_creation,
        sessions: v.sessions,
        estimated_cost_usd: null as number | null,
      })),
    by_tool: [...tokenByTool.entries()]
      .sort(([, a], [, b]) => b.input - a.input)
      .map(([host_tool, v]) => ({
        host_tool,
        input_tokens: v.input,
        output_tokens: v.output,
        cache_read_tokens: v.cache_read,
        cache_creation_tokens: v.cache_creation,
        sessions: v.sessions,
      })),
  };
  await enrichTokenUsageWithPricing(tokenUsagePayload, env);

  return json({
    ok: true,
    period_days: days,
    daily_trends: [...dailyTrends.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({
        day,
        sessions: v.sessions,
        edits: v.edits,
        lines_added: v.lines_added,
        lines_removed: v.lines_removed,
        avg_duration_min:
          v.duration_count > 0 ? Math.round((v.duration_sum / v.duration_count) * 10) / 10 : 0,
        completed: v.completed,
        abandoned: v.abandoned,
        failed: v.failed,
      })),
    outcome_distribution: [...outcomes.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([outcome, count]) => ({ outcome, count })),
    tool_distribution: [...tools.entries()]
      .sort(([, a], [, b]) => b.sessions - a.sessions)
      .map(([host_tool, v]) => ({ host_tool, sessions: v.sessions, edits: v.edits })),
    file_heatmap: [...heatmap.entries()]
      .sort(([, a], [, b]) => b.touch_count - a.touch_count)
      .slice(0, 50)
      .map(([file, v]) => ({
        file,
        touch_count: v.touch_count,
        work_type: v.work_type,
        outcome_rate:
          v.outcome_count > 0 ? Math.round((v.outcome_sum / v.outcome_count) * 10) / 10 : 0,
        total_lines_added: v.lines_added,
        total_lines_removed: v.lines_removed,
      })),
    hourly_distribution: [...hourly.entries()].map(([key, v]) => {
      const [hour, dow] = key.split('-').map(Number);
      return { hour, dow, sessions: v.sessions, edits: v.edits };
    }),
    tool_hourly: [...toolHourly.entries()].map(([key, v]) => {
      const [toolPart, timePart] = [
        key.slice(0, key.lastIndexOf(':')),
        key.slice(key.lastIndexOf(':') + 1),
      ];
      const [hour, dow] = timePart.split('-').map(Number);
      return { host_tool: toolPart, hour, dow, sessions: v.sessions, edits: v.edits };
    }),
    tool_daily: [...toolDaily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => {
        const sep = key.indexOf(':');
        return {
          host_tool: key.slice(0, sep),
          day: key.slice(sep + 1),
          sessions: v.sessions,
          edits: v.edits,
          lines_added: v.lines_added,
          lines_removed: v.lines_removed,
          avg_duration_min:
            v.duration_count > 0 ? Math.round((v.duration_sum / v.duration_count) * 10) / 10 : 0,
        };
      }),
    model_outcomes: [...models.entries()]
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([key, v]) => {
        const [agent_model, outcome] = key.split(':');
        return {
          agent_model,
          outcome,
          count: v.count,
          avg_duration_min: v.count > 0 ? Math.round((v.duration_sum / v.count) * 10) / 10 : 0,
          total_edits: v.total_edits,
          total_lines_added: v.lines_added,
          total_lines_removed: v.lines_removed,
        };
      }),
    tool_outcomes: [...toolOutcomes.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([key, count]) => {
        const sep = key.indexOf(':');
        return { host_tool: key.slice(0, sep), outcome: key.slice(sep + 1), count };
      }),
    daily_metrics: [...dailyMetrics.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => {
        const idx = key.indexOf(':');
        return { date: key.slice(0, idx), metric: key.slice(idx + 1), count };
      }),
    completion_summary: {
      total_sessions: completionAcc.total_sessions,
      completed: completionAcc.completed,
      abandoned: completionAcc.abandoned,
      failed: completionAcc.failed,
      unknown: completionAcc.unknown,
      completion_rate:
        completionAcc.total_sessions > 0
          ? Math.round((completionAcc.completed / completionAcc.total_sessions) * 1000) / 10
          : 0,
      prev_completion_rate:
        completionAcc.prev_total > 0
          ? Math.round((completionAcc.prev_completed / completionAcc.prev_total) * 1000) / 10
          : null,
    },
    tool_comparison: [...toolComp.entries()]
      .sort(([, a], [, b]) => b.sessions - a.sessions)
      .map(([host_tool, v]) => ({
        host_tool,
        sessions: v.sessions,
        completed: v.completed,
        abandoned: v.abandoned,
        failed: v.failed,
        completion_rate: v.sessions > 0 ? Math.round((v.completed / v.sessions) * 1000) / 10 : 0,
        avg_duration_min:
          v.duration_count > 0 ? Math.round((v.duration_sum / v.duration_count) * 10) / 10 : 0,
        total_edits: v.total_edits,
        total_lines_added: v.total_lines_added,
        total_lines_removed: v.total_lines_removed,
      })),
    work_type_distribution: [...workTypes.entries()]
      .sort(([, a], [, b]) => b.sessions - a.sessions)
      .map(([work_type, v]) => ({
        work_type,
        sessions: v.sessions,
        edits: v.edits,
        lines_added: v.lines_added,
        lines_removed: v.lines_removed,
        files: v.files.size,
      })),
    tool_work_type: [...toolWorkTypes.entries()]
      .sort(([, a], [, b]) => b.sessions - a.sessions)
      .map(([key, v]) => {
        const sep = key.indexOf(':');
        return {
          host_tool: key.slice(0, sep),
          work_type: key.slice(sep + 1),
          sessions: v.sessions,
          edits: v.edits,
        };
      }),
    file_churn: [...fileChurn.entries()]
      .sort(([, a], [, b]) => b.session_count - a.session_count)
      .slice(0, 30)
      .map(([file, v]) => ({
        file,
        session_count: v.session_count,
        total_edits: v.total_edits,
        total_lines: v.total_lines,
      })),
    duration_distribution: ['0-5m', '5-15m', '15-30m', '30-60m', '60m+'].map((bucket) => ({
      bucket,
      count: durationBuckets.get(bucket) || 0,
    })),
    concurrent_edits: [...concurrentEdits.entries()]
      .sort(([, a], [, b]) => b.agents.size - a.agents.size)
      .slice(0, 20)
      .map(([file, v]) => ({
        file,
        agents: v.agents.size,
        edit_count: v.edit_count,
      })),
    member_analytics: [...memberAcc.entries()]
      .sort(([, a], [, b]) => b.sessions - a.sessions)
      .slice(0, 50)
      .map(([handle, v]) => {
        let primaryTool: string | null = null;
        let maxCount = 0;
        for (const [tool, count] of v.tools) {
          if (count > maxCount) {
            primaryTool = tool;
            maxCount = count;
          }
        }
        return {
          handle,
          sessions: v.sessions,
          completed: v.completed,
          abandoned: v.abandoned,
          failed: v.failed,
          completion_rate: v.sessions > 0 ? Math.round((v.completed / v.sessions) * 1000) / 10 : 0,
          avg_duration_min:
            v.duration_count > 0 ? Math.round((v.duration_sum / v.duration_count) * 10) / 10 : 0,
          total_edits: v.total_edits,
          total_lines_added: v.total_lines_added,
          total_lines_removed: v.total_lines_removed,
          total_commits: v.total_commits,
          primary_tool: primaryTool,
        };
      }),
    retry_patterns: [...retryAcc.entries()]
      .sort(([, a], [, b]) => b.attempts - a.attempts)
      .slice(0, 30)
      .map(([key, v]) => {
        const sep = key.indexOf(':');
        return {
          handle: key.slice(0, sep),
          file: key.slice(sep + 1),
          attempts: v.attempts,
          final_outcome: v.final_outcome,
          resolved: v.resolved,
        };
      }),
    conflict_correlation: [...conflictAcc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, v]) => ({
        bucket,
        sessions: v.sessions,
        completed: v.completed,
        completion_rate: v.sessions > 0 ? Math.round((v.completed / v.sessions) * 1000) / 10 : 0,
      })),
    edit_velocity: [...velocityAcc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({
        day,
        edits_per_hour: v.hours > 0 ? Math.round((v.edits / v.hours) * 10) / 10 : 0,
        lines_per_hour: v.hours > 0 ? Math.round((v.lines / v.hours) * 10) / 10 : 0,
        total_session_hours: Math.round(v.hours * 100) / 100,
      })),
    memory_usage: {
      total_memories: memoryAcc.total_memories,
      searches: memoryAcc.searches,
      searches_with_results: memoryAcc.searches_with_results,
      search_hit_rate:
        memoryAcc.searches > 0
          ? Math.round((memoryAcc.searches_with_results / memoryAcc.searches) * 1000) / 10
          : 0,
      memories_created_period: memoryAcc.memories_created_period,
      memories_updated_period: memoryAcc.memories_updated_period,
      stale_memories: memoryAcc.stale_memories,
      avg_memory_age_days:
        memoryAcc.age_count > 0
          ? Math.round((memoryAcc.age_sum / memoryAcc.age_count) * 10) / 10
          : 0,
    },
    work_type_outcomes: [...workTypeOutcomesAcc.entries()]
      .sort(([, a], [, b]) => b.sessions - a.sessions)
      .map(([work_type, v]) => ({
        work_type,
        sessions: v.sessions,
        completed: v.completed,
        abandoned: v.abandoned,
        failed: v.failed,
        completion_rate: v.sessions > 0 ? Math.round((v.completed / v.sessions) * 1000) / 10 : 0,
      })),
    conversation_edit_correlation: [...convEditAcc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, v]) => ({
        bucket,
        sessions: v.sessions,
        avg_edits: v.sessions > 0 ? Math.round(v.total_edits / v.sessions) : 0,
        avg_lines: v.sessions > 0 ? Math.round(v.total_lines / v.sessions) : 0,
        completion_rate: v.sessions > 0 ? Math.round((v.completed / v.sessions) * 1000) / 10 : 0,
      })),
    file_rework: [...fileReworkAcc.entries()]
      .sort(
        ([, a], [, b]) =>
          (b.total_edits > 0 ? b.failed_edits / b.total_edits : 0) -
          (a.total_edits > 0 ? a.failed_edits / a.total_edits : 0),
      )
      .slice(0, 20)
      .map(([file, v]) => ({
        file,
        total_edits: v.total_edits,
        failed_edits: v.failed_edits,
        rework_ratio:
          v.total_edits > 0 ? Math.round((v.failed_edits / v.total_edits) * 100) / 100 : 0,
      })),
    directory_heatmap: [...dirHeatmapAcc.entries()]
      .sort(([, a], [, b]) => b.touch_count - a.touch_count)
      .slice(0, 20)
      .map(([directory, v]) => ({
        directory,
        touch_count: v.touch_count,
        file_count: v.file_count,
        total_lines: v.total_lines,
        completion_rate: v.rate_count > 0 ? Math.round((v.rate_sum / v.rate_count) * 10) / 10 : 0,
      })),
    stuckness: {
      total_sessions: stucknessAcc.total_sessions,
      stuck_sessions: stucknessAcc.stuck_sessions,
      stuckness_rate:
        stucknessAcc.total_sessions > 0
          ? Math.round((stucknessAcc.stuck_sessions / stucknessAcc.total_sessions) * 1000) / 10
          : 0,
      stuck_completion_rate:
        stucknessAcc.stuck_total > 0
          ? Math.round((stucknessAcc.stuck_completed / stucknessAcc.stuck_total) * 1000) / 10
          : 0,
      normal_completion_rate:
        stucknessAcc.normal_total > 0
          ? Math.round((stucknessAcc.normal_completed / stucknessAcc.normal_total) * 1000) / 10
          : 0,
    },
    file_overlap: {
      total_files: fileOverlapAcc.total_files,
      overlapping_files: fileOverlapAcc.overlapping_files,
      overlap_rate:
        fileOverlapAcc.total_files > 0
          ? Math.round((fileOverlapAcc.overlapping_files / fileOverlapAcc.total_files) * 1000) / 10
          : 0,
    },
    audit_staleness: [...auditStalenessAcc.entries()]
      .sort(([, a], [, b]) => b.days_since - a.days_since)
      .slice(0, 20)
      .map(([directory, v]) => ({
        directory,
        last_edit: v.last_edit,
        days_since: v.days_since,
        prior_edit_count: v.prior_edit_count,
      })),
    first_edit_stats: {
      avg_minutes_to_first_edit:
        firstEditAcc.count > 0
          ? Math.round((firstEditAcc.sum_avg / firstEditAcc.count) * 10) / 10
          : 0,
      median_minutes_to_first_edit:
        firstEditAcc.count > 0
          ? Math.round((firstEditAcc.sum_median / firstEditAcc.count) * 10) / 10
          : 0,
      by_tool: [...firstEditAcc.by_tool.entries()]
        .sort(([, a], [, b]) => b.sessions - a.sessions)
        .map(([host_tool, v]) => ({
          host_tool,
          avg_minutes: v.sessions > 0 ? Math.round((v.sum_avg / v.sessions) * 10) / 10 : 0,
          sessions: v.sessions,
        })),
    },
    memory_outcome_correlation: [...memOutcomeAcc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, v]) => ({
        bucket,
        sessions: v.sessions,
        completed: v.completed,
        completion_rate: v.sessions > 0 ? Math.round((v.completed / v.sessions) * 1000) / 10 : 0,
      })),
    top_memories: [...topMemoriesAcc.entries()]
      .sort(([, a], [, b]) => b.access_count - a.access_count)
      .slice(0, 20)
      .map(([id, v]) => ({
        id,
        text_preview: v.text_preview,
        access_count: v.access_count,
        last_accessed_at: v.last_accessed_at,
        created_at: v.created_at,
      })),
    period_comparison: (() => {
      const cs = periodCurrentAcc.total_sessions_sum;
      const ps = periodPreviousAcc.total_sessions_sum;
      return {
        current: {
          completion_rate:
            cs > 0 ? Math.round((periodCurrentAcc.completion_sum / cs) * 10) / 10 : 0,
          avg_duration_min: cs > 0 ? Math.round((periodCurrentAcc.duration_sum / cs) * 10) / 10 : 0,
          stuckness_rate: cs > 0 ? Math.round((periodCurrentAcc.stuck_sum / cs) * 10) / 10 : 0,
          memory_hit_rate:
            cs > 0 ? Math.round((periodCurrentAcc.memory_hit_sum / cs) * 10) / 10 : 0,
          edit_velocity: cs > 0 ? Math.round((periodCurrentAcc.velocity_sum / cs) * 10) / 10 : 0,
          total_sessions: cs,
        },
        previous:
          periodPreviousAcc.count > 0
            ? {
                completion_rate:
                  ps > 0 ? Math.round((periodPreviousAcc.completion_sum / ps) * 10) / 10 : 0,
                avg_duration_min:
                  ps > 0 ? Math.round((periodPreviousAcc.duration_sum / ps) * 10) / 10 : 0,
                stuckness_rate:
                  ps > 0 ? Math.round((periodPreviousAcc.stuck_sum / ps) * 10) / 10 : 0,
                memory_hit_rate:
                  ps > 0 ? Math.round((periodPreviousAcc.memory_hit_sum / ps) * 10) / 10 : 0,
                edit_velocity:
                  ps > 0 ? Math.round((periodPreviousAcc.velocity_sum / ps) * 10) / 10 : 0,
                total_sessions: ps,
              }
            : null,
      };
    })(),
    token_usage: tokenUsagePayload,
    scope_complexity: [...scopeComplexityAcc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, v]) => ({
        bucket,
        sessions: v.sessions,
        avg_edits: v.sessions > 0 ? Math.round(v.edits_sum / v.sessions) : 0,
        avg_duration_min: v.sessions > 0 ? Math.round((v.duration_sum / v.sessions) * 10) / 10 : 0,
        completion_rate: v.sessions > 0 ? Math.round((v.completed / v.sessions) * 1000) / 10 : 0,
      })),
    prompt_efficiency: [...promptEfficiencyAcc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({
        day,
        avg_turns_per_edit: v.sessions > 0 ? Math.round((v.turns_sum / v.sessions) * 10) / 10 : 0,
        sessions: v.sessions,
      })),
    hourly_effectiveness: [...hourlyEffectivenessAcc.entries()]
      .sort(([a], [b]) => a - b)
      .map(([hour, v]) => ({
        hour,
        sessions: v.sessions,
        completion_rate: v.sessions > 0 ? Math.round((v.completed / v.sessions) * 1000) / 10 : 0,
        avg_edits: v.sessions > 0 ? Math.round(v.edits_sum / v.sessions) : 0,
      })),
    outcome_tags: [...outcomeTagsAcc.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 30)
      .map(([key, count]) => {
        const sep = key.lastIndexOf(':');
        return { tag: key.slice(0, sep), outcome: key.slice(sep + 1), count };
      }),
    tool_handoffs: [...toolHandoffsAcc.entries()]
      .sort(([, a], [, b]) => b.file_count - a.file_count)
      .slice(0, 20)
      .map(([key, v]) => {
        const sep = key.indexOf(':');
        return {
          from_tool: key.slice(0, sep),
          to_tool: key.slice(sep + 1),
          file_count: v.file_count,
          handoff_completion_rate:
            v.total > 0 ? Math.round((v.completed / v.total) * 1000) / 10 : 0,
        };
      }),
    commit_stats: (() => {
      const totalSessions = completionAcc.total_sessions || 1;
      return {
        total_commits: commitAcc.total_commits,
        commits_per_session:
          totalSessions > 0 ? Math.round((commitAcc.total_commits / totalSessions) * 100) / 100 : 0,
        sessions_with_commits: commitAcc.sessions_with_commits,
        avg_time_to_first_commit_min:
          commitAcc.ttfc_count > 0
            ? Math.round((commitAcc.ttfc_sum / commitAcc.ttfc_count) * 10) / 10
            : null,
        by_tool: [...commitByTool.entries()]
          .sort(([, a], [, b]) => b.commits - a.commits)
          .map(([host_tool, v]) => ({
            host_tool,
            commits: v.commits,
            avg_files_changed: v.commits > 0 ? Math.round((v.files_sum / v.commits) * 10) / 10 : 0,
            avg_lines: v.commits > 0 ? Math.round((v.lines_sum / v.commits) * 10) / 10 : 0,
          })),
        daily_commits: [...commitDaily.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([day, commits]) => ({ day, commits })),
        outcome_correlation: [...commitOutcomeAcc.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([bucket, v]) => ({
            bucket,
            sessions: v.sessions,
            completed: v.completed,
            completion_rate:
              v.sessions > 0 ? Math.round((v.completed / v.sessions) * 1000) / 10 : 0,
          })),
        commit_edit_ratio: [...commitEditRatioAcc.entries()].map(([bucket, v]) => ({
          bucket,
          sessions: v.sessions,
          completion_rate: v.sessions > 0 ? Math.round((v.completed / v.sessions) * 1000) / 10 : 0,
          avg_edits: v.sessions > 0 ? Math.round((v.edits_sum / v.sessions) * 10) / 10 : 0,
          avg_commits: v.sessions > 0 ? Math.round((v.commits_sum / v.sessions) * 10) / 10 : 0,
        })),
      };
    })(),
    data_coverage: (() => {
      const allTools = [...activeToolsSet];
      const capConversation = new Set(getToolsWithCapability('conversationLogs'));
      const capTokens = new Set(getToolsWithCapability('tokenUsage'));
      const reporting = allTools.filter((t) => capConversation.has(t) || capTokens.has(t));
      const withoutData = allTools.filter((t) => !capConversation.has(t) && !capTokens.has(t));
      const capsAvailable: string[] = [];
      const capsMissing: string[] = [];
      if (allTools.some((t) => capConversation.has(t))) capsAvailable.push('conversationLogs');
      else if (allTools.length > 0) capsMissing.push('conversationLogs');
      if (allTools.some((t) => capTokens.has(t))) capsAvailable.push('tokenUsage');
      else if (allTools.length > 0) capsMissing.push('tokenUsage');
      return {
        tools_reporting: reporting,
        tools_without_data: withoutData,
        coverage_rate:
          allTools.length > 0 ? Math.round((reporting.length / allTools.length) * 100) / 100 : 1,
        capabilities_available: capsAvailable,
        capabilities_missing: capsMissing,
      };
    })(),
    teams_included: included,
    degraded: failed > 0,
  });
});

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const handleUserSessions = authedRoute(async ({ request, user, env }) => {
  const url = new URL(request.url);
  const from = url.searchParams.get('from') || todayStr();
  const to = url.searchParams.get('to') || todayStr();

  const db = getDB(env);
  const teamsResult = rpc(await db.getUserTeams(user.id));
  const teams: Array<{ team_id: string; team_name: string | null }> = teamsResult.teams;

  if (teams.length === 0) {
    return json({
      ok: true,
      sessions: [],
      totals: { sessions: 0, edits: 0, lines_added: 0, lines_removed: 0, tools: [] },
    });
  }

  const capped = teams.slice(0, MAX_DASHBOARD_TEAMS);
  const results = await Promise.allSettled(
    capped.map(async (t) => {
      const team = getTeam(env, t.team_id);
      try {
        const result = rpc(
          await withTimeout(
            team.getSessionsInRange(user.id, from, to) as unknown as Promise<
              Record<string, unknown>
            >,
            DO_CALL_TIMEOUT_MS,
          ),
        );
        if (result.error) return [];
        return ((result.sessions as Array<Record<string, unknown>>) || []).map((s) => ({
          ...s,
          team_id: t.team_id,
          team_name: t.team_name,
        }));
      } catch (err) {
        log.error('failed to fetch team sessions', {
          teamId: t.team_id,
          error: getErrorMessage(err),
        });
        return [];
      }
    }),
  );

  const allSessions: Array<Record<string, unknown>> = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      for (const s of r.value) allSessions.push(s);
    }
  }
  allSessions.sort((a, b) => String(a.started_at || '').localeCompare(String(b.started_at || '')));

  const totals = {
    sessions: allSessions.length,
    edits: allSessions.reduce((s, r) => s + ((r.edit_count as number) || 0), 0),
    lines_added: allSessions.reduce((s, r) => s + ((r.lines_added as number) || 0), 0),
    lines_removed: allSessions.reduce((s, r) => s + ((r.lines_removed as number) || 0), 0),
    tools: [...new Set(allSessions.map((s) => s.host_tool as string).filter(Boolean))],
  };

  return json({ ok: true, sessions: allSessions, totals });
});
