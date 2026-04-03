import { useMemo } from 'react';
import { usePollingStore } from '../../lib/stores/polling.js';
import { buildUsageEntries } from '../../lib/toolAnalytics.js';
import {
  buildFilesInPlay,
  buildProjectConflicts,
  buildProjectHostSummaries,
  buildProjectSurfaceSummaries,
  buildProjectToolSummaries,
} from './projectViewState.js';

/**
 * Analytics and tool infrastructure data: usage, conflicts, file overlap,
 * tool/host/surface summaries, and observed models.
 */
export default function useProjectAnalytics() {
  const contextData = usePollingStore((s) => s.contextData);

  const members = contextData?.members || [];
  const locks = contextData?.locks || [];
  const toolsConfigured = contextData?.tools_configured || [];
  const hostsConfigured = contextData?.hosts_configured || [];
  const surfacesSeen = contextData?.surfaces_seen || [];
  const usage = contextData?.usage || {};

  const activeAgents = useMemo(
    () => members.filter((member) => member.status === 'active'),
    [members],
  );
  const usageEntries = useMemo(() => buildUsageEntries(usage), [usage]);
  const conflicts = useMemo(
    () => buildProjectConflicts(contextData?.conflicts || [], members),
    [contextData, members],
  );
  const filesInPlay = useMemo(() => buildFilesInPlay(activeAgents, locks), [activeAgents, locks]);
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

  return {
    locks,
    usageEntries,
    conflicts,
    filesInPlay,
    toolSummaries,
    hostSummaries,
    surfaceSummaries,
    modelsSeen,
  };
}
