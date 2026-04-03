import { useShallow } from 'zustand/react/shallow';
import { usePollingStore } from '../../lib/stores/polling.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';

interface UseProjectStatusReturn {
  contextData: unknown;
  activeTeamId: string | null;
  activeTeam: { team_id: string; team_name?: string; joined_at?: string } | null;
  hasCurrentContext: boolean;
  projectLabel: string;
  pollError: string | null;
  lastSynced: string | null;
  isLoading: boolean;
  isUnavailable: boolean;
}

export default function useProjectStatus(): UseProjectStatusReturn {
  const { contextData, contextStatus, contextTeamId, pollError, lastUpdate } = usePollingStore(
    useShallow((s) => ({
      contextData: s.contextData,
      contextStatus: s.contextStatus,
      contextTeamId: s.contextTeamId,
      pollError: s.pollError,
      lastUpdate: s.lastUpdate,
    })),
  );
  const { activeTeamId, teams } = useTeamStore(
    useShallow((s) => ({
      activeTeamId: s.activeTeamId,
      teams: s.teams,
    })),
  );

  const activeTeam = teams.find((team) => team.team_id === activeTeamId) || null;
  const hasCurrentContext = contextTeamId === activeTeamId && !!contextData;
  const projectLabel = activeTeam?.team_name || activeTeam?.team_id || 'this project';
  const lastSynced = formatRelativeTime(lastUpdate);
  const isLoading = !hasCurrentContext && (contextStatus === 'idle' || contextStatus === 'loading');
  const isUnavailable = !hasCurrentContext && contextStatus === 'error';

  return {
    contextData,
    activeTeamId,
    activeTeam,
    hasCurrentContext,
    projectLabel,
    pollError,
    lastSynced,
    isLoading,
    isUnavailable,
  };
}
