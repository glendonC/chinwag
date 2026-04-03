import { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '../../lib/stores/auth.js';
import { usePollingStore } from '../../lib/stores/polling.js';
import { api } from '../../lib/api.js';
import {
  createEmptyDashboardSummary,
  dashboardSummarySchema,
  validateResponse,
  type DashboardSummary,
  type ToolDirectoryEvaluation,
} from '../../lib/apiSchemas.js';
import { useToolCatalog } from '../../lib/useToolCatalog.js';
import {
  buildCategoryJoinShare,
  buildHostJoinShare,
  buildSurfaceJoinShare,
  buildToolJoinShare,
  type JoinShareEntry,
  type CategoryEntry,
} from '../../lib/toolAnalytics.js';
import { normalizeToolId } from '../../lib/toolMeta.js';

const VERDICT_ORDER: Record<string, number> = {
  integrated: 0,
  compatible: 0,
  installable: 1,
  partial: 1,
  listed: 2,
  incompatible: 2,
};

export interface ToolsViewData {
  token: string | null;
  loading: boolean;
  catalog: ReturnType<typeof useToolCatalog>['catalog'];
  categories: Record<string, string>;
  evaluations: ToolDirectoryEvaluation[];
  toolShare: JoinShareEntry[];
  hostShare: JoinShareEntry[];
  surfaceShare: JoinShareEntry[];
  categoryShare: CategoryEntry[];
  categoryList: [string, string][];
  connectedProjects: number;
  filteredEvaluations: ToolDirectoryEvaluation[];
  activeCategory: string;
  setActiveCategory: (v: string) => void;
  activeVerdict: string;
  setActiveVerdict: (v: string) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  expandedId: string | null;
  setExpandedId: (v: string | null) => void;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
}

export function useToolsViewData(): ToolsViewData {
  const token = useAuthStore((s) => s.token);
  const dashboardData = usePollingStore((s) => s.dashboardData);
  const { catalog, categories, evaluations, loading } = useToolCatalog(token);

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [activeVerdict, setActiveVerdict] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState<boolean>(false);
  const [fallbackDashboardSnapshot, setFallbackDashboardSnapshot] =
    useState<DashboardSummary | null>(null);

  useEffect(() => {
    if (dashboardData) return;
    let cancelled = false;
    async function fetchDashboard() {
      try {
        const rawData = await api('GET', '/me/dashboard', null, token);
        const data = validateResponse(dashboardSummarySchema, rawData, 'tools-dashboard', {
          fallback: createEmptyDashboardSummary(),
        });
        if (!cancelled) setFallbackDashboardSnapshot(data as DashboardSummary);
      } catch {
        if (!cancelled) setFallbackDashboardSnapshot(createEmptyDashboardSummary());
      }
    }
    fetchDashboard();
    return () => {
      cancelled = true;
    };
  }, [dashboardData, token]);

  const dashboardSnapshot = dashboardData || fallbackDashboardSnapshot;

  const toolShare = useMemo<JoinShareEntry[]>(
    () => buildToolJoinShare(dashboardSnapshot?.teams || []),
    [dashboardSnapshot],
  );
  const hostShare = useMemo<JoinShareEntry[]>(
    () => buildHostJoinShare(dashboardSnapshot?.teams || []),
    [dashboardSnapshot],
  );
  const surfaceShare = useMemo<JoinShareEntry[]>(
    () => buildSurfaceJoinShare(dashboardSnapshot?.teams || []),
    [dashboardSnapshot],
  );
  const categoryShare = useMemo<CategoryEntry[]>(
    () => buildCategoryJoinShare(toolShare, catalog, categories),
    [toolShare, catalog, categories],
  );
  const userToolIds = useMemo(
    () => new Set(toolShare.map((tool) => tool.tool as string)),
    [toolShare],
  );
  const userHostIds = useMemo(
    () => new Set(hostShare.map((host) => host.host_tool as string)),
    [hostShare],
  );
  const seenSurfaceIds = useMemo(
    () => new Set(surfaceShare.map((surface) => surface.agent_surface as string)),
    [surfaceShare],
  );

  const categoryList = useMemo(() => Object.entries(categories), [categories]);
  const connectedProjects = dashboardSnapshot?.teams?.length || 0;

  const filteredEvaluations = useMemo(() => {
    let result = evaluations;

    if (activeCategory !== 'all') {
      result = result.filter((ev) => ev.category === activeCategory);
    }
    if (activeVerdict !== 'all') {
      result = result.filter((ev) => ev.verdict === activeVerdict);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (ev) =>
          (ev.name || '').toLowerCase().includes(q) ||
          (ev.id || '').toLowerCase().includes(q) ||
          (ev.tagline || '').toLowerCase().includes(q),
      );
    }

    return [...result].sort((a, b) => {
      const aId = normalizeToolId(a.id);
      const bId = normalizeToolId(b.id);
      const aConfigured =
        userToolIds.has(aId) || userHostIds.has(aId) || seenSurfaceIds.has(aId) ? 1 : 0;
      const bConfigured =
        userToolIds.has(bId) || userHostIds.has(bId) || seenSurfaceIds.has(bId) ? 1 : 0;
      if (aConfigured !== bConfigured) return bConfigured - aConfigured;
      const aV = VERDICT_ORDER[a.verdict ?? ''] ?? 3;
      const bV = VERDICT_ORDER[b.verdict ?? ''] ?? 3;
      if (aV !== bV) return aV - bV;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [
    evaluations,
    activeCategory,
    activeVerdict,
    searchQuery,
    userToolIds,
    userHostIds,
    seenSurfaceIds,
  ]);

  return {
    token,
    loading,
    catalog,
    categories,
    evaluations,
    toolShare,
    hostShare,
    surfaceShare,
    categoryShare,
    categoryList,
    connectedProjects,
    filteredEvaluations,
    activeCategory,
    setActiveCategory,
    activeVerdict,
    setActiveVerdict,
    searchQuery,
    setSearchQuery,
    expandedId,
    setExpandedId,
    showAll,
    setShowAll,
  };
}
