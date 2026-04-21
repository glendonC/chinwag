// Demo analytics data for visual testing without a backend.
// Paired with demoData.ts — activated via ?demo=1 query param.
// Shape mirrors UserAnalytics exactly so schema validation is never hit.

import type { UserAnalytics } from './apiSchemas.js';

const DAYS = 30;

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Deterministic pseudo-random so re-renders are stable and sparklines have
// natural-looking variance. Seeded by day index, not Math.random().
function wobble(seed: number, base: number, spread: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  const frac = x - Math.floor(x);
  return Math.max(0, Math.round(base + (frac - 0.5) * 2 * spread));
}

function buildDailyTrends() {
  const out = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = daysAgo(i);
    const dow = new Date(day).getUTCDay();
    const weekdayBoost = dow >= 1 && dow <= 5 ? 1.0 : 0.35;
    const sessions = Math.round(wobble(i, 6, 3) * weekdayBoost);
    const completed = Math.round(sessions * 0.7);
    const abandoned = Math.round(sessions * 0.15);
    const failed = Math.max(0, Math.round(sessions * 0.05));
    out.push({
      day,
      sessions,
      edits: wobble(i + 100, 140, 60) * (weekdayBoost > 0.5 ? 1 : 0.3),
      lines_added: wobble(i + 200, 380, 150) * (weekdayBoost > 0.5 ? 1 : 0.3),
      lines_removed: wobble(i + 300, 95, 40) * (weekdayBoost > 0.5 ? 1 : 0.3),
      avg_duration_min: 18 + ((i * 7) % 15),
      completed,
      abandoned,
      failed,
    });
  }
  return out;
}

export function createDemoAnalytics(): UserAnalytics {
  const daily_trends = buildDailyTrends();
  const totalSessions = daily_trends.reduce((s, d) => s + d.sessions, 0);
  const completed = daily_trends.reduce((s, d) => s + d.completed, 0);
  const abandoned = daily_trends.reduce((s, d) => s + d.abandoned, 0);
  const failed = daily_trends.reduce((s, d) => s + d.failed, 0);
  const unknown = totalSessions - completed - abandoned - failed;
  const totalEdits = daily_trends.reduce((s, d) => s + d.edits, 0);

  // Previous period: ~18% lower, so delta is a clear positive signal
  const prevSessions = Math.round(totalSessions * 0.82);

  return {
    ok: true,
    period_days: DAYS,
    teams_included: 1,
    degraded: false,
    file_heatmap: [
      { file: 'packages/web/src/widgets/bodies/LiveWidgets.tsx', touch_count: 42 },
      { file: 'packages/worker/src/dos/team/context.ts', touch_count: 31 },
      { file: 'packages/shared/tool-registry.ts', touch_count: 26 },
      { file: 'packages/worker/src/dos/team/memory.ts', touch_count: 23 },
      { file: 'packages/web/src/views/OverviewView/OverviewView.tsx', touch_count: 19 },
      { file: 'packages/cli/lib/extraction/engine.ts', touch_count: 17 },
      { file: 'packages/mcp/lib/tools/conflicts.ts', touch_count: 14 },
      { file: 'packages/worker/src/dos/team/sessions.ts', touch_count: 12 },
      { file: 'packages/web/src/lib/schemas/analytics.ts', touch_count: 9 },
      { file: 'docs/VISION.md', touch_count: 6 },
    ],
    daily_trends,
    tool_distribution: [
      { host_tool: 'claude-code', sessions: 98, edits: Math.round(totalEdits * 0.58) },
      { host_tool: 'cursor', sessions: 42, edits: Math.round(totalEdits * 0.2) },
      { host_tool: 'codex', sessions: 18, edits: Math.round(totalEdits * 0.09) },
      { host_tool: 'aider', sessions: 12, edits: Math.round(totalEdits * 0.06) },
      { host_tool: 'cline', sessions: 6, edits: Math.round(totalEdits * 0.04) },
      { host_tool: 'windsurf', sessions: 4, edits: Math.round(totalEdits * 0.03) },
    ],
    outcome_distribution: [
      { outcome: 'completed', count: completed },
      { outcome: 'abandoned', count: abandoned },
      { outcome: 'failed', count: failed },
      { outcome: 'unknown', count: unknown },
    ],
    daily_metrics: daily_trends.map((d) => ({
      date: d.day,
      metric: 'sessions',
      count: d.sessions,
    })),
    hourly_distribution: Array.from({ length: 7 * 24 }, (_, i) => {
      const h = i % 24;
      const dow = Math.floor(i / 24);
      const weekdayBoost = dow >= 1 && dow <= 5 ? 1.0 : 0.35;
      const peak = h >= 10 && h <= 14 ? 1.0 : h >= 8 && h <= 18 ? 0.55 : 0.12;
      const factor = peak * weekdayBoost;
      return { hour: h, dow, sessions: Math.round(14 * factor), edits: Math.round(320 * factor) };
    }),
    tool_daily: [],
    model_outcomes: [
      {
        agent_model: 'claude-sonnet-4-5-20250514',
        outcome: 'completed',
        count: 82,
        avg_duration_min: 24,
        total_edits: 1840,
        total_lines_added: 4200,
        total_lines_removed: 980,
      },
      {
        agent_model: 'claude-opus-4-7',
        outcome: 'completed',
        count: 31,
        avg_duration_min: 38,
        total_edits: 920,
        total_lines_added: 2150,
        total_lines_removed: 510,
      },
      {
        agent_model: 'gpt-5',
        outcome: 'completed',
        count: 8,
        avg_duration_min: 21,
        total_edits: 220,
        total_lines_added: 480,
        total_lines_removed: 120,
      },
    ],
    tool_outcomes: [
      { host_tool: 'claude-code', outcome: 'completed', count: 72 },
      { host_tool: 'claude-code', outcome: 'abandoned', count: 14 },
      { host_tool: 'cursor', outcome: 'completed', count: 30 },
      { host_tool: 'cursor', outcome: 'abandoned', count: 8 },
      { host_tool: 'codex', outcome: 'completed', count: 13 },
      { host_tool: 'aider', outcome: 'completed', count: 9 },
    ],
    completion_summary: {
      total_sessions: totalSessions,
      completed,
      abandoned,
      failed,
      unknown,
      completion_rate: completed / Math.max(1, totalSessions),
      prev_completion_rate: 0.64,
    },
    tool_comparison: [
      {
        host_tool: 'claude-code',
        sessions: 98,
        completed: 72,
        abandoned: 14,
        failed: 4,
        completion_rate: 0.73,
        avg_duration_min: 28,
        total_edits: 2640,
        total_lines_added: 6120,
        total_lines_removed: 1480,
      },
      {
        host_tool: 'cursor',
        sessions: 42,
        completed: 30,
        abandoned: 8,
        failed: 2,
        completion_rate: 0.71,
        avg_duration_min: 19,
        total_edits: 880,
        total_lines_added: 2100,
        total_lines_removed: 520,
      },
      {
        host_tool: 'codex',
        sessions: 18,
        completed: 13,
        abandoned: 3,
        failed: 1,
        completion_rate: 0.72,
        avg_duration_min: 22,
        total_edits: 410,
        total_lines_added: 940,
        total_lines_removed: 220,
      },
      {
        host_tool: 'aider',
        sessions: 12,
        completed: 9,
        abandoned: 2,
        failed: 0,
        completion_rate: 0.75,
        avg_duration_min: 17,
        total_edits: 240,
        total_lines_added: 580,
        total_lines_removed: 140,
      },
      {
        host_tool: 'cline',
        sessions: 6,
        completed: 4,
        abandoned: 1,
        failed: 1,
        completion_rate: 0.67,
        avg_duration_min: 31,
        total_edits: 120,
        total_lines_added: 280,
        total_lines_removed: 70,
      },
      {
        host_tool: 'windsurf',
        sessions: 4,
        completed: 3,
        abandoned: 1,
        failed: 0,
        completion_rate: 0.75,
        avg_duration_min: 14,
        total_edits: 60,
        total_lines_added: 140,
        total_lines_removed: 35,
      },
    ],
    work_type_distribution: [
      {
        work_type: 'feature',
        sessions: 82,
        edits: 2180,
        lines_added: 4600,
        lines_removed: 890,
        files: 64,
      },
      {
        work_type: 'fix',
        sessions: 54,
        edits: 980,
        lines_added: 1420,
        lines_removed: 920,
        files: 48,
      },
      {
        work_type: 'refactor',
        sessions: 28,
        edits: 720,
        lines_added: 1880,
        lines_removed: 1640,
        files: 32,
      },
      {
        work_type: 'docs',
        sessions: 11,
        edits: 180,
        lines_added: 420,
        lines_removed: 60,
        files: 14,
      },
      { work_type: 'test', sessions: 5, edits: 140, lines_added: 380, lines_removed: 40, files: 8 },
    ],
    tool_work_type: [],
    file_churn: [],
    duration_distribution: [
      { bucket: '<5min', count: 24 },
      { bucket: '5-15min', count: 48 },
      { bucket: '15-30min', count: 52 },
      { bucket: '30-60min', count: 38 },
      { bucket: '>60min', count: totalSessions - 162 },
    ],
    concurrent_edits: [],
    member_analytics: [],
    retry_patterns: [],
    conflict_correlation: [],
    conflict_stats: { blocked_period: 4, found_period: 11 },
    edit_velocity: daily_trends.slice(-14).map((d) => ({
      day: d.day,
      edits_per_hour: d.edits / Math.max(1, d.sessions * (d.avg_duration_min / 60)),
      lines_per_hour: d.lines_added / Math.max(1, d.sessions * (d.avg_duration_min / 60)),
      total_session_hours: (d.sessions * d.avg_duration_min) / 60,
    })),
    memory_usage: {
      total_memories: 12,
      searches: 67,
      searches_with_results: 48,
      search_hit_rate: 48 / 67,
      memories_created_period: 3,
      memories_updated_period: 2,
      stale_memories: 1,
      avg_memory_age_days: 42,
      merged_memories: 0,
      pending_consolidation_proposals: 0,
      formation_observations_by_recommendation: { keep: 8, merge: 2, evolve: 1, discard: 1 },
      secrets_blocked_period: 0,
    },
    work_type_outcomes: [],
    conversation_edit_correlation: [],
    file_rework: [
      {
        file: 'packages/worker/src/dos/team/context.ts',
        total_edits: 31,
        failed_edits: 4,
        rework_ratio: 0.13,
      },
      {
        file: 'packages/web/src/widgets/bodies/LiveWidgets.tsx',
        total_edits: 42,
        failed_edits: 3,
        rework_ratio: 0.07,
      },
      {
        file: 'packages/shared/tool-registry.ts',
        total_edits: 26,
        failed_edits: 2,
        rework_ratio: 0.08,
      },
    ],
    directory_heatmap: [
      {
        directory: 'packages/web',
        touch_count: 118,
        file_count: 42,
        total_lines: 4800,
        completion_rate: 0.74,
      },
      {
        directory: 'packages/worker',
        touch_count: 94,
        file_count: 36,
        total_lines: 3600,
        completion_rate: 0.71,
      },
      {
        directory: 'packages/mcp',
        touch_count: 52,
        file_count: 18,
        total_lines: 1900,
        completion_rate: 0.78,
      },
      {
        directory: 'packages/cli',
        touch_count: 41,
        file_count: 22,
        total_lines: 1700,
        completion_rate: 0.69,
      },
      {
        directory: 'packages/shared',
        touch_count: 32,
        file_count: 14,
        total_lines: 980,
        completion_rate: 0.75,
      },
      {
        directory: 'docs',
        touch_count: 18,
        file_count: 8,
        total_lines: 420,
        completion_rate: 0.82,
      },
    ],
    stuckness: {
      total_sessions: totalSessions,
      stuck_sessions: 22,
      stuckness_rate: 22 / Math.max(1, totalSessions),
      stuck_completion_rate: 0.32,
      normal_completion_rate: 0.78,
    },
    file_overlap: { total_files: 148, overlapping_files: 9, overlap_rate: 0.06 },
    audit_staleness: [],
    first_edit_stats: {
      avg_minutes_to_first_edit: 3.8,
      median_minutes_to_first_edit: 2.4,
      by_tool: [
        { host_tool: 'claude-code', avg_minutes: 2.9, sessions: 98 },
        { host_tool: 'cursor', avg_minutes: 4.2, sessions: 42 },
        { host_tool: 'codex', avg_minutes: 5.1, sessions: 18 },
      ],
    },
    memory_outcome_correlation: [],
    top_memories: [
      {
        id: 'mem-1',
        text_preview: 'SQLite on Durable Objects has no native vector ops...',
        access_count: 14,
        last_accessed_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      },
      {
        id: 'mem-3',
        text_preview: 'Every read endpoint must verify the caller has access...',
        access_count: 11,
        last_accessed_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
      },
      {
        id: 'mem-2',
        text_preview: 'All AI moderation uses Llama Guard 3 via env.AI binding...',
        access_count: 9,
        last_accessed_at: new Date(Date.now() - 60 * 60_000).toISOString(),
      },
      {
        id: 'mem-4',
        text_preview: 'Access tokens use 90-day sliding window TTL...',
        access_count: 7,
        last_accessed_at: new Date(Date.now() - 12 * 3600_000).toISOString(),
      },
    ],
    scope_complexity: [
      { bucket: '1 file', sessions: 62, avg_edits: 8, avg_duration_min: 12, completion_rate: 0.82 },
      {
        bucket: '2-3 files',
        sessions: 58,
        avg_edits: 18,
        avg_duration_min: 22,
        completion_rate: 0.76,
      },
      {
        bucket: '4-6 files',
        sessions: 38,
        avg_edits: 34,
        avg_duration_min: 38,
        completion_rate: 0.66,
      },
      {
        bucket: '7+ files',
        sessions: 22,
        avg_edits: 62,
        avg_duration_min: 58,
        completion_rate: 0.48,
      },
    ],
    prompt_efficiency: daily_trends.slice(-14).map((d) => ({
      day: d.day,
      avg_turns_per_edit: 1.4 + (Math.sin(d.day.charCodeAt(8)) + 1) * 0.3,
      sessions: d.sessions,
    })),
    hourly_effectiveness: Array.from({ length: 24 }, (_, h) => {
      const peak = h >= 10 && h <= 14 ? 1.0 : h >= 8 && h <= 18 ? 0.55 : 0.12;
      return {
        hour: h,
        sessions: Math.round(14 * peak),
        completion_rate: 0.6 + peak * 0.2,
        avg_edits: Math.round(22 * peak),
      };
    }),
    outcome_tags: [
      { tag: 'shipped', count: 48, outcome: 'completed' },
      { tag: 'partial', count: 22, outcome: 'completed' },
      { tag: 'blocked', count: 11, outcome: 'abandoned' },
      { tag: 'exploratory', count: 9, outcome: 'completed' },
    ],
    tool_handoffs: [],
    period_comparison: {
      current: {
        completion_rate: completed / Math.max(1, totalSessions),
        avg_duration_min: 24,
        stuckness_rate: 22 / Math.max(1, totalSessions),
        memory_hit_rate: 48 / 67,
        edit_velocity: 2.8,
        total_sessions: totalSessions,
      },
      previous: {
        completion_rate: 0.64,
        avg_duration_min: 27,
        stuckness_rate: 0.18,
        memory_hit_rate: 0.58,
        edit_velocity: 2.4,
        total_sessions: prevSessions,
      },
    },
    token_usage: {
      total_input_tokens: 4_230_000,
      total_output_tokens: 320_000,
      total_cache_read_tokens: 18_400_000,
      total_cache_creation_tokens: 940_000,
      avg_input_per_session: Math.round(4_230_000 / 125),
      avg_output_per_session: Math.round(320_000 / 125),
      sessions_with_token_data: 125,
      sessions_without_token_data: Math.max(0, totalSessions - 125),
      total_edits_in_token_sessions: Math.round(totalEdits * 0.78),
      total_estimated_cost_usd: 58.42,
      pricing_refreshed_at: new Date(Date.now() - 6 * 3600_000).toISOString(),
      pricing_is_stale: false,
      models_without_pricing: [],
      models_without_pricing_total: 0,
      cost_per_edit: 58.42 / Math.max(1, Math.round(totalEdits * 0.78)),
      cache_hit_rate: 18_400_000 / (4_230_000 + 18_400_000),
      by_model: [
        {
          agent_model: 'claude-sonnet-4-5-20250514',
          input_tokens: 2_800_000,
          output_tokens: 210_000,
          cache_read_tokens: 12_200_000,
          cache_creation_tokens: 620_000,
          sessions: 82,
          estimated_cost_usd: 32.8,
        },
        {
          agent_model: 'claude-opus-4-7',
          input_tokens: 980_000,
          output_tokens: 78_000,
          cache_read_tokens: 4_800_000,
          cache_creation_tokens: 240_000,
          sessions: 31,
          estimated_cost_usd: 21.4,
        },
        {
          agent_model: 'gpt-5',
          input_tokens: 450_000,
          output_tokens: 32_000,
          cache_read_tokens: 1_400_000,
          cache_creation_tokens: 80_000,
          sessions: 12,
          estimated_cost_usd: 4.22,
        },
      ],
      by_tool: [
        {
          host_tool: 'claude-code',
          input_tokens: 3_100_000,
          output_tokens: 240_000,
          cache_read_tokens: 14_800_000,
          cache_creation_tokens: 720_000,
          sessions: 92,
        },
        {
          host_tool: 'codex',
          input_tokens: 640_000,
          output_tokens: 48_000,
          cache_read_tokens: 2_100_000,
          cache_creation_tokens: 140_000,
          sessions: 15,
        },
        {
          host_tool: 'aider',
          input_tokens: 320_000,
          output_tokens: 22_000,
          cache_read_tokens: 980_000,
          cache_creation_tokens: 60_000,
          sessions: 12,
        },
        {
          host_tool: 'cline',
          input_tokens: 170_000,
          output_tokens: 10_000,
          cache_read_tokens: 520_000,
          cache_creation_tokens: 20_000,
          sessions: 6,
        },
      ],
    },
    tool_call_stats: {
      total_calls: 4820,
      total_errors: 142,
      error_rate: 142 / 4820,
      avg_duration_ms: 380,
      calls_per_session: 4820 / Math.max(1, totalSessions),
      research_to_edit_ratio: 1.8,
      one_shot_rate: 0.67,
      one_shot_sessions: Math.round(totalSessions * 0.67),
      frequency: [
        {
          tool: 'Read',
          calls: 1420,
          errors: 18,
          error_rate: 0.013,
          avg_duration_ms: 120,
          sessions: 142,
        },
        {
          tool: 'Edit',
          calls: 980,
          errors: 24,
          error_rate: 0.024,
          avg_duration_ms: 240,
          sessions: 128,
        },
        {
          tool: 'Bash',
          calls: 720,
          errors: 52,
          error_rate: 0.072,
          avg_duration_ms: 1200,
          sessions: 98,
        },
        {
          tool: 'Grep',
          calls: 620,
          errors: 8,
          error_rate: 0.013,
          avg_duration_ms: 180,
          sessions: 118,
        },
        {
          tool: 'Glob',
          calls: 410,
          errors: 4,
          error_rate: 0.01,
          avg_duration_ms: 90,
          sessions: 96,
        },
        {
          tool: 'Write',
          calls: 380,
          errors: 22,
          error_rate: 0.058,
          avg_duration_ms: 220,
          sessions: 62,
        },
        {
          tool: 'WebFetch',
          calls: 180,
          errors: 11,
          error_rate: 0.061,
          avg_duration_ms: 2800,
          sessions: 38,
        },
        {
          tool: 'Task',
          calls: 110,
          errors: 3,
          error_rate: 0.027,
          avg_duration_ms: 18000,
          sessions: 28,
        },
      ],
      error_patterns: [
        { tool: 'Bash', error_preview: 'File not found: no such file or directory', count: 42 },
        {
          tool: 'Edit',
          error_preview: 'Permission denied: cannot write to locked file',
          count: 28,
        },
        { tool: 'Grep', error_preview: 'Pattern did not match any files', count: 22 },
        { tool: 'Bash', error_preview: 'Command timed out after 120s', count: 18 },
      ],
      hourly_activity: Array.from({ length: 24 }, (_, h) => {
        const peak = h >= 10 && h <= 14 ? 1.0 : h >= 8 && h <= 18 ? 0.55 : 0.12;
        return { hour: h, calls: Math.round(280 * peak), errors: Math.round(8 * peak) };
      }),
    },
    commit_stats: {
      total_commits: 38,
      commits_per_session: 38 / Math.max(1, totalSessions),
      sessions_with_commits: 29,
      avg_time_to_first_commit_min: 18.4,
      by_tool: [
        { host_tool: 'claude-code', commits: 28, avg_files_changed: 3.2, avg_lines: 84 },
        { host_tool: 'cursor', commits: 8, avg_files_changed: 2.1, avg_lines: 52 },
        { host_tool: 'windsurf', commits: 2, avg_files_changed: 1.5, avg_lines: 28 },
      ],
      daily_commits: daily_trends.map((d) => ({
        day: d.day,
        commits: Math.max(0, Math.round(d.sessions * 0.2)),
      })),
      outcome_correlation: [
        { bucket: 'with-commits', sessions: 29, completed: 26, completion_rate: 0.9 },
        {
          bucket: 'without-commits',
          sessions: totalSessions - 29,
          completed: completed - 26,
          completion_rate: (completed - 26) / Math.max(1, totalSessions - 29),
        },
      ],
      commit_edit_ratio: [
        {
          bucket: '1-5 edits',
          sessions: 48,
          completion_rate: 0.82,
          avg_edits: 3,
          avg_commits: 0.3,
        },
        {
          bucket: '6-20 edits',
          sessions: 72,
          completion_rate: 0.76,
          avg_edits: 12,
          avg_commits: 1.2,
        },
        {
          bucket: '21-50 edits',
          sessions: 42,
          completion_rate: 0.64,
          avg_edits: 32,
          avg_commits: 2.1,
        },
        {
          bucket: '50+ edits',
          sessions: 18,
          completion_rate: 0.5,
          avg_edits: 78,
          avg_commits: 3.4,
        },
      ],
    },
    data_coverage: {
      tools_reporting: ['claude-code', 'cursor', 'codex', 'aider', 'cline', 'windsurf'],
      tools_without_data: [],
      coverage_rate: 1,
      capabilities_available: [
        'conversationLogs',
        'tokenUsage',
        'toolCallLogs',
        'hooks',
        'commitTracking',
      ],
      capabilities_missing: [],
    },
  };
}
