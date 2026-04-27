// Live presence / coordination demo data for the Live widgets.
// Simulates an active multi-tool team mid-workflow: overlapping files,
// some claims, one mismatch, a stale heartbeat. Covers the empty state
// via an explicit createEmptyLive() export so scenarios can opt out of
// presence rather than duplicating the fixture.

import type { Lock, TeamSummaryLive } from '../schemas/common.js';
import type { LiveAgent } from '../../widgets/types.js';
import { DEMO_TEAMS } from './baseline.js';

export interface LiveDemoData {
  liveAgents: LiveAgent[];
  locks: Lock[];
  summaries: TeamSummaryLive[];
}

export function createBaselineLive(): LiveDemoData {
  const liveAgents: LiveAgent[] = [
    {
      agent_id: 'agent-cc-1',
      handle: 'glendon',
      host_tool: 'claude-code',
      agent_surface: 'terminal',
      files: [
        'packages/web/src/widgets/bodies/UsageWidgets.tsx',
        'packages/web/src/widgets/bodies/shared.tsx',
      ],
      summary: 'Redesigning edits widget — tab-selector pattern',
      session_minutes: 42,
      seconds_since_update: 8,
      teamName: 'frontend',
      teamId: 'team-frontend',
    },
    {
      agent_id: 'agent-cursor-1',
      handle: 'sora',
      host_tool: 'cursor',
      agent_surface: 'sidebar',
      files: ['packages/web/src/widgets/bodies/shared.tsx'],
      summary: 'Adjusting StatWidget tab variant',
      session_minutes: 18,
      seconds_since_update: 22,
      teamName: 'frontend',
      teamId: 'team-frontend',
    },
    {
      agent_id: 'agent-cc-2',
      handle: 'jae',
      host_tool: 'aider',
      agent_surface: 'terminal',
      files: ['packages/worker/src/dos/team/analytics/outcomes.ts'],
      summary: 'Patch prev_completion_rate null handling',
      session_minutes: 24,
      seconds_since_update: 14,
      teamName: 'platform',
      teamId: 'team-platform',
    },
    {
      agent_id: 'agent-cline-1',
      handle: 'pax',
      host_tool: 'cline',
      agent_surface: 'sidebar',
      files: ['packages/mcp/lib/tools/conflicts.ts', 'packages/worker/src/dos/team/context.ts'],
      summary: 'Hunt concurrent-write race in claim release',
      session_minutes: 61,
      seconds_since_update: 36,
      teamName: 'platform',
      teamId: 'team-platform',
    },
    {
      agent_id: 'agent-codex-1',
      handle: 'mika',
      host_tool: 'codex',
      agent_surface: 'terminal',
      files: ['packages/cli/lib/extraction/engine.ts'],
      summary: 'Spec health rolling window tests',
      session_minutes: 11,
      seconds_since_update: 4,
      teamName: 'research',
      teamId: 'team-research',
    },
    {
      agent_id: 'agent-windsurf-1',
      handle: 'mika',
      host_tool: 'windsurf',
      agent_surface: 'inline',
      files: ['packages/cli/lib/extraction/engine.ts'],
      summary: 'Cross-checking the same fix from Windsurf',
      session_minutes: 6,
      seconds_since_update: 2,
      teamName: 'research',
      teamId: 'team-research',
    },
    {
      agent_id: 'agent-cc-3',
      handle: 'sora',
      host_tool: 'claude-code',
      agent_surface: 'terminal',
      files: ['packages/worker/src/dos/team/context.ts'],
      summary: 'Tracing a stale lock on context.ts',
      session_minutes: 33,
      seconds_since_update: 48,
      teamName: 'platform',
      teamId: 'team-platform',
    },
  ];

  const locks: Lock[] = [
    {
      file_path: 'packages/web/src/widgets/bodies/UsageWidgets.tsx',
      agent_id: 'agent-cc-1',
      handle: 'glendon',
      host_tool: 'claude-code',
      agent_surface: 'terminal',
      minutes_held: 12,
    },
    {
      // Stale claim — held by a handle that isn't in the current Editors
      // cell. Exercises the 'mismatch' status branch in FileRow.
      file_path: 'packages/worker/src/dos/team/context.ts',
      agent_id: 'agent-cc-ghost',
      handle: 'ghost',
      host_tool: 'claude-code',
      agent_surface: 'terminal',
      minutes_held: 38,
    },
    {
      file_path: 'packages/cli/lib/extraction/engine.ts',
      agent_id: 'agent-codex-1',
      handle: 'mika',
      host_tool: 'codex',
      agent_surface: 'terminal',
      minutes_held: 9,
    },
  ];

  // Project summaries — three active teams with believable counts. The
  // ProjectsWidget reads these via WidgetBodyProps.summaries, and
  // useOverviewData flattens active_members into the top-level LiveAgent[]
  // consumed by live widgets. Populating both parallel shapes keeps demo
  // mode compatible with each consumer without routing through the
  // polling store.
  const summaries: TeamSummaryLive[] = DEMO_TEAMS.map((t, i) => {
    const teamAgents = liveAgents.filter((a) => a.teamId === t.team_id);
    return {
      team_id: t.team_id,
      team_name: t.team_name,
      active_agents: teamAgents.length,
      memory_count: [18, 9, 4][i] ?? 0,
      recent_sessions_24h: [24, 17, 8][i] ?? 0,
      conflict_count: [2, 1, 0][i] ?? 0,
      hosts_configured: [
        { host_tool: 'claude-code', joins: 5 },
        { host_tool: 'cursor', joins: 3 },
        { host_tool: 'codex', joins: 2 },
      ],
      surfaces_seen: [],
      models_seen: [],
      usage: {},
      active_members: teamAgents.map((a) => ({
        agent_id: a.agent_id,
        handle: a.handle,
        host_tool: a.host_tool,
        agent_surface: a.agent_surface ?? null,
        files: a.files,
        summary: a.summary ?? null,
        session_minutes: a.session_minutes ?? null,
        seconds_since_update: a.seconds_since_update ?? null,
      })),
    };
  });

  return { liveAgents, locks, summaries };
}

export function createEmptyLive(): LiveDemoData {
  return { liveAgents: [], locks: [], summaries: [] };
}
