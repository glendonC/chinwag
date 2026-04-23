import { useState, useCallback, useMemo } from 'react';

interface Team {
  team_id: string;
  team_name?: string | null;
}

const STORAGE_KEY = 'chinmeister:overview-project-filter';

function loadFilter(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) {
        return parsed;
      }
    }
  } catch {
    // Ignore corrupt storage
  }
  return null;
}

function saveFilter(ids: string[] | null) {
  try {
    if (ids === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    }
  } catch {
    // Ignore storage quota
  }
}

export function useProjectFilter(allTeams: Team[]) {
  const [selectedIds, setSelectedIdsInner] = useState<string[] | null>(loadFilter);

  // Intersect with actual teams to drop stale IDs
  const effectiveIds = useMemo(() => {
    if (!selectedIds) return undefined; // undefined = all teams, no filter
    const valid = new Set(allTeams.map((t) => t.team_id));
    const filtered = selectedIds.filter((id) => valid.has(id));
    // If all teams are selected, treat as "all" (no filter)
    if (filtered.length === allTeams.length) return undefined;
    return filtered;
  }, [selectedIds, allTeams]);

  const isAllSelected = effectiveIds === undefined;
  const isSingleProject = effectiveIds?.length === 1;

  const toggle = useCallback(
    (teamId: string) => {
      setSelectedIdsInner((prev) => {
        // If currently "all", start with all IDs and remove the toggled one
        const current = prev ?? allTeams.map((t) => t.team_id);
        const next = current.includes(teamId)
          ? current.filter((id) => id !== teamId)
          : [...current, teamId];
        saveFilter(next.length === allTeams.length ? null : next);
        return next.length === allTeams.length ? null : next;
      });
    },
    [allTeams],
  );

  const selectAll = useCallback(() => {
    saveFilter(null);
    setSelectedIdsInner(null);
  }, []);

  const selectNone = useCallback(() => {
    saveFilter([]);
    setSelectedIdsInner([]);
  }, []);

  const isSelected = useCallback(
    (teamId: string) => {
      if (!selectedIds) return true; // all selected
      return selectedIds.includes(teamId);
    },
    [selectedIds],
  );

  return {
    selectedIds: effectiveIds,
    isAllSelected,
    isSingleProject,
    toggle,
    selectAll,
    selectNone,
    isSelected,
  };
}
