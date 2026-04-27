// Cross-team dashboard + per-team context demo data. Polling store and
// ToolsView consume DashboardSummary; ProjectView consumes TeamContext per
// team. We derive both from the existing live.ts payload so live presence,
// projects widget, and project view stay in sync without restating fixtures.

import type {
  DashboardSummary,
  TeamContext,
  Member,
  Lock,
  Memory,
  Session,
  Conflict,
  HostMetric,
  SurfaceMetric,
  ModelMetric,
} from '../apiSchemas.js';
import { DEMO_TEAMS } from './baseline.js';
import { createBaselineLive } from './live.js';

export function createBaselineDashboard(): DashboardSummary {
  // TeamSummaryLive structurally satisfies TeamSummary plus an optional
  // active_members extension, so DashboardSummary.teams accepts it directly.
  const live = createBaselineLive();
  return {
    teams: live.summaries,
    degraded: false,
    failed_teams: [],
    truncated: false,
  };
}

export function createEmptyDashboard(): DashboardSummary {
  return { teams: [], degraded: false, failed_teams: [], truncated: false };
}

// ── Per-team fixture inputs ─────────────────────────
//
// Each team gets a curated story: a few realistic sessions, a few memories
// keyed off the work the live agents are doing, and rolled-up tool / host /
// surface / model / usage telemetry. Keeping the fixtures here (rather than
// scattered across files) means the ProjectView widgets all read from one
// internally-consistent payload per team.

interface TeamFixture {
  conflicts: Conflict[];
  recentSessions: Session[];
  memories: Memory[];
  toolsConfigured: HostMetric[];
  hostsConfigured: HostMetric[];
  surfacesSeen: SurfaceMetric[];
  modelsSeen: ModelMetric[];
  usage: Record<string, number>;
}

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// Build a Session that satisfies sessionSchema's required-after-default
// fields without restating the optional surface every call.
function makeSession(
  overrides: Partial<Session> & Pick<Session, 'agent_id' | 'started_at'>,
): Session {
  return {
    agent_id: overrides.agent_id,
    owner_handle: overrides.owner_handle ?? overrides.handle ?? 'agent',
    handle: overrides.handle ?? overrides.owner_handle ?? 'agent',
    host_tool: overrides.host_tool ?? 'claude-code',
    agent_surface: overrides.agent_surface ?? null,
    agent_model: overrides.agent_model ?? null,
    transport: overrides.transport ?? null,
    framework: overrides.framework ?? null,
    tool: overrides.tool ?? null,
    started_at: overrides.started_at,
    ended_at: overrides.ended_at ?? null,
    edit_count: overrides.edit_count ?? 0,
    files_touched: overrides.files_touched ?? [],
    conflicts_hit: overrides.conflicts_hit ?? 0,
    memories_saved: overrides.memories_saved ?? 0,
    outcome: overrides.outcome ?? null,
    outcome_summary: overrides.outcome_summary ?? null,
    outcome_tags: overrides.outcome_tags ?? [],
    lines_added: overrides.lines_added ?? 0,
    lines_removed: overrides.lines_removed ?? 0,
    duration_minutes: overrides.duration_minutes ?? null,
    got_stuck: overrides.got_stuck ?? false,
    memories_searched: overrides.memories_searched ?? 0,
    first_edit_at: overrides.first_edit_at ?? null,
    input_tokens: overrides.input_tokens ?? null,
    output_tokens: overrides.output_tokens ?? null,
  };
}

const FRONTEND_FIXTURE: TeamFixture = {
  conflicts: [
    {
      file: 'packages/web/src/widgets/bodies/shared.tsx',
      agents: ['glendon (claude-code)', 'sora (cursor)'],
    },
  ],
  recentSessions: [
    makeSession({
      agent_id: 'sess-fe-1',
      handle: 'glendon',
      host_tool: 'claude-code',
      agent_surface: 'terminal',
      agent_model: 'claude-opus-4-7',
      started_at: minutesAgoIso(42),
      ended_at: null,
      edit_count: 14,
      files_touched: [
        'packages/web/src/widgets/bodies/UsageWidgets.tsx',
        'packages/web/src/widgets/bodies/shared.tsx',
      ],
      lines_added: 142,
      lines_removed: 78,
      duration_minutes: null,
      memories_saved: 1,
      outcome: 'in_progress',
      outcome_summary: 'Redesigning edits widget — tab-selector pattern',
      input_tokens: 84_000,
      output_tokens: 11_200,
    }),
    makeSession({
      agent_id: 'sess-fe-2',
      handle: 'sora',
      host_tool: 'cursor',
      agent_surface: 'sidebar',
      agent_model: 'claude-sonnet-4-6',
      started_at: minutesAgoIso(18),
      ended_at: null,
      edit_count: 6,
      files_touched: ['packages/web/src/widgets/bodies/shared.tsx'],
      lines_added: 48,
      lines_removed: 12,
      conflicts_hit: 1,
      input_tokens: 32_000,
      output_tokens: 4_400,
    }),
    makeSession({
      agent_id: 'sess-fe-3',
      handle: 'glendon',
      host_tool: 'claude-code',
      agent_surface: 'terminal',
      agent_model: 'claude-opus-4-7',
      started_at: hoursAgoIso(6),
      ended_at: hoursAgoIso(5),
      edit_count: 22,
      files_touched: [
        'packages/web/src/views/OverviewView/OverviewView.tsx',
        'packages/web/src/lib/schemas/analytics.ts',
      ],
      lines_added: 184,
      lines_removed: 96,
      duration_minutes: 58,
      memories_saved: 2,
      memories_searched: 4,
      outcome: 'completed',
      outcome_summary: 'Wire useOverviewData into the projects widget',
      outcome_tags: ['refactor'],
      input_tokens: 124_000,
      output_tokens: 18_400,
    }),
  ],
  memories: [
    {
      id: 'mem-fe-1',
      text: 'Widget bodies receive `summaries` typed as TeamSummaryLive[]. Cast through unknown is no longer needed.',
      tags: ['types', 'refactor'],
      categories: ['architecture'],
      handle: 'glendon',
      host_tool: 'claude-code',
      agent_surface: 'terminal',
      agent_model: 'claude-opus-4-7',
      session_id: 'sess-fe-3',
      created_at: hoursAgoIso(5),
      updated_at: hoursAgoIso(5),
      last_accessed_at: minutesAgoIso(20),
    },
    {
      id: 'mem-fe-2',
      text: 'StatWidget tab variant: keep underline indicator, drop the chip background — it competed with the active state.',
      tags: ['ui', 'design'],
      categories: ['design-decisions'],
      handle: 'sora',
      host_tool: 'cursor',
      agent_surface: 'sidebar',
      agent_model: 'claude-sonnet-4-6',
      session_id: 'sess-fe-2',
      created_at: hoursAgoIso(2),
      updated_at: hoursAgoIso(2),
      last_accessed_at: minutesAgoIso(14),
    },
    {
      id: 'mem-fe-3',
      text: "Demo scenario picker: writes silently no-op when isDemoActive is true, so optimistic UI doesn't need a guard.",
      tags: ['demo', 'pattern'],
      categories: ['conventions'],
      handle: 'glendon',
      host_tool: 'claude-code',
      agent_surface: 'terminal',
      agent_model: 'claude-opus-4-7',
      session_id: 'sess-fe-1',
      created_at: daysAgoIso(2),
      updated_at: daysAgoIso(2),
      last_accessed_at: hoursAgoIso(3),
    },
  ],
  toolsConfigured: [
    { host_tool: 'claude-code', joins: 12 },
    { host_tool: 'cursor', joins: 7 },
  ],
  hostsConfigured: [
    { host_tool: 'claude-code', joins: 12 },
    { host_tool: 'cursor', joins: 7 },
  ],
  surfacesSeen: [
    { agent_surface: 'terminal', joins: 12 },
    { agent_surface: 'sidebar', joins: 7 },
  ],
  modelsSeen: [
    { agent_model: 'claude-opus-4-7', count: 9 },
    { agent_model: 'claude-sonnet-4-6', count: 7 },
  ],
  usage: {
    'session:total': 24,
    'session:24h': 6,
    'tool:claude-code': 12,
    'tool:cursor': 7,
    'memory:saves': 18,
    'memory:searches': 47,
  },
};

const PLATFORM_FIXTURE: TeamFixture = {
  conflicts: [
    {
      file: 'packages/worker/src/dos/team/context.ts',
      agents: ['sora (claude-code)', 'ghost (claude-code)'],
    },
  ],
  recentSessions: [
    makeSession({
      agent_id: 'sess-pl-1',
      handle: 'jae',
      host_tool: 'aider',
      agent_surface: 'terminal',
      agent_model: 'claude-opus-4-7',
      started_at: minutesAgoIso(24),
      ended_at: null,
      edit_count: 9,
      files_touched: ['packages/worker/src/dos/team/analytics/outcomes.ts'],
      lines_added: 64,
      lines_removed: 28,
      memories_saved: 1,
      outcome: 'in_progress',
      outcome_summary: 'Patch prev_completion_rate null handling',
      input_tokens: 48_000,
      output_tokens: 6_800,
    }),
    makeSession({
      agent_id: 'sess-pl-2',
      handle: 'pax',
      host_tool: 'cline',
      agent_surface: 'sidebar',
      agent_model: 'claude-sonnet-4-6',
      started_at: hoursAgoIso(1),
      ended_at: null,
      edit_count: 22,
      files_touched: [
        'packages/mcp/lib/tools/conflicts.ts',
        'packages/worker/src/dos/team/context.ts',
      ],
      lines_added: 184,
      lines_removed: 96,
      conflicts_hit: 2,
      memories_searched: 8,
      got_stuck: true,
      outcome: 'in_progress',
      outcome_summary: 'Hunt concurrent-write race in claim release',
      input_tokens: 92_000,
      output_tokens: 14_200,
    }),
    makeSession({
      agent_id: 'sess-pl-3',
      handle: 'sora',
      host_tool: 'claude-code',
      agent_surface: 'terminal',
      agent_model: 'claude-opus-4-7',
      started_at: hoursAgoIso(3),
      ended_at: hoursAgoIso(2),
      edit_count: 11,
      files_touched: ['packages/worker/src/dos/team/context.ts'],
      lines_added: 72,
      lines_removed: 24,
      duration_minutes: 33,
      conflicts_hit: 1,
      outcome: 'abandoned',
      outcome_summary: 'Tracing a stale lock on context.ts',
      outcome_tags: ['debugging'],
      input_tokens: 64_000,
      output_tokens: 8_900,
    }),
  ],
  memories: [
    {
      id: 'mem-pl-1',
      text: 'Lock release race: claim TTL refresh fires after the write commits, leaving a 200ms window where two agents see the same lock owner.',
      tags: ['bug', 'concurrency'],
      categories: ['gotchas'],
      handle: 'pax',
      host_tool: 'cline',
      agent_surface: 'sidebar',
      agent_model: 'claude-sonnet-4-6',
      session_id: 'sess-pl-2',
      created_at: minutesAgoIso(12),
      updated_at: minutesAgoIso(12),
      last_accessed_at: minutesAgoIso(2),
    },
    {
      id: 'mem-pl-2',
      text: 'analytics/outcomes.ts: prev_completion_rate must stay null when previous window has zero sessions, not coerce to 0.',
      tags: ['analytics', 'bug-fix'],
      categories: ['gotchas'],
      handle: 'jae',
      host_tool: 'aider',
      agent_surface: 'terminal',
      agent_model: 'claude-opus-4-7',
      session_id: 'sess-pl-1',
      created_at: minutesAgoIso(35),
      updated_at: minutesAgoIso(35),
      last_accessed_at: minutesAgoIso(35),
    },
  ],
  toolsConfigured: [
    { host_tool: 'claude-code', joins: 9 },
    { host_tool: 'aider', joins: 4 },
    { host_tool: 'cline', joins: 3 },
  ],
  hostsConfigured: [
    { host_tool: 'claude-code', joins: 9 },
    { host_tool: 'aider', joins: 4 },
    { host_tool: 'cline', joins: 3 },
  ],
  surfacesSeen: [
    { agent_surface: 'terminal', joins: 13 },
    { agent_surface: 'sidebar', joins: 3 },
  ],
  modelsSeen: [
    { agent_model: 'claude-opus-4-7', count: 8 },
    { agent_model: 'claude-sonnet-4-6', count: 5 },
  ],
  usage: {
    'session:total': 17,
    'session:24h': 4,
    'tool:claude-code': 9,
    'tool:aider': 4,
    'tool:cline': 3,
    'memory:saves': 9,
    'memory:searches': 38,
  },
};

const RESEARCH_FIXTURE: TeamFixture = {
  conflicts: [],
  recentSessions: [
    makeSession({
      agent_id: 'sess-rs-1',
      handle: 'mika',
      host_tool: 'codex',
      agent_surface: 'terminal',
      agent_model: 'gpt-5',
      started_at: minutesAgoIso(11),
      ended_at: null,
      edit_count: 4,
      files_touched: ['packages/cli/lib/extraction/engine.ts'],
      lines_added: 32,
      lines_removed: 8,
      outcome: 'in_progress',
      outcome_summary: 'Spec health rolling window tests',
      input_tokens: 22_000,
      output_tokens: 3_100,
    }),
    makeSession({
      agent_id: 'sess-rs-2',
      handle: 'mika',
      host_tool: 'windsurf',
      agent_surface: 'inline',
      agent_model: 'claude-sonnet-4-6',
      started_at: minutesAgoIso(6),
      ended_at: null,
      edit_count: 2,
      files_touched: ['packages/cli/lib/extraction/engine.ts'],
      lines_added: 14,
      lines_removed: 4,
      outcome: 'in_progress',
      outcome_summary: 'Cross-checking the same fix from Windsurf',
      input_tokens: 11_000,
      output_tokens: 1_400,
    }),
  ],
  memories: [
    {
      id: 'mem-rs-1',
      text: 'Spec rolling window: keep raw observation count alongside the smoothed value so health regressions are debuggable.',
      tags: ['spec', 'observability'],
      categories: ['conventions'],
      handle: 'mika',
      host_tool: 'codex',
      agent_surface: 'terminal',
      agent_model: 'gpt-5',
      session_id: 'sess-rs-1',
      created_at: hoursAgoIso(4),
      updated_at: hoursAgoIso(4),
      last_accessed_at: minutesAgoIso(8),
    },
  ],
  toolsConfigured: [
    { host_tool: 'codex', joins: 5 },
    { host_tool: 'windsurf', joins: 2 },
  ],
  hostsConfigured: [
    { host_tool: 'codex', joins: 5 },
    { host_tool: 'windsurf', joins: 2 },
  ],
  surfacesSeen: [
    { agent_surface: 'terminal', joins: 5 },
    { agent_surface: 'inline', joins: 2 },
  ],
  modelsSeen: [
    { agent_model: 'gpt-5', count: 4 },
    { agent_model: 'claude-sonnet-4-6', count: 2 },
  ],
  usage: {
    'session:total': 8,
    'session:24h': 3,
    'tool:codex': 5,
    'tool:windsurf': 2,
    'memory:saves': 4,
    'memory:searches': 12,
  },
};

const TEAM_FIXTURES: Record<string, TeamFixture> = {
  'team-frontend': FRONTEND_FIXTURE,
  'team-platform': PLATFORM_FIXTURE,
  'team-research': RESEARCH_FIXTURE,
};

// Per-team TeamContext for ProjectView. members and locks are derived from
// the live presence payload so they stay coherent with the live widgets;
// everything else (sessions, memories, conflicts, telemetry rollups) comes
// from a per-team TeamFixture so the project page renders a believable
// snapshot. Messages and memory_categories stay empty because ProjectView
// does not consume them.
export function createBaselineTeamContexts(): Record<string, TeamContext> {
  const live = createBaselineLive();
  const result: Record<string, TeamContext> = {};

  for (const team of DEMO_TEAMS) {
    const members: Member[] = live.liveAgents
      .filter((a) => a.teamId === team.team_id)
      .map((a) => ({
        agent_id: a.agent_id,
        handle: a.handle,
        status: 'active',
        host_tool: a.host_tool,
        agent_surface: a.agent_surface ?? undefined,
        transport: 'stdio',
        agent_model: null,
        activity: {
          files: a.files,
          summary: a.summary ?? undefined,
          updated_at: new Date(Date.now() - (a.seconds_since_update ?? 0) * 1000).toISOString(),
        },
        color: null,
        session_minutes: a.session_minutes,
        seconds_since_update: a.seconds_since_update,
      }));

    const teamLocks: Lock[] = live.locks.filter((l) =>
      members.some((m) => m.agent_id === l.agent_id),
    );

    const fixture = TEAM_FIXTURES[team.team_id] ?? {
      conflicts: [],
      recentSessions: [],
      memories: [],
      toolsConfigured: [],
      hostsConfigured: [],
      surfacesSeen: [],
      modelsSeen: [],
      usage: {},
    };

    result[team.team_id] = {
      members,
      memories: fixture.memories,
      memory_categories: [],
      locks: teamLocks,
      messages: [],
      recentSessions: fixture.recentSessions,
      sessions: fixture.recentSessions,
      conflicts: fixture.conflicts,
      tools_configured: fixture.toolsConfigured,
      hosts_configured: fixture.hostsConfigured,
      surfaces_seen: fixture.surfacesSeen,
      models_seen: fixture.modelsSeen,
      usage: fixture.usage,
      daemon: { connected: false, available_tools: [] },
    };
  }

  return result;
}

export function createEmptyTeamContexts(): Record<string, TeamContext> {
  return {};
}
