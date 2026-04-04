import React, {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useReducer,
  useRef,
  useCallback,
  useState,
} from 'react';
import type { Dispatch, ReactNode } from 'react';
import { basename } from 'path';
import { buildCombinedAgentRows, buildDashboardView } from './view.js';
import type { CombinedAgentRow, MemoryEntry, TeamContext } from './view.js';
import { isAgentAddressable } from './agent-display.js';
import { getVisibleWindow } from './utils.js';
import { dashboardReducer, createInitialState, clampSelection } from './reducer.js';
import type { DashboardState, DashboardAction, DashboardNotice, NoticeTone } from './reducer.js';
import type { UseAgentLifecycleReturn } from './agents.js';
import type { UseMemoryManagerReturn } from './memory.js';
import type { UseComposerReturn, ComposeMode } from './composer.js';
import type { UseIntegrationDoctorReturn } from './integrations.js';
import type { UseDashboardConnectionReturn } from './connection.jsx';
import type { HostIntegration } from '@chinwag/shared/integration-model.js';

// ── Constants ───────────────────────────────────────
const RECENTLY_FINISHED_LIMIT = 3;
const MIN_VIEWPORT_ROWS = 4;
const VIEWPORT_CHROME_ROWS = 11;
const COMMAND_SUGGESTION_LIMIT = 5;

// ── Context value types ────────────────────────────

interface ViewContextValue {
  state: DashboardState;
  dispatch: Dispatch<DashboardAction>;
  notice: DashboardNotice | null;
  flash: (msg: string, opts?: { tone?: NoticeTone; autoClearMs?: number }) => void;
}

interface AgentContextValue extends UseAgentLifecycleReturn {
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
}

interface MemoryContextValue extends UseMemoryManagerReturn {
  memories: MemoryEntry[];
  filteredMemories: MemoryEntry[];
  visibleMemories: MemoryEntry[];
  visibleKnowledgeRows: { items: MemoryEntry[]; start: number };
  hasMemories: boolean;
}

interface CommandPaletteContextValue {
  commandSuggestions: CommandSuggestion[];
}

interface CommandSuggestion {
  name: string;
  description: string;
}

// ── Contexts ────────────────────────────────────────

const ViewContext = createContext<ViewContextValue | null>(null);
const ConnectionContext = createContext<UseDashboardConnectionReturn | null>(null);
const AgentContext = createContext<AgentContextValue | null>(null);
const MemoryContext = createContext<MemoryContextValue | null>(null);
const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

// ── Hooks ───────────────────────────────────────────

export function useView(): ViewContextValue {
  const ctx = useContext(ViewContext);
  if (!ctx) throw new Error('useView must be used within ViewProvider');
  return ctx;
}

export function useConnection(): UseDashboardConnectionReturn {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnection must be used within ConnectionProvider');
  return ctx;
}

export function useAgents(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgents must be used within AgentProvider');
  return ctx;
}

export function useMemory(): MemoryContextValue {
  const ctx = useContext(MemoryContext);
  if (!ctx) throw new Error('useMemory must be used within MemoryProvider');
  return ctx;
}

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error('useCommandPalette must be used within CommandPaletteProvider');
  return ctx;
}

// ── Providers ───────────────────────────────────────

interface ViewProviderProps {
  children: ReactNode;
}

/**
 * View state: owns the dashboard reducer (view, selectedIdx, mainFocus,
 * focusedAgent, showDiagnostics, heroInput) plus the flash notification.
 * Every component that previously received these as props can now
 * `useView()` instead.
 */
export function ViewProvider({ children }: ViewProviderProps): React.ReactNode {
  const [state, dispatch] = useReducer(dashboardReducer, undefined, createInitialState);

  // ── Flash notification ───────────────────────────
  const [notice, setNotice] = useState<DashboardNotice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback(function flash(
    msg: string,
    opts: { tone?: NoticeTone; autoClearMs?: number } = {},
  ) {
    const tone: NoticeTone = typeof opts === 'object' ? opts.tone || 'info' : 'info';
    const autoClearMs = typeof opts === 'object' ? opts.autoClearMs : null;
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    }
    setNotice({ text: msg, tone });
    if (autoClearMs && autoClearMs > 0) {
      noticeTimer.current = setTimeout(() => {
        setNotice((current) => (current?.text === msg ? null : current));
        noticeTimer.current = null;
      }, autoClearMs);
    }
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const value = useMemo(() => ({ state, dispatch, notice, flash }), [state, notice, flash]);

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

interface ConnectionProviderProps {
  connection: UseDashboardConnectionReturn;
  children: ReactNode;
}

/**
 * Connection state: teamId, teamName, projectRoot, connState, etc.
 * Thin wrapper — the useDashboardConnection hook does the real work.
 */
export function ConnectionProvider({
  connection,
  children,
}: ConnectionProviderProps): React.ReactNode {
  return <ConnectionContext.Provider value={connection}>{children}</ConnectionContext.Provider>;
}

interface AgentProviderProps {
  agents: UseAgentLifecycleReturn;
  context: TeamContext | null;
  detectedTools: HostIntegration[];
  teamName: string | null;
  cols: number;
  viewportRows: number;
  children: ReactNode;
}

/**
 * Agent context: raw agents hook + derived agent data.
 * Owns: combinedAgents, liveAgents, allVisibleAgents, selection clamping,
 * visibleSessionRows, liveAgentNameCounts, conflicts.
 *
 * Reads selectedIdx/mainFocus from ViewProvider (useView) instead of
 * receiving them as props — eliminates the prop-drilling anti-pattern.
 */
export function AgentProvider({
  agents,
  context,
  detectedTools,
  teamName,
  cols,
  viewportRows,
  children,
}: AgentProviderProps): React.ReactNode {
  const { state, dispatch } = useView();
  const { selectedIdx, mainFocus } = state;

  // Build dashboard view data (tool name resolver, visible agents, conflicts)
  const dashboardView = useMemo(
    () =>
      buildDashboardView({
        context: context ?? undefined,
        detectedTools,
        memoryFilter: null,
        memorySearch: '',
        cols,
        projectDir: teamName || basename(process.cwd()),
      }),
    [context, detectedTools, cols, teamName],
  );

  // Build combined agent rows from managed + connected
  const combinedAgents = useMemo(
    () =>
      buildCombinedAgentRows({
        managedAgents: agents.managedAgents as unknown as import('./view.js').ManagedAgent[],
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

  const selectedAgent = selectedIdx >= 0 ? allVisibleAgents[selectedIdx] : null;
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

  const value = useMemo(
    () => ({
      // Raw agents hook (lifecycle actions, tool state, etc.)
      ...agents,
      // Derived data
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
    }),
    [
      agents,
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
    ],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

interface MemoryProviderProps {
  memory: UseMemoryManagerReturn;
  context: TeamContext | null;
  detectedTools: HostIntegration[];
  teamName: string | null;
  cols: number;
  composeMode: ComposeMode;
  viewportRows: number;
  children: ReactNode;
}

/**
 * Memory context: raw memory hook + derived memory data.
 * Owns: memories, filteredMemories, visibleMemories, visibleKnowledgeRows,
 * hasMemories, selection clamping.
 */
export function MemoryProvider({
  memory,
  context,
  detectedTools,
  teamName,
  cols,
  composeMode,
  viewportRows,
  children,
}: MemoryProviderProps): React.ReactNode {
  const memorySearch = composeMode === 'memory-search' ? memory.memorySearch : '';

  // Build dashboard view data scoped to memory filtering
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

  const { memories, filteredMemories, visibleMemories } = dashboardView;
  const hasMemories = memories.length > 0;

  const maxViewportItems = Math.max(MIN_VIEWPORT_ROWS, viewportRows - VIEWPORT_CHROME_ROWS);
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

  const value = useMemo(
    () => ({
      // Raw memory hook
      ...memory,
      // Derived data
      memories,
      filteredMemories,
      visibleMemories,
      visibleKnowledgeRows,
      hasMemories,
    }),
    [memory, memories, filteredMemories, visibleMemories, visibleKnowledgeRows, hasMemories],
  );

  return <MemoryContext.Provider value={value}>{children}</MemoryContext.Provider>;
}

interface CommandPaletteProviderProps {
  composer: UseComposerReturn;
  agents: UseAgentLifecycleReturn;
  integrations: UseIntegrationDoctorReturn;
  hasMemories: boolean;
  hasLiveAgents: boolean;
  selectedAgent: CombinedAgentRow | null;
  children: ReactNode;
}

/**
 * Command palette context: command suggestions derived from agent/memory/integration state.
 * Owns: commandEntries, commandSuggestions filtering.
 */
export function CommandPaletteProvider({
  composer,
  agents,
  integrations,
  hasMemories,
  hasLiveAgents,
  selectedAgent,
  children,
}: CommandPaletteProviderProps): React.ReactNode {
  // Command palette entries
  const commandEntries = useMemo(
    () => [
      { name: '/new', description: 'Open a tool in a new terminal tab' },
      ...(agents.unavailableCliAgents.some(
        (tool) => agents.getManagedToolState(tool.id).recoveryCommand,
      ) || integrations.integrationIssues.length > 0
        ? [{ name: '/fix', description: 'Open the main setup fix flow' }]
        : []),
      { name: '/recheck', description: 'Refresh available tools and integration health' },
      { name: '/doctor', description: 'Scan local Chinwag integration health' },
      ...(integrations.integrationIssues.length > 0
        ? [{ name: '/repair', description: 'Repair detected integration issues' }]
        : []),
      ...(hasMemories ? [{ name: '/knowledge', description: 'View shared knowledge' }] : []),
      ...(hasLiveAgents ? [{ name: '/history', description: 'View past agent activity' }] : []),
      { name: '/web', description: 'Open chinwag in browser' },
      ...(selectedAgent && isAgentAddressable(selectedAgent)
        ? [{ name: '/message', description: `Message ${selectedAgent._display}` }]
        : []),
      { name: '/help', description: 'Show command help' },
    ],
    [agents, integrations, hasMemories, hasLiveAgents, selectedAgent],
  );

  const commandQuery =
    composer.composeMode === 'command'
      ? composer.composeText.trim().replace(/^\//, '').toLowerCase()
      : '';

  const commandSuggestions = useMemo(() => {
    if (composer.composeMode !== 'command') return [];
    return commandEntries
      .filter((entry) => {
        if (!commandQuery) return true;
        const normalized = entry.name.slice(1).toLowerCase();
        return (
          normalized.startsWith(commandQuery) ||
          entry.description.toLowerCase().includes(commandQuery)
        );
      })
      .slice(0, COMMAND_SUGGESTION_LIMIT + 1);
  }, [composer.composeMode, commandEntries, commandQuery]);

  const value = useMemo(() => ({ commandSuggestions }), [commandSuggestions]);

  return <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>;
}
