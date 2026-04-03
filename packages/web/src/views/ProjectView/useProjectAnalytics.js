import { useMemo } from 'react';
import { usePollingStore } from '../../lib/stores/polling.js';
import {
  buildFilesInPlay,
  buildProjectConflicts,
  buildProjectToolSummaries,
} from './projectViewState.js';

/**
 * Analytics and coordination data: conflicts, file overlap, and tool summaries.
 */
export default function useProjectAnalytics() {
  const contextData = usePollingStore((s) => s.contextData);

  const members = contextData?.members || [];
  const locks = contextData?.locks || [];
  const toolsConfigured = contextData?.tools_configured || [];

  const activeAgents = useMemo(
    () => members.filter((member) => member.status === 'active'),
    [members],
  );
  const conflicts = useMemo(
    () => buildProjectConflicts(contextData?.conflicts || [], members),
    [contextData, members],
  );
  const filesInPlay = useMemo(() => buildFilesInPlay(activeAgents, locks), [activeAgents, locks]);
  const toolSummaries = useMemo(
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
