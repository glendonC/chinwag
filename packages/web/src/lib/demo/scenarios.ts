// Demo scenario registry. Each scenario returns a { analytics, conversation,
// live } triple. Scenarios build from the healthy baseline and override only
// the fields that change - this keeps the surface area auditable and
// prevents "shadow baseline" drift when one widget needs a tweak.
//
// Adding a scenario: pick a specific question a widget asks (e.g. "what
// does cost-per-edit look like when pricing is stale?"), pick the minimum
// fields that answer it, and write an override. Do not clone the whole
// baseline; use the spread helper.

import type {
  UserAnalytics,
  ConversationAnalytics,
  UserProfile,
  UserTeams,
  DashboardSummary,
  TeamContext,
} from '../apiSchemas.js';
import { createBaselineAnalytics, DEFAULT_PERIOD_DAYS } from './baseline.js';
import { createBaselineConversation } from './conversation.js';
import { createBaselineLive, createEmptyLive, type LiveDemoData } from './live.js';
import { createBaselineReports, createEmptyReports, type ReportsDemoData } from './reports.js';
import { createBaselineMe, createBaselineTeams, createEmptyTeams } from './me.js';
import {
  createBaselineDashboard,
  createEmptyDashboard,
  createBaselineTeamContexts,
  createEmptyTeamContexts,
} from './dashboard.js';
import {
  createBaselineGlobalRank,
  createEmptyGlobalRank,
  createBaselineGlobalStats,
  createEmptyGlobalStats,
  createBaselineSessions,
  createEmptySessions,
  type SessionsDemoData,
} from './global.js';
import type { GlobalRank } from '../../hooks/useGlobalRank.js';
import type { GlobalStats } from '../../hooks/useGlobalStats.js';
import { buildDaySpine } from './rng.js';

export type DemoScenarioId =
  | 'healthy'
  | 'empty'
  | 'solo-cc'
  | 'solo-no-hooks'
  | 'stale-pricing'
  | 'models-without-pricing'
  | 'first-period'
  | 'team-conflicts'
  | 'negative-delta'
  | 'no-live-agents'
  | 'memory-stale'
  | 'memory-concentrated';

export interface DemoData {
  analytics: UserAnalytics;
  conversation: ConversationAnalytics;
  live: LiveDemoData;
  reports: ReportsDemoData;
  me: UserProfile;
  teams: UserTeams;
  dashboard: DashboardSummary;
  teamContexts: Record<string, TeamContext>;
  globalRank: GlobalRank;
  globalStats: GlobalStats;
  sessions: SessionsDemoData;
}

export interface DemoScenario {
  id: DemoScenarioId;
  label: string;
  description: string;
  build: () => DemoData;
}

// ── Helpers for the non-Overview slices ─────────────────────────────
//
// Most scenarios share the same identity/teams/dashboard/global frames -
// the differentiating story lives in analytics/conversation/live. These
// helpers keep that story authored in one place per builder instead of
// repeating 7 fields per scenario. Solo scenarios narrow to one team;
// empty/no-hooks zero everything except `me` (the user is still logged in).

type DemoFrame = Pick<
  DemoData,
  'me' | 'teams' | 'dashboard' | 'teamContexts' | 'globalRank' | 'globalStats' | 'sessions'
>;

function baselineFrame(): DemoFrame {
  return {
    me: createBaselineMe(),
    teams: createBaselineTeams(),
    dashboard: createBaselineDashboard(),
    teamContexts: createBaselineTeamContexts(),
    globalRank: createBaselineGlobalRank(),
    globalStats: createBaselineGlobalStats(),
    sessions: createBaselineSessions(),
  };
}

function emptyFrame(): DemoFrame {
  return {
    me: createBaselineMe(), // user is still logged in even when nothing has happened
    teams: createEmptyTeams(),
    dashboard: createEmptyDashboard(),
    teamContexts: createEmptyTeamContexts(),
    globalRank: createEmptyGlobalRank(),
    globalStats: createEmptyGlobalStats(),
    sessions: createEmptySessions(),
  };
}

function singleTeamFrame(teamId = 'team-frontend'): DemoFrame {
  const base = baselineFrame();
  const team = base.teams.teams.find((t) => t.team_id === teamId);
  const teamCtx = base.teamContexts[teamId];
  return {
    ...base,
    teams: { teams: team ? [team] : [] },
    dashboard: {
      ...base.dashboard,
      teams: base.dashboard.teams.filter((t) => t.team_id === teamId),
    },
    teamContexts: teamCtx ? { [teamId]: teamCtx } : {},
    sessions: {
      ...base.sessions,
      sessions: base.sessions.sessions.filter((s) => s.team_id === teamId),
    },
  };
}

// ── Scenario builders ───────────────────────────────────────────────

// Healthy: baseline, unchanged.
function healthy(): DemoData {
  return {
    analytics: createBaselineAnalytics(),
    conversation: createBaselineConversation(),
    live: createBaselineLive(),
    reports: createBaselineReports(),
    ...baselineFrame(),
  };
}

// Empty: valid UserAnalytics shape with zero sessions everywhere. Exercises
// every empty-state branch in the widget tree simultaneously. Built from
// scratch rather than from baseline because "zero everything" would require
// overriding nearly every field.
function empty(): DemoData {
  const days = buildDaySpine(DEFAULT_PERIOD_DAYS);
  const analytics: UserAnalytics = {
    ok: true,
    period_days: DEFAULT_PERIOD_DAYS,
    teams_included: 1,
    degraded: false,
    file_heatmap: [],
    files_touched_total: 0,
    files_touched_half_split: null,
    files_by_work_type: [],
    files_new_vs_revisited: { new_files: 0, revisited_files: 0 },
    daily_trends: days.map((day) => ({
      day,
      sessions: 0,
      edits: 0,
      lines_added: 0,
      lines_removed: 0,
      avg_duration_min: 0,
      completed: 0,
      abandoned: 0,
      failed: 0,
      cost: null,
      cost_per_edit: null,
    })),
    tool_distribution: [],
    outcome_distribution: [],
    daily_metrics: [],
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
    per_project_velocity: [],
    retry_patterns: [],
    conflict_correlation: [],
    conflict_stats: { blocked_period: 0, found_period: 0, daily_blocked: [] },
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
    work_type_outcomes: [],
    conversation_edit_correlation: [],
    file_rework: [],
    directory_heatmap: [],
    stuckness: {
      total_sessions: 0,
      stuck_sessions: 0,
      stuckness_rate: 0,
      stuck_completion_rate: 0,
      normal_completion_rate: 0,
    },
    file_overlap: { total_files: 0, overlapping_files: 0 },
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
      total_estimated_cost_usd: 0,
      pricing_refreshed_at: null,
      pricing_is_stale: false,
      models_without_pricing: [],
      models_without_pricing_total: 0,
      cost_per_edit: null,
      cache_hit_rate: null,
      by_model: [],
      by_tool: [],
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
      host_one_shot: [],
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
    data_coverage: {
      tools_reporting: [],
      tools_without_data: [],
      coverage_rate: 0,
      capabilities_available: [],
      capabilities_missing: [
        'hooks',
        'tokenUsage',
        'conversationLogs',
        'toolCallLogs',
        'commitTracking',
      ],
    },
    confused_files: [],
    unanswered_questions: { count: 0 },
    cross_tool_handoff_questions: [],
    cross_tool_memory_flow: [],
    memory_aging: { recent_7d: 0, recent_30d: 0, recent_90d: 0, older: 0 },
    memory_categories: [],
    memory_single_author_directories: [],
    memory_supersession: { invalidated_period: 0, merged_period: 0, pending_proposals: 0 },
    memory_secrets_shield: { blocked_period: 0, blocked_24h: 0 },
  };
  const conversation: ConversationAnalytics = {
    ok: true,
    period_days: DEFAULT_PERIOD_DAYS,
    total_messages: 0,
    user_messages: 0,
    assistant_messages: 0,
    sentiment_distribution: [],
    topic_distribution: [],
    sentiment_outcome_correlation: [],
    sessions_with_conversations: 0,
    tool_coverage: { supported_tools: [], unsupported_tools: [] },
  };
  return {
    analytics,
    conversation,
    live: createEmptyLive(),
    reports: createEmptyReports(),
    ...emptyFrame(),
  };
}

// Solo on Claude Code: one handle, one tool, full capture. Exercises the
// "requires 2+ agents" gating on conflict/team/handoff widgets without
// wiping the deep-capture stats that make CC the richest single-tool demo.
function soloCC(): DemoData {
  const base = createBaselineAnalytics();
  const analytics: UserAnalytics = {
    ...base,
    teams_included: 1,
    tool_distribution: base.tool_distribution.filter((t) => t.host_tool === 'claude-code'),
    tool_comparison: base.tool_comparison.filter((t) => t.host_tool === 'claude-code'),
    tool_outcomes: base.tool_outcomes.filter((t) => t.host_tool === 'claude-code'),
    tool_daily: base.tool_daily.filter((t) => t.host_tool === 'claude-code'),
    tool_work_type: base.tool_work_type.filter((t) => t.host_tool === 'claude-code'),
    tool_handoffs: [],
    concurrent_edits: [],
    file_overlap: { total_files: 0, overlapping_files: 0 },
    conflict_correlation: [],
    conflict_stats: { blocked_period: 0, found_period: 0, daily_blocked: [] },
    retry_patterns: [],
    member_analytics: base.member_analytics.slice(0, 1),
    member_analytics_total: 1,
    member_daily_lines: base.member_daily_lines.filter(
      (m) => m.handle === base.member_analytics[0]!.handle,
    ),
    per_project_velocity: base.per_project_velocity.slice(0, 1),
    per_project_lines: base.per_project_lines.filter(
      (p) => p.team_id === base.per_project_velocity[0]!.team_id,
    ),
    data_coverage: {
      tools_reporting: ['claude-code'],
      tools_without_data: [],
      coverage_rate: 1,
      capabilities_available: [
        'hooks',
        'tokenUsage',
        'conversationLogs',
        'toolCallLogs',
        'commitTracking',
      ],
      capabilities_missing: [],
    },
  };
  // Conversation data shrinks to just Claude Code's share.
  const baseConv = createBaselineConversation();
  const scale = 0.45; // CC's rough share of convo-capable sessions
  const conversation: ConversationAnalytics = {
    ...baseConv,
    total_messages: Math.round(baseConv.total_messages * scale),
    user_messages: Math.round(baseConv.user_messages * scale),
    assistant_messages: Math.round(baseConv.assistant_messages * scale),
    sessions_with_conversations: Math.round(baseConv.sessions_with_conversations * scale),
    sentiment_distribution: baseConv.sentiment_distribution
      .map((s) => ({
        ...s,
        count: Math.round(s.count * scale),
      }))
      .filter((s) => s.count > 0),
    topic_distribution: baseConv.topic_distribution
      .map((t) => ({
        ...t,
        count: Math.round(t.count * scale),
      }))
      .filter((t) => t.count > 0),
    sentiment_outcome_correlation: baseConv.sentiment_outcome_correlation
      .map((s) => ({
        ...s,
        sessions: Math.round(s.sessions * scale),
        completed: Math.round(s.completed * scale),
        abandoned: Math.round(s.abandoned * scale),
        failed: Math.round(s.failed * scale),
      }))
      .filter((s) => s.sessions > 0),
    tool_coverage: { supported_tools: ['claude-code'], unsupported_tools: [] },
  };
  const baseLive = createBaselineLive();
  const live: LiveDemoData = {
    liveAgents: baseLive.liveAgents
      .filter((a) => a.host_tool === 'claude-code' && a.handle === 'glendon')
      .slice(0, 1),
    locks: baseLive.locks
      .filter((l) => l.host_tool === 'claude-code' && l.handle === 'glendon')
      .slice(0, 1),
    summaries: baseLive.summaries
      .slice(0, 1)
      .map((s) => ({ ...s, active_agents: 1, conflict_count: 0 })),
  };
  return {
    analytics,
    conversation,
    live,
    reports: createBaselineReports(),
    ...singleTeamFrame('team-frontend'),
  };
}

// Solo on a non-hook MCP tool (JetBrains). No hooks, no token data, no
// conversation capture, no tool calls, no commit tracking. The deep-capture
// widgets all fall through to coverage notes explaining which tool would
// provide the data.
function soloNoHooks(): DemoData {
  const base = soloCC().analytics;
  const analytics: UserAnalytics = {
    ...base,
    tool_distribution: [
      {
        host_tool: 'jetbrains',
        sessions: base.completion_summary.total_sessions,
        edits: base.tool_distribution[0]?.edits ?? 0,
      },
    ],
    tool_comparison: base.tool_comparison.map((t) => ({ ...t, host_tool: 'jetbrains' })),
    tool_outcomes: base.tool_outcomes.map((t) => ({ ...t, host_tool: 'jetbrains' })),
    tool_daily: base.tool_daily.map((t) => ({ ...t, host_tool: 'jetbrains' })),
    tool_work_type: base.tool_work_type.map((t) => ({ ...t, host_tool: 'jetbrains' })),
    model_outcomes: [],
    token_usage: {
      ...base.token_usage,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cache_read_tokens: 0,
      total_cache_creation_tokens: 0,
      avg_input_per_session: 0,
      avg_output_per_session: 0,
      sessions_with_token_data: 0,
      sessions_without_token_data: base.completion_summary.total_sessions,
      total_edits_in_token_sessions: 0,
      total_estimated_cost_usd: 0,
      cost_per_edit: null,
      cache_hit_rate: null,
      by_model: [],
      by_tool: [],
    },
    tool_call_stats: {
      ...base.tool_call_stats,
      total_calls: 0,
      total_errors: 0,
      error_rate: 0,
      one_shot_rate: 0,
      one_shot_sessions: 0,
      research_to_edit_ratio: 0,
      calls_per_session: 0,
      frequency: [],
      error_patterns: [],
      hourly_activity: [],
    },
    commit_stats: {
      total_commits: 0,
      commits_per_session: 0,
      sessions_with_commits: 0,
      avg_time_to_first_commit_min: null,
      by_tool: [],
      daily_commits: base.commit_stats.daily_commits.map((d) => ({ ...d, commits: 0 })),
      outcome_correlation: [],
      commit_edit_ratio: [],
    },
    daily_trends: base.daily_trends.map((d) => ({ ...d, cost: null, cost_per_edit: null })),
    period_comparison: {
      ...base.period_comparison,
      current: {
        ...base.period_comparison.current,
        total_estimated_cost_usd: null,
        total_edits_in_token_sessions: 0,
        cost_per_edit: null,
      },
      previous: base.period_comparison.previous
        ? {
            ...base.period_comparison.previous,
            total_estimated_cost_usd: null,
            total_edits_in_token_sessions: 0,
            cost_per_edit: null,
          }
        : null,
    },
    data_coverage: {
      tools_reporting: ['jetbrains'],
      tools_without_data: [],
      coverage_rate: 1,
      capabilities_available: [],
      capabilities_missing: [
        'hooks',
        'tokenUsage',
        'conversationLogs',
        'toolCallLogs',
        'commitTracking',
      ],
    },
  };
  const conversation: ConversationAnalytics = {
    ok: true,
    period_days: DEFAULT_PERIOD_DAYS,
    total_messages: 0,
    user_messages: 0,
    assistant_messages: 0,
    sentiment_distribution: [],
    topic_distribution: [],
    sentiment_outcome_correlation: [],
    sessions_with_conversations: 0,
    tool_coverage: { supported_tools: [], unsupported_tools: ['jetbrains'] },
  };
  return {
    analytics,
    conversation,
    live: {
      liveAgents: [],
      locks: [],
      summaries: [
        {
          team_id: 'team-frontend',
          team_name: 'frontend',
          active_agents: 1,
          memory_count: 6,
          recent_sessions_24h: 4,
          conflict_count: 0,
          hosts_configured: [{ host_tool: 'jetbrains', joins: 1 }],
          surfaces_seen: [],
          models_seen: [],
          usage: {},
        },
      ],
    },
    reports: createEmptyReports(),
    ...singleTeamFrame('team-frontend'),
  };
}

// Stale pricing: snapshot is >7 days old, cost fields null. Widgets should
// render "--" with the "Pricing refresh pending" coverage note.
function stalePricing(): DemoData {
  const base = createBaselineAnalytics();
  return {
    analytics: {
      ...base,
      token_usage: {
        ...base.token_usage,
        pricing_is_stale: true,
        pricing_refreshed_at: new Date(Date.now() - 9 * 86400_000).toISOString(),
        total_estimated_cost_usd: 0,
        cost_per_edit: null,
        by_model: base.token_usage.by_model.map((m) => ({ ...m, estimated_cost_usd: null })),
      },
      daily_trends: base.daily_trends.map((d) => ({ ...d, cost: null, cost_per_edit: null })),
      period_comparison: {
        ...base.period_comparison,
        current: {
          ...base.period_comparison.current,
          total_estimated_cost_usd: null,
          cost_per_edit: null,
        },
        previous: base.period_comparison.previous
          ? {
              ...base.period_comparison.previous,
              total_estimated_cost_usd: null,
              cost_per_edit: null,
            }
          : null,
      },
    },
    conversation: createBaselineConversation(),
    live: createBaselineLive(),
    reports: createBaselineReports(),
    ...baselineFrame(),
  };
}

// Models without pricing: the LiteLLM snapshot is fresh but doesn't know
// some of the models we observed. Coverage note names which model.
function modelsWithoutPricing(): DemoData {
  const base = createBaselineAnalytics();
  const byModel = base.token_usage.by_model.map((m, i) =>
    i < 2 ? m : { ...m, estimated_cost_usd: null },
  );
  const priced = byModel.filter((m) => m.estimated_cost_usd != null);
  const partialCost = priced.reduce((s, m) => s + (m.estimated_cost_usd ?? 0), 0);
  const missing = byModel.filter((m) => m.estimated_cost_usd == null).map((m) => m.agent_model);
  return {
    analytics: {
      ...base,
      token_usage: {
        ...base.token_usage,
        total_estimated_cost_usd: Math.round(partialCost * 100) / 100,
        by_model: byModel,
        models_without_pricing: missing,
        models_without_pricing_total: missing.length,
      },
    },
    conversation: createBaselineConversation(),
    live: createBaselineLive(),
    reports: createBaselineReports(),
    ...baselineFrame(),
  };
}

// First period: no previous window to compare against. Every delta pill
// suppresses (InlineDelta returns null when previous is null/≤0).
function firstPeriod(): DemoData {
  const base = createBaselineAnalytics();
  return {
    analytics: {
      ...base,
      completion_summary: { ...base.completion_summary, prev_completion_rate: null },
      period_comparison: { ...base.period_comparison, previous: null },
    },
    conversation: createBaselineConversation(),
    live: createBaselineLive(),
    reports: createBaselineReports(),
    ...baselineFrame(),
  };
}

// Team with active conflicts: more collisions, higher retry volume, larger
// file_overlap and concurrent_edits lists. Demonstrates the coordination
// story end-to-end: live-conflicts → retry patterns → file overlap.
function teamConflicts(): DemoData {
  const base = createBaselineAnalytics();
  return {
    analytics: {
      ...base,
      conflict_stats: { blocked_period: 18, found_period: 47, daily_blocked: [] },
      file_overlap: { total_files: base.file_overlap.total_files, overlapping_files: 42 },
      retry_patterns: [
        ...base.retry_patterns,
        {
          file: 'packages/web/src/views/OverviewView/OverviewView.tsx',
          attempts: 9,
          agents: 4,
          tools: ['claude-code', 'cursor', 'windsurf'],
          final_outcome: 'completed',
          resolved: true,
        },
        {
          file: 'packages/worker/src/routes/team/membership.ts',
          attempts: 7,
          agents: 3,
          tools: ['claude-code', 'aider'],
          final_outcome: 'failed',
          resolved: false,
        },
        {
          file: 'packages/cli/lib/dashboard/App.tsx',
          attempts: 6,
          agents: 2,
          tools: ['cursor', 'claude-code'],
          final_outcome: 'abandoned',
          resolved: false,
        },
      ],
      concurrent_edits: [
        ...base.concurrent_edits,
        { file: 'packages/web/src/views/OverviewView/OverviewView.tsx', agents: 4, edit_count: 28 },
        { file: 'packages/worker/src/routes/team/membership.ts', agents: 3, edit_count: 19 },
      ],
      conflict_correlation: [
        { bucket: 'with conflicts', sessions: 68, completed: 36, completion_rate: 53 },
        {
          bucket: 'without',
          sessions: base.completion_summary.total_sessions - 68,
          completed: Math.round((base.completion_summary.total_sessions - 68) * 0.79),
          completion_rate: 79,
        },
      ],
    },
    conversation: createBaselineConversation(),
    live: createBaselineLive(),
    reports: createBaselineReports(),
    ...baselineFrame(),
  };
}

// Negative delta: period got worse. Flips the previous-period numbers so
// the enriched stat cards render red downward arrows. Stuckness, cost,
// completion rate all move the wrong way.
function negativeDelta(): DemoData {
  const base = createBaselineAnalytics();
  const curr = base.period_comparison.current;
  return {
    analytics: {
      ...base,
      period_comparison: {
        current: curr,
        previous: {
          completion_rate: Math.min(100, curr.completion_rate + 8),
          avg_duration_min: Math.max(1, curr.avg_duration_min - 4),
          stuckness_rate: Math.max(0, curr.stuckness_rate - 6),
          memory_hit_rate: Math.min(100, curr.memory_hit_rate + 12),
          edit_velocity: curr.edit_velocity + 0.6,
          total_sessions: Math.round(curr.total_sessions * 1.18),
          total_estimated_cost_usd:
            curr.total_estimated_cost_usd != null
              ? Math.round(curr.total_estimated_cost_usd * 0.78 * 100) / 100
              : null,
          total_edits_in_token_sessions: Math.round(curr.total_edits_in_token_sessions * 1.12),
          cost_per_edit:
            curr.cost_per_edit != null
              ? Math.round(curr.cost_per_edit * 0.72 * 10_000) / 10_000
              : null,
        },
      },
      completion_summary: {
        ...base.completion_summary,
        prev_completion_rate: Math.min(100, curr.completion_rate + 8),
      },
    },
    conversation: createBaselineConversation(),
    live: createBaselineLive(),
    reports: createBaselineReports(),
    ...baselineFrame(),
  };
}

// No live agents: analytics populated, live presence empty. Exercises
// live-agents / live-conflicts / files-in-play empty states without
// hiding everything else.
function noLiveAgents(): DemoData {
  return {
    analytics: createBaselineAnalytics(),
    conversation: createBaselineConversation(),
    live: createEmptyLive(),
    reports: createBaselineReports(),
    ...baselineFrame(),
  };
}

// Memory stale: aging skewed to >90d, stale count high. Exercises the
// freshness-warn and stale-tinted paths in the memory tile + freshness
// hero. Other categories unchanged so we can see memory-only severity.
function memoryStale(): DemoData {
  const base = createBaselineAnalytics();
  const totalMemories = 56;
  return {
    analytics: {
      ...base,
      memory_usage: {
        ...base.memory_usage,
        total_memories: totalMemories,
        stale_memories: 28,
        avg_memory_age_days: 118,
        memories_created_period: 2,
      },
      memory_aging: { recent_7d: 1, recent_30d: 4, recent_90d: 12, older: 39 },
      memory_supersession: {
        invalidated_period: 0,
        merged_period: 1,
        pending_proposals: 8,
      },
    },
    conversation: createBaselineConversation(),
    live: createBaselineLive(),
    reports: createBaselineReports(),
    ...baselineFrame(),
  };
}

// Memory concentrated: single-author directories dominate; severe-warn
// fills (>=80% single-author share) on every row. Exercises the warn
// tint on the concentration list and the high-share severity branch in
// the authorship detail panel.
function memoryConcentrated(): DemoData {
  const base = createBaselineAnalytics();
  return {
    analytics: {
      ...base,
      memory_single_author_directories: [
        {
          directory: 'packages/worker/dos/team',
          single_author_count: 11,
          total_count: 12,
        },
        {
          directory: 'packages/web/src/widgets/bodies',
          single_author_count: 9,
          total_count: 10,
        },
        {
          directory: 'packages/mcp/lib/tools',
          single_author_count: 7,
          total_count: 8,
        },
        {
          directory: 'packages/cli/lib/commands',
          single_author_count: 6,
          total_count: 7,
        },
        {
          directory: 'packages/shared/contracts',
          single_author_count: 5,
          total_count: 6,
        },
        {
          directory: '.internal',
          single_author_count: 4,
          total_count: 4,
        },
      ],
    },
    conversation: createBaselineConversation(),
    live: createBaselineLive(),
    reports: createBaselineReports(),
    ...baselineFrame(),
  };
}

// ── Registry ────────────────────────────────────────────────────────

export const DEMO_SCENARIOS: Record<DemoScenarioId, DemoScenario> = {
  healthy: {
    id: 'healthy',
    label: 'Healthy',
    description: 'Full team, full coverage, positive delta',
    build: healthy,
  },
  empty: {
    id: 'empty',
    label: 'Empty period',
    description: 'Zero sessions - every empty state at once',
    build: empty,
  },
  'solo-cc': {
    id: 'solo-cc',
    label: 'Solo · Claude Code',
    description: 'One user, full capture, no team coordination',
    build: soloCC,
  },
  'solo-no-hooks': {
    id: 'solo-no-hooks',
    label: 'Solo · no hooks',
    description: 'MCP-only tool, no deep capture - coverage notes everywhere',
    build: soloNoHooks,
  },
  'stale-pricing': {
    id: 'stale-pricing',
    label: 'Stale pricing',
    description: 'Pricing snapshot >7 days old, cost paused',
    build: stalePricing,
  },
  'models-without-pricing': {
    id: 'models-without-pricing',
    label: 'Unpriced models',
    description: 'Some models missing from LiteLLM',
    build: modelsWithoutPricing,
  },
  'first-period': {
    id: 'first-period',
    label: 'First period',
    description: 'No previous window - delta pills suppress',
    build: firstPeriod,
  },
  'team-conflicts': {
    id: 'team-conflicts',
    label: 'Team conflicts',
    description: 'Active collisions, retries, overlap - coordination story',
    build: teamConflicts,
  },
  'negative-delta': {
    id: 'negative-delta',
    label: 'Negative delta',
    description: 'Period got worse - red arrows, invert semantics',
    build: negativeDelta,
  },
  'no-live-agents': {
    id: 'no-live-agents',
    label: 'No live presence',
    description: 'Analytics intact, zero active agents',
    build: noLiveAgents,
  },
  'memory-stale': {
    id: 'memory-stale',
    label: 'Memory · stale',
    description: 'Aging skews to >90d, stale count high - freshness warn',
    build: memoryStale,
  },
  'memory-concentrated': {
    id: 'memory-concentrated',
    label: 'Memory · concentrated',
    description: 'Single-author directories with severe shares - concentration warn',
    build: memoryConcentrated,
  },
};

export const DEMO_SCENARIO_IDS = Object.keys(DEMO_SCENARIOS) as DemoScenarioId[];

export const DEFAULT_SCENARIO: DemoScenarioId = 'healthy';

export function isDemoScenarioId(value: string | null | undefined): value is DemoScenarioId {
  return typeof value === 'string' && value in DEMO_SCENARIOS;
}

export function getDemoData(id?: string | null): DemoData {
  if (isDemoScenarioId(id)) return DEMO_SCENARIOS[id].build();
  return DEMO_SCENARIOS[DEFAULT_SCENARIO].build();
}
