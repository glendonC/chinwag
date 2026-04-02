import React, {
  createContext,
  useContext,
  useReducer,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import { useStdout } from 'ink';
import { basename } from 'path';
import { useDashboardConnection } from './connection.jsx';
import { useMemoryManager } from './memory.js';
import { useAgentLifecycle } from './agents.js';
import { useComposer } from './composer.js';
import { useIntegrationDoctor } from './integrations.js';
import { dashboardReducer, createInitialState, setNotice, clearNotice } from './reducer.js';
import { buildCombinedAgentRows, buildDashboardView } from './view.js';
import { openWebDashboard, getVisibleWindow, formatProjectPath } from './utils.js';

// ── Constants ───────────────────────────────────────
const RECENTLY_FINISHED_LIMIT = 3;
const MIN_VIEWPORT_ROWS = 4;
const VIEWPORT_CHROME_ROWS = 11;

// ── Context ─────────────────────────────────────────

const DashboardContext = createContext(null);

/**
 * Access the dashboard context.
 * Must be called within a DashboardProvider.
 */
export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}

// ── Flash notification hook (uses reducer) ──────────

function useFlashNotification(dispatch) {
  const noticeTimer = useRef(null);

  const flash = useCallback(
    function flash(msg, opts = {}) {
      const tone = typeof opts === 'object' ? opts.tone || 'info' : 'info';
      const autoClearMs = typeof opts === 'object' ? opts.autoClearMs : null;
      if (noticeTimer.current) {
        clearTimeout(noticeTimer.current);
        noticeTimer.current = null;
      }
      dispatch(setNotice(msg, tone));
      if (autoClearMs && autoClearMs > 0) {
        noticeTimer.current = setTimeout(() => {
          dispatch(clearNotice(msg));
          noticeTimer.current = null;
        }, autoClearMs);
      }
    },
    [dispatch],
  );

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  return flash;
}

// ── Provider Component ──────────────────────────────

export function DashboardProvider({ config, navigate, layout, setFooterHints, children }) {
  const { stdout } = useStdout();
  const viewportRows = layout?.viewportRows || 18;

  // ── Reducer ────────────────────────────────────────
  const [state, dispatch] = useReducer(dashboardReducer, null, createInitialState);

  // ── Flash notification ─────────────────────────────
  const flash = useFlashNotification(dispatch);

  // ── Connection + project state ─────────────────────
  const connection = useDashboardConnection({ config, stdout });
  const {
    teamId,
    teamName,
    projectRoot,
    detectedTools,
    context,
    error,
    connState,
    connDetail,
    spinnerFrame,
    cols,
    retry: connectionRetry,
    bumpRefreshKey,
  } = connection;

  // ── Custom hooks ───────────────────────────────────
  const memory = useMemoryManager({ config, teamId, bumpRefreshKey, flash });
  const agents = useAgentLifecycle({ config, teamId, projectRoot, stdout, flash });
  const integrations = useIntegrationDoctor({ projectRoot, flash });
  const composer = useComposer({
    config,
    teamId,
    bumpRefreshKey,
    flash,
    clearMemorySearch: memory.clearMemorySearch,
    clearMemoryInput: memory.clearMemoryInput,
  });

  // ── Derived data ───────────────────────────────────
  const { getToolName, conflicts, memories, filteredMemories, visibleMemories, visibleAgents } =
    buildDashboardView({
      context,
      detectedTools,
      memoryFilter: null,
      memorySearch: composer.composeMode === 'memory-search' ? memory.memorySearch : '',
      cols,
      projectDir: teamName || basename(process.cwd()),
    });

  const combinedAgents = buildCombinedAgentRows({
    managedAgents: agents.managedAgents,
    connectedAgents: visibleAgents,
    getToolName,
  });
  const liveAgents = combinedAgents.filter((agent) => !agent._dead);
  const recentlyFinished = combinedAgents
    .filter((agent) => agent._managed && agent._dead)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, RECENTLY_FINISHED_LIMIT);
  const allVisibleAgents = [...liveAgents, ...recentlyFinished];
  const selectedAgent = state.selectedIdx >= 0 ? allVisibleAgents[state.selectedIdx] : null;
  const mainSelectedAgent = state.mainFocus === 'agents' ? selectedAgent : null;
  const knowledgeVisible =
    state.view === 'memory' ||
    composer.composeMode === 'memory-search' ||
    composer.composeMode === 'memory-add'
      ? visibleMemories
      : visibleMemories.slice(0, Math.min(1, visibleMemories.length));

  const hasLiveAgents = liveAgents.length > 0;
  const hasMemories = memories.length > 0;
  const projectDisplayName = formatProjectPath(projectRoot);
  const liveAgentNameCounts = liveAgents.reduce((counts, agent) => {
    const label = agent._display || agent.toolName || agent.tool || 'agent';
    counts.set(label, (counts.get(label) || 0) + 1);
    return counts;
  }, new Map());
  const visibleSessionRows = getVisibleWindow(
    allVisibleAgents,
    state.selectedIdx,
    Math.max(MIN_VIEWPORT_ROWS, viewportRows - VIEWPORT_CHROME_ROWS),
  );
  const visibleKnowledgeRows = getVisibleWindow(
    knowledgeVisible,
    memory.memorySelectedIdx,
    Math.max(MIN_VIEWPORT_ROWS, viewportRows - VIEWPORT_CHROME_ROWS),
  );

  // ── Handlers ───────────────────────────────────────
  const handleOpenWebDashboard = useCallback(() => {
    const result = openWebDashboard(config?.token);
    flash(
      result.ok
        ? 'Opened web dashboard'
        : `Could not open browser${result.error ? `: ${result.error}` : ''}`,
      result.ok ? { tone: 'success' } : { tone: 'error' },
    );
  }, [config?.token, flash]);

  // ── Context value ──────────────────────────────────
  const value = {
    state,
    dispatch,
    flash,
    config,
    navigate,
    layout,
    viewportRows,
    connection,
    teamId,
    teamName,
    projectRoot,
    detectedTools,
    context,
    error,
    connState,
    connDetail,
    spinnerFrame,
    cols,
    connectionRetry,
    bumpRefreshKey,
    memory,
    agents,
    integrations,
    composer,
    getToolName,
    conflicts,
    memories,
    filteredMemories,
    visibleMemories,
    visibleAgents,
    combinedAgents,
    liveAgents,
    recentlyFinished,
    allVisibleAgents,
    selectedAgent,
    mainSelectedAgent,
    knowledgeVisible,
    hasLiveAgents,
    hasMemories,
    projectDisplayName,
    liveAgentNameCounts,
    visibleSessionRows,
    visibleKnowledgeRows,
    handleOpenWebDashboard,
    setFooterHints,
  };

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}
