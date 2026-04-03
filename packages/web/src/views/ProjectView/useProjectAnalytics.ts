import { useMemo } from 'react';
import { usePollingStore } from '../../lib/stores/polling.js';
import {
  buildFilesInPlay,
  buildProjectConflicts,
  buildProjectToolSummaries,
} from './projectViewState.js';

type Member = any;
type Lock = any;
type ToolConfigured = any;
type Conflict = any;
type ToolSummary = any;

interface UseProjectAnalyticsReturn {
  locks: Lock[];
  conflicts: Conflict[];
  filesInPlay: string[];
  toolSummaries: ToolSummary[];
}

export default function useProjectAnalytics(): UseProjectAnalyticsReturn {
  const contextData = usePollingStore((s) => s.contextData) as Record<string, unknown> | null;

  const members = useMemo<Member[]>(
    () => (contextData?.members as Member[]) ?? [],
    [contextData?.members],
  );
  const locks = useMemo<Lock[]>(() => (contextData?.locks as Lock[]) ?? [], [contextData?.locks]);
  const toolsConfigured = useMemo<ToolConfigured[]>(
    () => (contextData?.tools_configured as ToolConfigured[]) ?? [],
    [contextData?.tools_configured],
  );

  const activeAgents = useMemo(
    () => members.filter((member: Member) => member.status === 'active'),
    [members],
  );
  const conflicts = useMemo(
    () => buildProjectConflicts((contextData?.conflicts as Conflict[]) || [], members),
    [contextData?.conflicts, members],
  );
  const filesInPlay: string[] = useMemo(
    () => buildFilesInPlay(activeAgents, locks),
    [activeAgents, locks],
  );
  const toolSummaries: ToolSummary[] = useMemo(
    () => buildProjectToolSummaries(members, toolsConfigured),
    [members, toolsConfigured],
  );

  return {
    locks,
    conflicts,
    filesInPlay,
    toolSummaries,
  };
}
