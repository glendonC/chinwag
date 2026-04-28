// Global cross-user views: rank percentiles, global stats, session timeline.
// All three are tertiary to the Overview/Reports core, so the baselines are
// believable but thin - empty arrays where the real surface relies on
// thousands of users we don't simulate. Most scenarios use baseline; empty
// scenario uses the empty variants.

import type { GlobalRank } from '../../hooks/useGlobalRank.js';
import type { GlobalStats } from '../../hooks/useGlobalStats.js';
import type { TimelineSession, TimelineTotals } from '../../hooks/useSessionTimeline.js';

// ── Global rank ─────────────────────────────────────────────────────

export function createBaselineGlobalRank(): GlobalRank {
  return {
    metrics: {
      completion_rate: { value: 71, percentile: 78, unit: '%' },
      first_edit_latency: { value: 64, percentile: 65, unit: 's' },
      stuck_rate: { value: 14, percentile: 70, unit: '%' },
      edit_velocity: { value: 2.4, percentile: 72, unit: 'edits / min' },
      lines_per_session: { value: 184, percentile: 68, unit: 'lines' },
      total_lines: { value: 41_900, percentile: 80, unit: 'lines' },
      focus_hours: { value: 142, percentile: 84, unit: 'hours' },
      tool_diversity: { value: 4, percentile: 88, unit: 'tools' },
    },
    totals: {
      totalSessions: 184,
      completedSessions: 131,
      abandonedSessions: 38,
      failedSessions: 15,
      totalEdits: 1_842,
      totalLinesAdded: 26_440,
      totalLinesRemoved: 15_460,
      totalDurationMin: 8_520,
      totalStuck: 26,
      totalMemoriesSaved: 47,
      totalMemoriesSearched: 168,
      totalInputTokens: 4_120_000,
      totalOutputTokens: 980_000,
    },
    totalDevelopers: 12_400,
  };
}

export function createEmptyGlobalRank(): GlobalRank {
  return {
    metrics: {},
    totals: {
      totalSessions: 0,
      completedSessions: 0,
      abandonedSessions: 0,
      failedSessions: 0,
      totalEdits: 0,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
      totalDurationMin: 0,
      totalStuck: 0,
      totalMemoriesSaved: 0,
      totalMemoriesSearched: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    },
    totalDevelopers: 0,
  };
}

// ── Global stats ────────────────────────────────────────────────────

export function createBaselineGlobalStats(): GlobalStats {
  return {
    online: 412,
    totalUsers: 12_400,
    totalSessions: 1_840_000,
    totalEdits: 22_900_000,
    topTools: [
      { tool: 'claude-code', users: 6_200 },
      { tool: 'cursor', users: 4_300 },
      { tool: 'aider', users: 1_180 },
      { tool: 'windsurf', users: 720 },
      { tool: 'cline', users: 540 },
    ],
    topModels: [
      { model: 'claude-opus-4-7', users: 5_900 },
      { model: 'claude-sonnet-4-6', users: 4_200 },
      { model: 'gpt-5', users: 1_840 },
      { model: 'claude-haiku-4-5', users: 880 },
    ],
    countries: { US: 5_240, GB: 1_180, DE: 920, IN: 870, JP: 540 },
    globalAverages: {
      completion_rate: 64,
      edit_velocity: 1.8,
      stuck_rate: 21,
      first_edit_s: 88,
      lines_per_session: 142,
      focus_hours: 96,
      total_edits: 1_240,
      total_sessions: 138,
      total_lines_added: 18_400,
      total_tokens: 3_200_000,
      total_memories: 32,
    },
    toolEffectiveness: [
      {
        tool: 'claude-code',
        users: 6_200,
        completionRate: 71,
        editVelocity: 2.1,
        firstEditS: 72,
      },
      { tool: 'cursor', users: 4_300, completionRate: 68, editVelocity: 1.9, firstEditS: 64 },
      { tool: 'aider', users: 1_180, completionRate: 64, editVelocity: 2.4, firstEditS: 81 },
      { tool: 'windsurf', users: 720, completionRate: 62, editVelocity: 1.7, firstEditS: 78 },
    ],
    modelEffectiveness: [
      { model: 'claude-opus-4-7', users: 5_900, completionRate: 74, editVelocity: 1.9 },
      { model: 'claude-sonnet-4-6', users: 4_200, completionRate: 66, editVelocity: 2.2 },
      { model: 'gpt-5', users: 1_840, completionRate: 63, editVelocity: 1.8 },
      { model: 'claude-haiku-4-5', users: 880, completionRate: 58, editVelocity: 2.6 },
    ],
    toolCombinations: [
      { toolA: 'claude-code', toolB: 'cursor', users: 2_100 },
      { toolA: 'claude-code', toolB: 'aider', users: 640 },
      { toolA: 'cursor', toolB: 'windsurf', users: 320 },
    ],
    completionDistribution: [
      { bracket: '0-20%', users: 380 },
      { bracket: '20-40%', users: 1_100 },
      { bracket: '40-60%', users: 3_240 },
      { bracket: '60-80%', users: 5_180 },
      { bracket: '80-100%', users: 2_500 },
    ],
    toolCountDistribution: [
      { count: 1, users: 4_900 },
      { count: 2, users: 4_200 },
      { count: 3, users: 2_100 },
      { count: 4, users: 880 },
      { count: 5, users: 320 },
    ],
  };
}

export function createEmptyGlobalStats(): GlobalStats {
  return {
    online: 0,
    totalUsers: 0,
    totalSessions: 0,
    totalEdits: 0,
    topTools: [],
    topModels: [],
    countries: {},
    globalAverages: {
      completion_rate: 0,
      edit_velocity: 0,
      stuck_rate: 0,
      first_edit_s: 0,
      lines_per_session: 0,
      focus_hours: 0,
      total_edits: 0,
      total_sessions: 0,
      total_lines_added: 0,
      total_tokens: 0,
      total_memories: 0,
    },
    toolEffectiveness: [],
    modelEffectiveness: [],
    toolCombinations: [],
    completionDistribution: [],
    toolCountDistribution: [],
  };
}

// ── Session timeline ────────────────────────────────────────────────

export interface SessionsDemoData {
  sessions: TimelineSession[];
  totals: TimelineTotals;
}

function daysAgoIso(days: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function createBaselineSessions(): SessionsDemoData {
  const sessions: TimelineSession[] = [
    {
      id: 'sess-001',
      handle: 'glendon',
      host_tool: 'claude-code',
      agent_model: 'claude-opus-4-7',
      started_at: daysAgoIso(0, 9, 12),
      ended_at: daysAgoIso(0, 9, 48),
      edit_count: 14,
      files_touched: [
        'packages/web/src/widgets/bodies/ToolWidgets.tsx',
        'packages/web/src/widgets/bodies/shared.tsx',
      ],
      outcome: 'completed',
      outcome_summary: 'Tool widget redesign - tab-selector pattern',
      lines_added: 142,
      lines_removed: 78,
      duration_minutes: 36,
      team_id: 'team-frontend',
      team_name: 'frontend',
    },
    {
      id: 'sess-002',
      handle: 'sora',
      host_tool: 'cursor',
      agent_model: 'claude-sonnet-4-6',
      started_at: daysAgoIso(0, 11, 4),
      ended_at: daysAgoIso(0, 11, 22),
      edit_count: 6,
      files_touched: ['packages/web/src/widgets/bodies/shared.tsx'],
      outcome: 'completed',
      outcome_summary: 'StatWidget tab variant tweak',
      lines_added: 48,
      lines_removed: 12,
      duration_minutes: 18,
      team_id: 'team-frontend',
      team_name: 'frontend',
    },
    {
      id: 'sess-003',
      handle: 'jae',
      host_tool: 'aider',
      agent_model: 'claude-opus-4-7',
      started_at: daysAgoIso(1, 14, 10),
      ended_at: daysAgoIso(1, 14, 34),
      edit_count: 9,
      files_touched: ['packages/worker/src/dos/team/analytics/outcomes.ts'],
      outcome: 'completed',
      outcome_summary: 'Patch prev_completion_rate null handling',
      lines_added: 64,
      lines_removed: 28,
      duration_minutes: 24,
      team_id: 'team-platform',
      team_name: 'platform',
    },
    {
      id: 'sess-004',
      handle: 'pax',
      host_tool: 'cline',
      agent_model: 'claude-sonnet-4-6',
      started_at: daysAgoIso(1, 16, 0),
      ended_at: daysAgoIso(1, 17, 1),
      edit_count: 22,
      files_touched: [
        'packages/mcp/lib/tools/conflicts.ts',
        'packages/worker/src/dos/team/context.ts',
      ],
      outcome: 'abandoned',
      outcome_summary: 'Race in claim release - agent ran out of context',
      lines_added: 184,
      lines_removed: 96,
      duration_minutes: 61,
      team_id: 'team-platform',
      team_name: 'platform',
    },
    {
      id: 'sess-005',
      handle: 'mika',
      host_tool: 'codex',
      agent_model: 'gpt-5',
      started_at: daysAgoIso(2, 10, 0),
      ended_at: daysAgoIso(2, 10, 11),
      edit_count: 4,
      files_touched: ['packages/cli/lib/extraction/engine.ts'],
      outcome: 'completed',
      outcome_summary: 'Spec health rolling window tests',
      lines_added: 32,
      lines_removed: 8,
      duration_minutes: 11,
      team_id: 'team-research',
      team_name: 'research',
    },
  ];

  const tools = Array.from(new Set(sessions.map((s) => s.host_tool)));
  const totals: TimelineTotals = {
    sessions: sessions.length,
    edits: sessions.reduce((s, x) => s + x.edit_count, 0),
    lines_added: sessions.reduce((s, x) => s + x.lines_added, 0),
    lines_removed: sessions.reduce((s, x) => s + x.lines_removed, 0),
    tools,
  };

  return { sessions, totals };
}

export function createEmptySessions(): SessionsDemoData {
  return {
    sessions: [],
    totals: { sessions: 0, edits: 0, lines_added: 0, lines_removed: 0, tools: [] },
  };
}
