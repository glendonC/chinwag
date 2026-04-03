import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePollingStore } from '../../lib/stores/polling.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import { buildLiveToolMix, buildUsageEntries } from '../../lib/toolAnalytics.js';
import {
  buildFilesInPlay,
  buildFilesTouched,
  buildProjectHostSummaries,
  buildMemoryBreakdown,
  buildProjectConflicts,
  buildProjectSurfaceSummaries,
  buildProjectToolSummaries,
  countLiveSessions,
  selectRecentSessions,
  sumSessionEdits,
} from './projectViewState.js';

export function useProjectData() {
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

  const members = contextData?.members || [];
  const memories = contextData?.memories || [];
  const allSessions = useMemo(
    () => selectRecentSessions(contextData?.recentSessions || contextData?.sessions || []),
    [contextData],
  );
  const sessions = allSessions.slice(0, 8);
  const locks = contextData?.locks || [];
  const toolsConfigured = contextData?.tools_configured || [];
  const hostsConfigured = contextData?.hosts_configured || [];
  const surfacesSeen = contextData?.surfaces_seen || [];
  const usage = contextData?.usage || {};

  // Trivial derivations — compute directly, no memo overhead
  const activeAgents = members.filter((member) => member.status === 'active');
  const offlineAgents = members.filter((member) => member.status === 'offline');
  const sortedAgents = activeAgents.concat(offlineAgents);
  const sessionEditCount = sumSessionEdits(allSessions);
  const liveSessionCount = countLiveSessions(allSessions);

  // Heavier derivations — build Maps/Sets/complex structures, worth memoizing
  const liveToolMix = useMemo(() => buildLiveToolMix(members), [members]);
  const usageEntries = useMemo(() => buildUsageEntries(usage), [usage]);
  const conflicts = useMemo(
    () => buildProjectConflicts(contextData?.conflicts || [], members),
    [contextData, members],
  );
  const filesInPlay = useMemo(() => buildFilesInPlay(activeAgents, locks), [activeAgents, locks]);
  const filesTouched = useMemo(() => buildFilesTouched(allSessions), [allSessions]);
  const filesTouchedCount = filesTouched.length;
  const memoryBreakdown = useMemo(() => buildMemoryBreakdown(memories), [memories]);
  const toolSummaries = useMemo(
    () => buildProjectToolSummaries(members, toolsConfigured),
    [members, toolsConfigured],
  );
  const hostSummaries = useMemo(
    () => buildProjectHostSummaries(members, hostsConfigured),
    [members, hostsConfigured],
  );
  const surfaceSummaries = useMemo(
    () => buildProjectSurfaceSummaries(members, surfacesSeen),
    [members, surfacesSeen],
  );
  const modelsSeen = contextData?.models_seen || [];

  const lastSynced = formatRelativeTime(lastUpdate);
  const isLoading = !hasCurrentContext && (contextStatus === 'idle' || contextStatus === 'loading');
  const isUnavailable = !hasCurrentContext && contextStatus === 'error';

  return {
    // Store values
    contextData,
    contextStatus,
    contextTeamId,
    pollError,
    lastUpdate,
    activeTeamId,
    teams,

    // Derived team info
    activeTeam,
    hasCurrentContext,
    projectLabel,

    // Context data extractions
    members,
    memories,
    allSessions,
    sessions,
    locks,
    toolsConfigured,
    hostsConfigured,
    surfacesSeen,
    usage,

    // Computed derivations
    activeAgents,
    offlineAgents,
    sortedAgents,
    liveToolMix,
    usageEntries,
    conflicts,
    filesInPlay,
    filesTouched,
    memoryBreakdown,
    sessionEditCount,
    filesTouchedCount,
    liveSessionCount,
    toolSummaries,
    hostSummaries,
    surfaceSummaries,
    modelsSeen,

    // View state
    lastSynced,
    isLoading,
    isUnavailable,
  };
}
