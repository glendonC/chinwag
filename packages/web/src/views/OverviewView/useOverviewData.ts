import { useMemo } from 'react';
import type { LiveAgent } from '../../widgets/types.js';

interface TeamSummary {
  team_id?: string;
  team_name?: string;
  active_agents?: number;
  memory_count?: number;
  recent_sessions_24h?: number;
  conflict_count?: number;
  active_members?: Array<{
    agent_id: string;
    handle: string;
    host_tool: string;
    agent_surface: string | null;
    files: string[];
    summary: string | null;
    session_minutes: number | null;
    seconds_since_update: number | null;
  }>;
  hosts_configured?: Array<{ host_tool?: string; joins: number }>;
  [key: string]: unknown;
}

interface UseOverviewDataReturn {
  totalActive: number;
  totalSessions: number;
  totalMemories: number;
  totalConflicts: number;
  liveAgents: LiveAgent[];
  sortedSummaries: TeamSummary[];
}

export function useOverviewData(summaries: TeamSummary[]): UseOverviewDataReturn {
  const totalActive = useMemo(
    () => summaries.reduce((s, t) => s + (t.active_agents || 0), 0),
    [summaries],
  );
  const totalSessions = useMemo(
    () => summaries.reduce((s, t) => s + (t.recent_sessions_24h || 0), 0),
    [summaries],
  );
  const totalMemories = useMemo(
    () => summaries.reduce((s, t) => s + (t.memory_count || 0), 0),
    [summaries],
  );
  const totalConflicts = useMemo(
    () => summaries.reduce((s, t) => s + (t.conflict_count || 0), 0),
    [summaries],
  );

  const liveAgents = useMemo((): LiveAgent[] => {
    const agents: LiveAgent[] = [];
    for (const team of summaries) {
      const teamName = team.team_name || team.team_id || '';
      const teamId = team.team_id || '';
      for (const member of team.active_members || []) {
        agents.push({ ...member, teamName, teamId });
      }
    }
    return agents;
  }, [summaries]);

  const sortedSummaries = useMemo((): TeamSummary[] => {
    return [...summaries].sort((a, b) => {
      const aAgents = a.active_agents || 0;
      const bAgents = b.active_agents || 0;
      const aSessions = a.recent_sessions_24h || 0;
      const bSessions = b.recent_sessions_24h || 0;
      const aIdle = aAgents === 0 && aSessions === 0;
      const bIdle = bAgents === 0 && bSessions === 0;
      if (aIdle !== bIdle) return aIdle ? 1 : -1;
      if (aAgents !== bAgents) return bAgents - aAgents;
      return bSessions - aSessions;
    });
  }, [summaries]);

  return {
    totalActive,
    totalSessions,
    totalMemories,
    totalConflicts,
    liveAgents,
    sortedSummaries,
  };
}
