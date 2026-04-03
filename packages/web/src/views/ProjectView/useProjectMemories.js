import { useMemo, useCallback } from 'react';
import { usePollingStore } from '../../lib/stores/polling.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { teamActions } from '../../lib/stores/teams.js';
import { buildMemoryBreakdown } from './projectViewState.js';

/**
 * Memory-related derived data: memories list, tag breakdown, and mutation handlers.
 */
export default function useProjectMemories() {
  const contextData = usePollingStore((s) => s.contextData);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);

  const memories = contextData?.memories || [];
  const memoryBreakdown = useMemo(() => buildMemoryBreakdown(memories), [memories]);

  const handleUpdateMemory = useCallback(
    async (id, text, tags) => {
      if (!activeTeamId) return;
      await teamActions.updateMemory(activeTeamId, id, text, tags);
    },
    [activeTeamId],
  );

  const handleDeleteMemory = useCallback(
    async (id) => {
      if (!activeTeamId) return;
      await teamActions.deleteMemory(activeTeamId, id);
    },
    [activeTeamId],
  );

  return {
    memories,
    memoryBreakdown,
    handleUpdateMemory,
    handleDeleteMemory,
  };
}
