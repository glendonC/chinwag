import { useMemo } from 'react';
import type { LiveAgent } from '../../widgets/types.js';
import type { TeamSummaryLive } from '../../lib/schemas/common.js';

interface UseOverviewDataReturn {
  totalActive: number;
  totalSessions: number;
  totalMemories: number;
  totalConflicts: number;
  liveAgents: LiveAgent[];
  sortedSummaries: TeamSummaryLive[];
}

export function useOverviewData(summaries: TeamSummaryLive[]): UseOverviewDataReturn {
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

  const sortedSummaries = useMemo((): TeamSummaryLive[] => {
    return [...summaries].sort((a, b) => {
      const aAgents = a.active_agents || 0;
      const bAgents = b.active_agents || 0;
      const aSessions = a.recent_sessions_24h || 0;
      const bSessions = b.recent_sessions_24h || 0;
      const aIdle = aAgents === 0 && aSessions === 0;
      const bIdle = bAgents === 0 && bSessions === 0;
      if (aIdle !== bIdle) return aIdle ? 1 : -1;
      if (aAgents !== bAgents) return bAgents - aAgents;
      if (aSessions !== bSessions) return bSessions - aSessions;
      // Deterministic tiebreaker: without this, all-idle project lists
      // reshuffle between polls because JS sort stability can't rescue a
      // 0-vs-0 score collapse.
      const aName = (a.team_name || a.team_id || '').toLowerCase();
      const bName = (b.team_name || b.team_id || '').toLowerCase();
      return aName.localeCompare(bName);
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
