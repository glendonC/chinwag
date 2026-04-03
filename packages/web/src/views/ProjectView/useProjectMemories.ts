import { useMemo, useCallback } from 'react';
import { usePollingStore } from '../../lib/stores/polling.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { teamActions } from '../../lib/stores/teams.js';
import { buildMemoryBreakdown } from './projectViewState.js';

type Memory = any;

interface UseProjectMemoriesReturn {
  memories: Memory[];
  memoryBreakdown: [string, number][];
  handleUpdateMemory: (id: string, text?: string, tags?: string[]) => Promise<void>;
  handleDeleteMemory: (id: string) => Promise<void>;
}

export default function useProjectMemories(): UseProjectMemoriesReturn {
  const contextData = usePollingStore((s) => s.contextData) as Record<string, unknown> | null;
  const activeTeamId = useTeamStore((s) => s.activeTeamId);

  const memories = useMemo<Memory[]>(
    () => (contextData?.memories as Memory[]) ?? [],
    [contextData?.memories],
  );
  const memoryBreakdown: [string, number][] = useMemo(
    () => buildMemoryBreakdown(memories),
    [memories],
  );

  const handleUpdateMemory = useCallback(
    async (id: string, text?: string, tags?: string[]) => {
      if (!activeTeamId) return;
      await teamActions.updateMemory(activeTeamId, id, text, tags);
    },
    [activeTeamId],
  );

  const handleDeleteMemory = useCallback(
    async (id: string) => {
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
