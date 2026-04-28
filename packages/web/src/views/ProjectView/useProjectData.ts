import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePollingStore } from '../../lib/stores/polling.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import { MAX_DISPLAY_SESSIONS } from '../../lib/constants.js';
import {
  buildLiveToolMix,
  buildUsageEntries,
  type ToolMixEntry,
  type UsageEntry,
} from '../../lib/toolAnalytics.js';
import type {
  TeamContext,
  Member,
  Memory,
  Session,
  Lock,
  HostMetric,
  SurfaceMetric,
  ModelMetric,
} from '../../lib/apiSchemas.js';
import {
  buildFilesInPlay,
  buildFilesTouched,
  buildProjectHostSummaries,
  buildMemoryBreakdown,
  buildProjectConflicts,
  buildProjectSurfaceSummaries,
  buildProjectToolSummaries,
  buildOutcomeBreakdown,
  sumLineStats,
  countLiveSessions,
  selectRecentSessions,
  sumSessionEdits,
  type UsageSummaryEntry,
  type FileConflict,
  type OutcomeBreakdown,
  type LineStats,
} from './projectViewState.js';

type Team = { team_id: string; team_name?: string; joined_at?: string };

interface UseProjectDataReturn {
  contextData: TeamContext | null;
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
  toolsConfigured: HostMetric[];
  hostsConfigured: HostMetric[];
  surfacesSeen: SurfaceMetric[];
  usage: Record<string, number>;
  activeAgents: Member[];
  offlineAgents: Member[];
  sortedAgents: Member[];
  liveToolMix: ToolMixEntry[];
  usageEntries: UsageEntry[];
  conflicts: FileConflict[];
  filesInPlay: string[];
  filesTouched: string[];
  memoryBreakdown: [string, number][];
  sessionEditCount: number;
  filesTouchedCount: number;
  liveSessionCount: number;
  outcomeBreakdown: OutcomeBreakdown;
  lineStats: LineStats;
  toolSummaries: UsageSummaryEntry[];
  hostSummaries: UsageSummaryEntry[];
  surfaceSummaries: UsageSummaryEntry[];
  modelsSeen: ModelMetric[];
  availableSpawnTools: string[];
  lastSynced: string | null;
  isLoading: boolean;
  isUnavailable: boolean;
}

export function useProjectData(): UseProjectDataReturn {
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

  const members = useMemo<Member[]>(() => contextData?.members ?? [], [contextData?.members]);
  const memories = useMemo<Memory[]>(() => contextData?.memories ?? [], [contextData?.memories]);
  const allSessions = useMemo<Session[]>(
    () => selectRecentSessions(contextData?.recentSessions || contextData?.sessions || []),
    [contextData?.recentSessions, contextData?.sessions],
  );
  const sessions = allSessions.slice(0, MAX_DISPLAY_SESSIONS);
  const locks = useMemo<Lock[]>(() => contextData?.locks ?? [], [contextData?.locks]);
  const toolsConfigured = useMemo<HostMetric[]>(
    () => contextData?.tools_configured ?? [],
    [contextData?.tools_configured],
  );
  const hostsConfigured = useMemo<HostMetric[]>(
    () => contextData?.hosts_configured ?? [],
    [contextData?.hosts_configured],
  );
  const surfacesSeen = useMemo<SurfaceMetric[]>(
    () => contextData?.surfaces_seen ?? [],
    [contextData?.surfaces_seen],
  );
  const usage = useMemo<Record<string, number>>(
    () => contextData?.usage ?? {},
    [contextData?.usage],
  );

  // Trivial derivations - compute directly, no memo overhead
  const activeAgents = members.filter((member) => member.status === 'active');
  const offlineAgents = members.filter((member) => member.status === 'offline');
  const sortedAgents = activeAgents.concat(offlineAgents);
  const sessionEditCount: number = sumSessionEdits(allSessions);
  const liveSessionCount: number = countLiveSessions(allSessions);
  const outcomeBreakdown: OutcomeBreakdown = buildOutcomeBreakdown(allSessions);
  const lineStats: LineStats = sumLineStats(allSessions);

  // Heavier derivations - build Maps/Sets/complex structures, worth memoizing
  const liveToolMix = useMemo(() => buildLiveToolMix(members), [members]);
  const usageEntries = useMemo(() => buildUsageEntries(usage), [usage]);
  const conflicts: FileConflict[] = useMemo(
    () => buildProjectConflicts(contextData?.conflicts || [], members),
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
  const toolSummaries: UsageSummaryEntry[] = useMemo(
    () => buildProjectToolSummaries(members, toolsConfigured),
    [members, toolsConfigured],
  );
  const hostSummaries: UsageSummaryEntry[] = useMemo(
    () => buildProjectHostSummaries(members, hostsConfigured),
    [members, hostsConfigured],
  );
  const surfaceSummaries: UsageSummaryEntry[] = useMemo(
    () => buildProjectSurfaceSummaries(members, surfacesSeen),
    [members, surfacesSeen],
  );
  const modelsSeen = useMemo<ModelMetric[]>(
    () => contextData?.models_seen ?? [],
    [contextData?.models_seen],
  );
  const availableSpawnTools = useMemo<string[]>(
    () => contextData?.daemon?.available_tools ?? [],
    [contextData?.daemon],
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
    outcomeBreakdown,
    lineStats,
    toolSummaries,
    hostSummaries,
    surfaceSummaries,
    modelsSeen,
    availableSpawnTools,

    // View state
    lastSynced,
    isLoading,
    isUnavailable,
  };
}
