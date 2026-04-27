// Cross-team dashboard + per-team context demo data. Polling store and
// ToolsView consume DashboardSummary; ProjectView consumes TeamContext per
// team. We derive both from the existing live.ts payload so live presence,
// projects widget, and project view stay in sync without restating fixtures.

import type { DashboardSummary, TeamContext, Member, Lock } from '../apiSchemas.js';
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

// Per-team TeamContext for ProjectView. Populated with live members + locks
// scoped to each team; memories, messages, conflicts left thin (Project view
// isn't the focus of demo coverage today). Fleshing these out is a follow-up
// when ProjectView gets the same widget polish Overview is getting.
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

    result[team.team_id] = {
      members,
      memories: [],
      memory_categories: [],
      locks: teamLocks,
      messages: [],
      recentSessions: [],
      sessions: [],
      conflicts: [],
      tools_configured: [],
      hosts_configured: [],
      surfaces_seen: [],
      models_seen: [],
      usage: {},
      daemon: { connected: false, available_tools: [] },
    };
  }

  return result;
}

export function createEmptyTeamContexts(): Record<string, TeamContext> {
  return {};
}
