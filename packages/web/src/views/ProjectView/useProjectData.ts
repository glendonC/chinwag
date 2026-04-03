import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePollingStore } from '../../lib/stores/polling.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import {
  buildLiveToolMix,
  buildUsageEntries,
  type ToolMixEntry,
  type UsageEntry,
} from '../../lib/toolAnalytics.js';
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

type ContextData = Record<string, any> | null;
type Member = any;
type Memory = any;
type Session = any;
type Lock = any;
type ToolConfigured = any;
type HostConfigured = any;
type SurfaceSeen = any;
type Conflict = any;
type ToolSummary = any;
type HostSummary = any;
type SurfaceSummary = any;

type Team = { team_id: string; team_name?: string; joined_at?: string };

interface UseProjectDataReturn {
  contextData: ContextData;
  contextStatus: string;
  contextTeamId: string | null;
  pollError: string | null;
  lastUpdate: Date | null;
  activeTeamId: string | null;
  teams: Team[];
  activeTeam: Team | null;
  hasCurrentContext: boolean;
  projectLabel: string;
  members: Member[];
  memories: Memory[];
  allSessions: Session[];
  sessions: Session[];
  locks: Lock[];
  toolsConfigured: ToolConfigured[];
  hostsConfigured: HostConfigured[];
  surfacesSeen: SurfaceSeen[];
  usage: Record<string, unknown>;
  activeAgents: Member[];
  offlineAgents: Member[];
  sortedAgents: Member[];
  liveToolMix: ToolMixEntry[];
  usageEntries: UsageEntry[];
  conflicts: Conflict[];
  filesInPlay: string[];
  filesTouched: string[];
  memoryBreakdown: [string, number][];
  sessionEditCount: number;
  filesTouchedCount: number;
  liveSessionCount: number;
  toolSummaries: ToolSummary[];
  hostSummaries: HostSummary[];
  surfaceSummaries: SurfaceSummary[];
  modelsSeen: string[];
  lastSynced: string | null;
  isLoading: boolean;
  isUnavailable: boolean;
}

export function useProjectData(): UseProjectDataReturn {
  const { contextData, contextStatus, contextTeamId, pollError, lastUpdate } = usePollingStore(
    useShallow((s) => ({
      contextData: s.contextData as ContextData,
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

  const members = useMemo<Member[]>(
    () => (contextData?.members as Member[]) ?? [],
    [contextData?.members],
  );
  const memories = useMemo<Memory[]>(
    () => (contextData?.memories as Memory[]) ?? [],
    [contextData?.memories],
  );
  const allSessions = useMemo<Session[]>(
    () =>
      selectRecentSessions(
        (contextData?.recentSessions as Session[]) || (contextData?.sessions as Session[]) || [],
      ),
    [contextData?.recentSessions, contextData?.sessions],
  );
  const sessions = allSessions.slice(0, 8);
  const locks = useMemo<Lock[]>(() => (contextData?.locks as Lock[]) ?? [], [contextData?.locks]);
  const toolsConfigured = useMemo<ToolConfigured[]>(
    () => (contextData?.tools_configured as ToolConfigured[]) ?? [],
    [contextData?.tools_configured],
  );
  const hostsConfigured = useMemo<HostConfigured[]>(
    () => (contextData?.hosts_configured as HostConfigured[]) ?? [],
    [contextData?.hosts_configured],
  );
  const surfacesSeen = useMemo<SurfaceSeen[]>(
    () => (contextData?.surfaces_seen as SurfaceSeen[]) ?? [],
    [contextData?.surfaces_seen],
  );
  const usage = useMemo<Record<string, unknown>>(
    () => (contextData?.usage as Record<string, unknown>) ?? {},
    [contextData?.usage],
  );

  // Trivial derivations — compute directly, no memo overhead
  const activeAgents = members.filter((member: Member) => member.status === 'active');
  const offlineAgents = members.filter((member: Member) => member.status === 'offline');
  const sortedAgents = activeAgents.concat(offlineAgents);
  const sessionEditCount: number = sumSessionEdits(allSessions);
  const liveSessionCount: number = countLiveSessions(allSessions);

  // Heavier derivations — build Maps/Sets/complex structures, worth memoizing
  const liveToolMix = useMemo(() => buildLiveToolMix(members), [members]);
  const usageEntries = useMemo(() => buildUsageEntries(usage), [usage]);
  const conflicts: Conflict[] = useMemo(
    () => buildProjectConflicts((contextData?.conflicts as Conflict[]) || [], members),
    [contextData?.conflicts, members],
  );
  const filesInPlay: string[] = useMemo(
    () => buildFilesInPlay(activeAgents, locks),
    [activeAgents, locks],
  );
  const filesTouched: string[] = useMemo(() => buildFilesTouched(allSessions), [allSessions]);
  const filesTouchedCount = filesTouched.length;
  const memoryBreakdown: [string, number][] = useMemo(
    () => buildMemoryBreakdown(memories),
    [memories],
  );
  const toolSummaries: ToolSummary[] = useMemo(
    () => buildProjectToolSummaries(members, toolsConfigured),
    [members, toolsConfigured],
  );
  const hostSummaries: HostSummary[] = useMemo(
    () => buildProjectHostSummaries(members, hostsConfigured),
    [members, hostsConfigured],
  );
  const surfaceSummaries: SurfaceSummary[] = useMemo(
    () => buildProjectSurfaceSummaries(members, surfacesSeen),
    [members, surfacesSeen],
  );
  const modelsSeen = useMemo<string[]>(
    () => (contextData?.models_seen as string[]) ?? [],
    [contextData?.models_seen],
  );

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
