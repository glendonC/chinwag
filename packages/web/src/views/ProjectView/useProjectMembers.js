import { useMemo } from 'react';
import { usePollingStore } from '../../lib/stores/polling.js';
import { buildLiveToolMix } from '../../lib/toolAnalytics.js';

/**
 * Member-related derived data: agent lists and live tool distribution.
 */
export default function useProjectMembers() {
  const contextData = usePollingStore((s) => s.contextData);

  const members = contextData?.members || [];

  const activeAgents = useMemo(
    () => members.filter((member) => member.status === 'active'),
    [members],
  );
  const offlineAgents = useMemo(
    () => members.filter((member) => member.status === 'offline'),
    [members],
  );
  const sortedAgents = useMemo(
    () => [...activeAgents, ...offlineAgents],
    [activeAgents, offlineAgents],
  );
  const liveToolMix = useMemo(() => buildLiveToolMix(members), [members]);

  return {
    members,
    activeAgents,
    offlineAgents,
    sortedAgents,
    liveToolMix,
  };
}
