import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuthStore } from '../../lib/stores/auth.js';
import { usePollingStore } from '../../lib/stores/polling.js';
import { setQueryParam, useQueryParam } from '../../lib/router.js';
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
import { normalizeToolId, isKnownTool } from '../../lib/toolMeta.js';
import {
  arcPath,
  CX,
  CY,
  R,
  SW,
  GAP,
  DEG,
  LEADER_GAP,
  LEADER_STUB,
  LEADER_H,
  MIN_LABEL_GAP,
} from '../../lib/svgArcs.js';

export { arcPath, CX, CY, R, SW };

const VERDICT_ORDER: Record<string, number> = {
  integrated: 0,
  compatible: 0,
  installable: 1,
  partial: 1,
  listed: 2,
  incompatible: 2,
};

export interface ArcEntry {
  tool: string;
  joins: number;
  share: number;
  startDeg: number;
  sweepDeg: number;
  anchorX: number;
  anchorY: number;
  elbowX: number;
  elbowY: number;
  labelX: number;
  labelY: number;
  side: 'left' | 'right';
  labeled: boolean;
}

export interface ToolsViewData {
  token: string | null;
  loading: boolean;
  categories: Record<string, string>;
  evaluations: ToolDirectoryEvaluation[];
  toolShare: JoinShareEntry[];
  knownToolShare: JoinShareEntry[];
  hostShare: JoinShareEntry[];
  surfaceShare: JoinShareEntry[];
  categoryShare: CategoryEntry[];
  categoryList: [string, string][];
  connectedProjects: number;
  arcs: ArcEntry[];
  uniqueTools: number;
  filteredEvaluations: ToolDirectoryEvaluation[];
  activeCategory: string;
  setActiveCategory: (v: string) => void;
  activeVerdict: string;
  setActiveVerdict: (v: string) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  selectedToolId: string | null;
  selectedEvaluation: ToolDirectoryEvaluation | null;
  selectTool: (id: string | null) => void;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
  hideConfigured: boolean;
  setHideConfigured: (v: boolean) => void;
  isConfigured: (toolId: string) => boolean;
}

export function useToolsViewData(): ToolsViewData {
  const token = useAuthStore((s) => s.token);
  const dashboardData = usePollingStore((s) => s.dashboardData);
  const { catalog, categories, evaluations, loading } = useToolCatalog(token);

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [activeVerdict, setActiveVerdict] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showAll, setShowAll] = useState<boolean>(false);

  // URL-synced tool selection for spatial navigation
  const selectedToolId = useQueryParam('tool');
  const selectTool = useCallback((id: string | null) => setQueryParam('tool', id), []);
  const [hideConfigured, setHideConfigured] = useState<boolean>(true);
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

  // Sets of configured tool IDs for quick lookup
  const userToolIds = useMemo(
    () => new Set(toolShare.map((tool) => normalizeToolId(tool.tool as string))),
    [toolShare],
  );
  const userHostIds = useMemo(
    () => new Set(hostShare.map((host) => normalizeToolId(host.host_tool as string))),
    [hostShare],
  );
  const seenSurfaceIds = useMemo(
    () => new Set(surfaceShare.map((surface) => normalizeToolId(surface.agent_surface as string))),
    [surfaceShare],
  );

  const isConfigured = useMemo(() => {
    return (toolId: string) => {
      const id = normalizeToolId(toolId);
      return userToolIds.has(id) || userHostIds.has(id) || seenSurfaceIds.has(id);
    };
  }, [userToolIds, userHostIds, seenSurfaceIds]);

  // Categories the user already has tools in — for relevance sorting
  const userCategoryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tool of toolShare) {
      const match = catalog.find(
        (c) => normalizeToolId(c.id) === normalizeToolId(tool.tool as string),
      );
      if (match?.category) ids.add(match.category);
    }
    return ids;
  }, [toolShare, catalog]);

  const categoryList = useMemo(() => Object.entries(categories), [categories]);
  const connectedProjects = dashboardSnapshot?.teams?.length || 0;

  // Known tools only — filter out "unknown", "daemon", unidentified agents.
  // Recalculate shares so they sum to 100% among recognized tools.
  const knownToolShare = useMemo(() => {
    const known = toolShare.filter((t) => isKnownTool(t.tool as string));
    const total = known.reduce((s, e) => s + e.value, 0);
    return known.map((t) => ({ ...t, share: total > 0 ? t.value / total : 0 }) as JoinShareEntry);
  }, [toolShare]);

  // All tools get arc segments; labels shown unless they'd overlap on the same side.
  // Highest-value tools win label priority when space is contested.
  const arcs = useMemo((): ArcEntry[] => {
    if (!knownToolShare.length) return [];
    const totalGap = GAP * knownToolShare.length;
    const available = 360 - totalGap;
    const total = knownToolShare.reduce((s, e) => s + e.value, 0);
    const anchorR = R + SW / 2 + LEADER_GAP;
    const elbowR = R + SW / 2 + LEADER_GAP + LEADER_STUB;

    // Precompute sweep widths and cumulative offsets (no mutation inside map)
    const sweeps = knownToolShare.map((e) =>
      Math.max((total > 0 ? e.value / total : 0) * available, 4),
    );
    const offsets = sweeps.map((_, i, arr) => arr.slice(0, i).reduce((s, sw) => s + sw + GAP, 0));

    const entries: ArcEntry[] = knownToolShare.map((entry, i) => {
      const share = total > 0 ? entry.value / total : 0;
      const sweep = sweeps[i];
      const offset = offsets[i];
      const midDeg = (offset + sweep / 2 - 90) * DEG;
      const side: 'left' | 'right' = Math.cos(midDeg) >= 0 ? 'right' : 'left';
      const anchorX = CX + anchorR * Math.cos(midDeg);
      const anchorY = CY + anchorR * Math.sin(midDeg);
      const elbowX = CX + elbowR * Math.cos(midDeg);
      const elbowY = CY + elbowR * Math.sin(midDeg);
      return {
        tool: entry.tool as string,
        joins: entry.value,
        share,
        startDeg: offset,
        sweepDeg: sweep,
        anchorX,
        anchorY,
        elbowX,
        elbowY,
        labelX: side === 'right' ? elbowX + LEADER_H : elbowX - LEADER_H,
        labelY: elbowY,
        side,
        labeled: false,
      };
    });

    // Pass 2: per-side collision detection — highest-value arcs get label priority
    for (const side of ['left', 'right'] as const) {
      const candidates = entries
        .map((e, i) => ({ i, value: e.joins, y: e.labelY }))
        .filter(({ i }) => entries[i].side === side)
        .sort((a, b) => b.value - a.value);

      const placed: number[] = [];
      for (const { i, y } of candidates) {
        if (placed.every((py) => Math.abs(py - y) >= MIN_LABEL_GAP)) {
          entries[i].labeled = true;
          placed.push(y);
        }
      }
    }

    return entries;
  }, [knownToolShare]);

  const uniqueTools = knownToolShare.length;

  // Filtered + sorted directory evaluations
  const filteredEvaluations = useMemo(() => {
    let result = evaluations;

    // Hide configured tools when toggle is active
    if (hideConfigured) {
      result = result.filter((ev) => !isConfigured(ev.id));
    }

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
      // When showing only non-configured, sort by category relevance first
      if (hideConfigured) {
        const aRelevant = a.category && userCategoryIds.has(a.category) ? 1 : 0;
        const bRelevant = b.category && userCategoryIds.has(b.category) ? 1 : 0;
        if (aRelevant !== bRelevant) return bRelevant - aRelevant;
      } else {
        // When showing all, configured tools come first
        const aConfigured = isConfigured(a.id) ? 1 : 0;
        const bConfigured = isConfigured(b.id) ? 1 : 0;
        if (aConfigured !== bConfigured) return bConfigured - aConfigured;
      }

      // Then by verdict quality
      const aV = VERDICT_ORDER[a.verdict ?? ''] ?? 3;
      const bV = VERDICT_ORDER[b.verdict ?? ''] ?? 3;
      if (aV !== bV) return aV - bV;

      return (a.name || '').localeCompare(b.name || '');
    });
  }, [
    evaluations,
    hideConfigured,
    isConfigured,
    userCategoryIds,
    activeCategory,
    activeVerdict,
    searchQuery,
  ]);

  return {
    token,
    loading,
    categories,
    evaluations,
    toolShare,
    knownToolShare,
    hostShare,
    surfaceShare,
    categoryShare,
    categoryList,
    connectedProjects,
    arcs,
    uniqueTools,
    filteredEvaluations,
    activeCategory,
    setActiveCategory,
    activeVerdict,
    setActiveVerdict,
    searchQuery,
    setSearchQuery,
    selectedToolId,
    selectedEvaluation: evaluations.find((ev) => ev.id === selectedToolId) ?? null,
    selectTool,
    showAll,
    setShowAll,
    hideConfigured,
    setHideConfigured,
    isConfigured,
  };
}
