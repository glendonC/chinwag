/**
 * Derived data for the dashboard view - combined agent rows, memory lists,
 * selection clamping, viewport windows.
 *
 * Was previously packaged as a `DataProvider` React context, but it had
 * exactly one consumer (DashboardViewComponent). Making it a hook keeps
 * the memoisation, removes the context-plumbing indirection, and lets the
 * consumer pass hook returns explicitly instead of pulling them through
 * siblings. The reducer state is read through useView() because it's
 * genuinely multi-consumer.
 */
import { useEffect, useMemo } from 'react';
import { basename } from 'path';
import type { Dispatch } from 'react';
import { buildCombinedAgentRows, buildDashboardView } from '../view.js';
import type { CombinedAgentRow, ManagedAgent, MemoryEntry } from '../view.js';
import { getVisibleWindow } from '../utils.js';
import { RECENTLY_FINISHED_LIMIT, MIN_VIEWPORT_ROWS, VIEWPORT_CHROME_ROWS } from '../constants.js';
import { clampSelection } from '../reducer.js';
import type { DashboardAction, DashboardState } from '../reducer.js';
import type { UseAgentLifecycleReturn } from '../agents.js';
import type { UseMemoryManagerReturn } from '../memory.js';
import type { UseComposerReturn } from '../composer.js';
import type { UseDashboardConnectionReturn } from '../connection.jsx';

export interface DashboardDerivedData {
  // Agent-derived
  combinedAgents: CombinedAgentRow[];
  liveAgents: CombinedAgentRow[];
  allVisibleAgents: CombinedAgentRow[];
  selectedAgent: CombinedAgentRow | null;
  mainSelectedAgent: CombinedAgentRow | null;
  hasLiveAgents: boolean;
  liveAgentNameCounts: Map<string, number>;
  visibleSessionRows: { items: CombinedAgentRow[]; start: number };
  conflicts: Array<[string, string[]]>;
  getToolName: (id: string) => string | null;
  // Memory-derived
  memories: MemoryEntry[];
  filteredMemories: MemoryEntry[];
  visibleMemories: MemoryEntry[];
  visibleKnowledgeRows: { items: MemoryEntry[]; start: number };
  hasMemories: boolean;
}

interface UseDashboardDataArgs {
  viewportRows: number;
  state: DashboardState;
  dispatch: Dispatch<DashboardAction>;
  connection: UseDashboardConnectionReturn;
  agents: UseAgentLifecycleReturn;
  memory: UseMemoryManagerReturn;
  composer: UseComposerReturn;
}

export function useDashboardData({
  viewportRows,
  state,
  dispatch,
  connection,
  agents,
  memory,
  composer,
}: UseDashboardDataArgs): DashboardDerivedData {
  const { selectedIdx, mainFocus } = state;
  const { context, detectedTools, teamName, cols } = connection;

  const memorySearch = composer.composeMode === 'memory-search' ? memory.memorySearch : '';

  // Build dashboard view data (tool name resolver, visible agents, conflicts, memories)
  const dashboardView = useMemo(
    () =>
      buildDashboardView({
        context: context ?? undefined,
        detectedTools,
        memoryFilter: null,
        memorySearch,
        cols,
        projectDir: teamName || basename(process.cwd()),
      }),
    [context, detectedTools, memorySearch, cols, teamName],
  );

  // ── Agent-derived data ────────────────────────────

  // Build combined agent rows from managed + connected
  const combinedAgents = useMemo(
    () =>
      buildCombinedAgentRows({
        // AgentInfo[] from process-manager shares the same shape as ManagedAgent
        managedAgents: agents.managedAgents as ManagedAgent[],
        connectedAgents: dashboardView.visibleAgents,
        getToolName: dashboardView.getToolName,
      }),
    [agents.managedAgents, dashboardView.visibleAgents, dashboardView.getToolName],
  );

  const liveAgents = useMemo(
    () => combinedAgents.filter((agent) => !agent._dead),
    [combinedAgents],
  );

  const recentlyFinished = useMemo(
    () =>
      combinedAgents
        .filter((agent) => agent._managed && agent._dead)
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
        .slice(0, RECENTLY_FINISHED_LIMIT),
    [combinedAgents],
  );

  const allVisibleAgents = useMemo(
    () => [...liveAgents, ...recentlyFinished],
    [liveAgents, recentlyFinished],
  );

  const selectedAgent = selectedIdx >= 0 ? (allVisibleAgents[selectedIdx] ?? null) : null;
  const mainSelectedAgent = mainFocus === 'agents' ? selectedAgent : null;
  const hasLiveAgents = liveAgents.length > 0;

  const liveAgentNameCounts = useMemo(
    () =>
      liveAgents.reduce((counts, agent) => {
        const label = agent._display || agent.toolName || agent.tool || 'agent';
        counts.set(label, (counts.get(label) || 0) + 1);
        return counts;
      }, new Map<string, number>()),
    [liveAgents],
  );

  const maxViewportItems = Math.max(MIN_VIEWPORT_ROWS, viewportRows - VIEWPORT_CHROME_ROWS);
  const visibleSessionRows = useMemo(
    () => getVisibleWindow(allVisibleAgents, selectedIdx, maxViewportItems),
    [allVisibleAgents, selectedIdx, maxViewportItems],
  );

  // Clamp selection indices when agent list shrinks
  useEffect(() => {
    dispatch(clampSelection(allVisibleAgents.length));
  }, [allVisibleAgents.length, dispatch]);

  // ── Memory-derived data ───────────────────────────

  const { memories, filteredMemories, visibleMemories } = dashboardView;
  const hasMemories = memories.length > 0;

  const visibleKnowledgeRows = useMemo(
    () => getVisibleWindow(visibleMemories, memory.memorySelectedIdx, maxViewportItems),
    [visibleMemories, memory.memorySelectedIdx, maxViewportItems],
  );

  // Clamp memory selection when list shrinks
  useEffect(() => {
    if (memory.memorySelectedIdx >= visibleMemories.length) {
      memory.setMemorySelectedIdx(visibleMemories.length > 0 ? visibleMemories.length - 1 : -1);
    }
  }, [memory.memorySelectedIdx, visibleMemories.length, memory]);

  return useMemo(
    () => ({
      // Agent-derived
      combinedAgents,
      liveAgents,
      allVisibleAgents,
      selectedAgent,
      mainSelectedAgent,
      hasLiveAgents,
      liveAgentNameCounts,
      visibleSessionRows,
      conflicts: dashboardView.conflicts,
      getToolName: dashboardView.getToolName,
      // Memory-derived
      memories,
      filteredMemories,
      visibleMemories,
      visibleKnowledgeRows,
      hasMemories,
    }),
    [
      combinedAgents,
      liveAgents,
      allVisibleAgents,
      selectedAgent,
      mainSelectedAgent,
      hasLiveAgents,
      liveAgentNameCounts,
      visibleSessionRows,
      dashboardView.conflicts,
      dashboardView.getToolName,
      memories,
      filteredMemories,
      visibleMemories,
      visibleKnowledgeRows,
      hasMemories,
    ],
  );
}
