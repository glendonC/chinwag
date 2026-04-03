import { usePollingStore } from '../../lib/stores/polling.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';

/**
 * Store subscriptions and derived project status.
 * Returns loading/unavailable flags, active team info, and sync metadata.
 */
export default function useProjectStatus() {
  const contextData = usePollingStore((s) => s.contextData);
  const contextStatus = usePollingStore((s) => s.contextStatus);
  const contextTeamId = usePollingStore((s) => s.contextTeamId);
  const pollError = usePollingStore((s) => s.pollError);
  const lastUpdate = usePollingStore((s) => s.lastUpdate);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const teams = useTeamStore((s) => s.teams);

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
