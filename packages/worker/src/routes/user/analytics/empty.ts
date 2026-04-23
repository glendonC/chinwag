// Empty-teams response. Returned when the caller has no teams (or filtered
// them all out) — the schema requires these fields to be present with
// zero-shaped values, so we build them explicitly here rather than
// running the accumulators against an empty fan-out.

import type { UserAnalytics } from '@chinmeister/shared/contracts/analytics.js';

/**
 * Shape the body returned by /me/analytics when the user has no visible
 * teams. `period_days` echoes the requested window so the UI can render
 * the chosen range; all analytic slices are empty or zeroed.
 *
 * Typed as UserAnalytics so TypeScript catches any schema drift at
 * compile time rather than waiting for a runtime safeParse mismatch.
 */
export function buildEmptyAnalyticsResponse(days: number): UserAnalytics {
  return {
    ok: true as const,
    period_days: days,
    file_heatmap: [],
    daily_trends: [],
    tool_distribution: [],
    outcome_distribution: [],
    daily_metrics: [],
    files_touched_total: 0,
    hourly_distribution: [],
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
    member_analytics_total: 0,
    member_daily_lines: [],
    per_project_lines: [],
    retry_patterns: [],
    conflict_correlation: [],
    conflict_stats: { blocked_period: 0, found_period: 0 },
    edit_velocity: [],
    memory_usage: {
      total_memories: 0,
      searches: 0,
      searches_with_results: 0,
      search_hit_rate: 0,
      memories_created_period: 0,
      stale_memories: 0,
      avg_memory_age_days: 0,
      pending_consolidation_proposals: 0,
      formation_observations_by_recommendation: { keep: 0, merge: 0, evolve: 0, discard: 0 },
      secrets_blocked_24h: 0,
    },
    period_comparison: {
      current: {
        completion_rate: 0,
        avg_duration_min: 0,
        stuckness_rate: 0,
        memory_hit_rate: 0,
        edit_velocity: 0,
        total_sessions: 0,
        total_estimated_cost_usd: null,
        total_edits_in_token_sessions: 0,
        cost_per_edit: null,
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
      total_edits_in_token_sessions: 0,
      // null = "we have no data capability assertion for cost" (no teams,
      // no enrichment ran). Matches shared contract .default(null) and the
      // `hasCostData` gate renders `--`. Using 0 here would read as
      // measured-zero cost to any consumer that bypasses the gate.
      total_estimated_cost_usd: null,
      pricing_refreshed_at: null,
      pricing_is_stale: false,
      models_without_pricing: [],
      models_without_pricing_total: 0,
      cost_per_edit: null,
      cache_hit_rate: null,
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
    tool_call_stats: {
      total_calls: 0,
      total_errors: 0,
      error_rate: 0,
      avg_duration_ms: 0,
      calls_per_session: 0,
      research_to_edit_ratio: 0,
      one_shot_rate: 0,
      one_shot_sessions: 0,
      frequency: [],
      error_patterns: [],
      hourly_activity: [],
    },
    work_type_outcomes: [],
    conversation_edit_correlation: [],
    file_rework: [],
    directory_heatmap: [],
    files_by_work_type: [],
    files_new_vs_revisited: { new_files: 0, revisited_files: 0 },
    stuckness: {
      total_sessions: 0,
      stuck_sessions: 0,
      stuckness_rate: 0,
      stuck_completion_rate: 0,
      normal_completion_rate: 0,
    },
    file_overlap: {
      total_files: 0,
      overlapping_files: 0,
    },
    audit_staleness: [],
    first_edit_stats: {
      avg_minutes_to_first_edit: 0,
      median_minutes_to_first_edit: 0,
      by_tool: [],
    },
    memory_outcome_correlation: [],
    top_memories: [],
    scope_complexity: [],
    prompt_efficiency: [],
    hourly_effectiveness: [],
    outcome_tags: [],
    tool_handoffs: [],
    teams_included: 0,
    degraded: false,
    per_project_velocity: [],
  };
}
