import React, { Component, useEffect } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useDashboardConnection } from './connection.jsx';
import { useMemoryManager } from './memory.js';
import { useAgentLifecycle } from './agents.js';
import { useComposer as useComposerHook } from './composer.js';
import { useIntegrationDoctor } from './integrations.js';
import {
  useCollectorSubscription,
  useOrphanCollectorSweep,
} from './hooks/useCollectorSubscription.js';
import { MainPane } from './main-pane.jsx';
import { MemoryView } from './memory-view.jsx';
import { SessionsView } from './sessions-view.jsx';
import { AgentFocusView } from './agent-focus.jsx';
import { formatProjectPath } from './utils.js';
import { useDashboardHandlers } from './useDashboardHandlers.js';
import { useDashboardHints } from './useDashboardHints.js';
import { DashboardGuards } from './DashboardGuards.jsx';
import { ViewProvider, useView, useCommandSuggestions } from './context.jsx';
import { useDashboardData } from './hooks/useDashboardData.js';
import type { DashboardDerivedData } from './hooks/useDashboardData.js';
import type { UseAgentLifecycleReturn } from './agents.js';
import type { UseMemoryManagerReturn } from './memory.js';
import type { UseComposerReturn } from './composer.js';
import type { UseIntegrationDoctorReturn } from './integrations.js';
import type { UseDashboardConnectionReturn } from './connection.jsx';
import type { ChinmeisterConfig } from '../config.js';

interface FooterHint {
  key: string;
  label: string;
  color?: string;
}

interface DashboardLayout {
  viewportRows?: number;
}

// ── Main Dashboard component ────────────────────────

interface DashboardProps {
  config: ChinmeisterConfig | null;
  navigate: (to: string) => void;
  layout?: DashboardLayout;
  setFooterHints?: ((hints: FooterHint[]) => void) | null;
}

export function Dashboard({
  config,
  navigate,
  layout,
  setFooterHints,
}: DashboardProps): React.ReactNode {
  const { stdout } = useStdout();
  const viewportRows = layout?.viewportRows || 18;

  // ViewProvider owns the reducer (view, selectedIdx, mainFocus, etc.)
  // and the flash notification — no more prop drilling.
  return (
    <ViewProvider>
      <DashboardProviders
        config={config}
        navigate={navigate}
        viewportRows={viewportRows}
        setFooterHints={setFooterHints || null}
        stdout={stdout}
      />
    </ViewProvider>
  );
}

// ── Dashboard error boundary (defense-in-depth) ───
// The outer ErrorBoundary in cli.tsx catches everything, but this one
// gives dashboard-specific context and offers a restart hint.

interface DashboardErrorBoundaryState {
  error: Error | null;
}

class DashboardErrorBoundary extends Component<
  { children: ReactNode },
  DashboardErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): DashboardErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    process.stderr.write(`[chinmeister] Dashboard crash: ${error.message}\n`);
    if (error.stack) {
      process.stderr.write(`[chinmeister] ${error.stack}\n`);
    }
    if (errorInfo.componentStack) {
      process.stderr.write(`[chinmeister] Component stack:${errorInfo.componentStack}\n`);
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="red">Dashboard crashed: {this.state.error.message}</Text>
          <Text dimColor>Press Ctrl+C to exit, then restart chinmeister.</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}

interface DashboardProvidersProps {
  config: ChinmeisterConfig | null;
  navigate: (to: string) => void;
  viewportRows: number;
  setFooterHints: ((hints: FooterHint[]) => void) | null;
  stdout: NodeJS.WriteStream | null;
}

/**
 * Sets up connection + domain hooks, wires them into the provider tree.
 * Must be a child of ViewProvider so hooks can call useView().
 *
 * Provider tree:
 *   ViewProvider → ConnectionProvider → AgentProvider → ComposerProvider
 *     → MemoryProvider → IntegrationProvider → DataProvider → DashboardView
 */
function DashboardProviders({
  config,
  navigate,
  viewportRows,
  setFooterHints,
  stdout,
}: DashboardProvidersProps): React.ReactNode {
  const { state, dispatch, notice, flash } = useView();

  // ── Connection + project state ─────────────────────
  const connection = useDashboardConnection({ config, stdout });
  const { teamId, projectRoot } = connection;

  // ── Custom hooks ───────────────────────────────────
  const memoryHook = useMemoryManager({
    config,
    teamId,
    bumpRefreshKey: connection.bumpRefreshKey,
    flash,
  });
  const agentsHook = useAgentLifecycle({
    config,
    teamId,
    projectRoot: projectRoot || '',
    stdout,
    flash,
  });
  useCollectorSubscription({ config, teamId });
  // Drains `<agentId>.completed.json` records left behind by externally
  // launched agents (user ran claude-code directly, not through chinmeister).
  // Runs once per dashboard mount — subsequent external sessions fill the
  // queue again and get swept next time.
  useOrphanCollectorSweep({ config, teamId });
  const integrations = useIntegrationDoctor({ projectRoot, flash });
  const composer = useComposerHook({
    config,
    teamId,
    bumpRefreshKey: connection.bumpRefreshKey,
    flash,
    clearMemorySearch: memoryHook.clearMemorySearch,
    clearMemoryInput: memoryHook.clearMemoryInput,
  });

  // ── Derived data (replaces the former DataProvider context) ─────────
  const data = useDashboardData({
    viewportRows,
    state,
    dispatch,
    connection,
    agents: agentsHook,
    memory: memoryHook,
    composer,
  });

  return (
    <DashboardErrorBoundary>
      <DashboardViewComponent
        config={config}
        navigate={navigate}
        setFooterHints={setFooterHints}
        connection={connection}
        agents={agentsHook}
        composer={composer}
        memory={memoryHook}
        integrations={integrations}
        data={data}
        notice={notice}
      />
    </DashboardErrorBoundary>
  );
}

interface DashboardViewProps {
  config: ChinmeisterConfig | null;
  navigate: (to: string) => void;
  setFooterHints: ((hints: FooterHint[]) => void) | null;
  connection: UseDashboardConnectionReturn;
  agents: UseAgentLifecycleReturn;
  composer: UseComposerReturn;
  memory: UseMemoryManagerReturn;
  integrations: UseIntegrationDoctorReturn;
  data: DashboardDerivedData;
  notice: ReturnType<typeof useView>['notice'];
}

/**
 * Handles input, rendering, and all view-level logic. Takes hook returns
 * as props — only view-state is still read from a context, since that is
 * the one piece of state genuinely shared with outer components.
 */
function DashboardViewComponent({
  config,
  navigate,
  setFooterHints,
  connection,
  agents: agentsHook,
  composer,
  memory: memoryHook,
  integrations,
  data,
  notice,
}: DashboardViewProps): React.ReactNode {
  const {
    context,
    error,
    connState,
    connDetail,
    spinnerFrame,
    cols,
    projectRoot,
    retry: connectionRetry,
  } = connection;

  // ── View state from ViewProvider ───────────────────
  const { state, dispatch, flash } = useView();
  const { view, focusedAgent, showDiagnostics } = state;
  const isSessionsView = view === 'sessions';
  const isMemoryView = view === 'memory';
  const isAgentFocusView = view === 'agent-focus';

  // ── Derived data ───────────────────────────────────
  const {
    combinedAgents,
    liveAgents,
    allVisibleAgents,
    selectedAgent,
    mainSelectedAgent,
    hasLiveAgents,
    liveAgentNameCounts,
    visibleSessionRows,
    conflicts,
    memories,
    filteredMemories,
    visibleMemories,
    visibleKnowledgeRows,
    hasMemories,
  } = data;

  const commandSuggestions = useCommandSuggestions({
    composer,
    agents: agentsHook,
    integrations,
    hasMemories,
    hasLiveAgents,
    selectedAgent,
  });

  const projectDisplayName = formatProjectPath(projectRoot);

  // ── Footer hints (pushed to shell) ─────────────────
  useEffect(() => {
    if (!setFooterHints) return;
    if (composer.isComposing) {
      setFooterHints([
        { key: 'esc', label: 'back' },
        { key: 'q', label: 'quit', color: 'gray' },
      ]);
    } else {
      const ready = agentsHook.readyCliAgents;
      const primary = ready[0] || agentsHook.installedCliAgents[0];
      const nLabel = primary
        ? ready.length > 1
          ? 'new agent'
          : `new ${primary.name}`
        : 'new agent';
      setFooterHints([
        { key: 'n', label: nLabel, color: 'green' },
        { key: 'w', label: 'web' },
        { key: '/', label: 'more' },
        { key: 'q', label: 'quit', color: 'gray' },
      ]);
    }
  }, [
    composer.isComposing,
    agentsHook.installedCliAgents,
    agentsHook.managedToolStates,
    agentsHook.readyCliAgents,
    setFooterHints,
  ]);

  // ── Handlers (extracted hook) ──────────────────────
  const { onComposeSubmit, onMemorySubmit } = useDashboardHandlers({
    config,
    state,
    dispatch,
    flash,
    cols,
    error,
    context,
    connectionRetry,
    allVisibleAgents,
    liveAgents,
    visibleMemories,
    hasLiveAgents,
    hasMemories,
    selectedAgent,
    mainSelectedAgent,
    liveAgentNameCounts,
    agentsHook,
    integrations,
    composer,
    memoryHook,
    commandSuggestions,
    navigate,
  });

  // ── Hints (extracted hook) ─────────────────────────
  const { navItems, contextHints } = useDashboardHints({
    isAgentFocusView,
    focusedAgent,
    showDiagnostics,
    composer,
    mainSelectedAgent,
  });

  // ── Guards ─────────────────────────────────────────
  const guard = DashboardGuards({ cols, error, context, connState, connDetail, spinnerFrame });
  if (guard !== null) return guard;

  // ── Agent focus view ───────────────────────────────
  if (isAgentFocusView && focusedAgent) {
    return (
      <AgentFocusView
        focusedAgent={focusedAgent}
        combinedAgents={combinedAgents}
        conflicts={conflicts}
        notice={notice}
        showDiagnostics={showDiagnostics}
        liveAgentNameCounts={liveAgentNameCounts}
        navHints={navItems.map((item) => ({
          commandKey: item.key,
          label: item.label,
          color: item.color || 'cyan',
        }))}
      />
    );
  }

  // ── Memory view ────────────────────────────────────
  if (isMemoryView) {
    return (
      <MemoryView
        memories={memories}
        filteredMemories={filteredMemories}
        visibleKnowledgeRows={visibleKnowledgeRows}
        memory={memoryHook}
        composer={composer}
        state={state}
        commandSuggestions={commandSuggestions}
        onComposeSubmit={onComposeSubmit}
        onMemorySubmit={onMemorySubmit}
      />
    );
  }

  // ── Sessions view ──────────────────────────────────
  if (isSessionsView) {
    return (
      <SessionsView
        liveAgents={liveAgents}
        visibleSessionRows={visibleSessionRows}
        state={state}
        cols={cols}
        composer={composer}
        memory={memoryHook}
        commandSuggestions={commandSuggestions}
        onComposeSubmit={onComposeSubmit}
        onMemorySubmit={onMemorySubmit}
      />
    );
  }

  // ── Home view ──────────────────────────────────────
  return (
    <MainPane
      state={state}
      connection={{ connState, connDetail, spinnerFrame, cols, projectDisplayName }}
      allVisibleAgents={allVisibleAgents}
      liveAgents={liveAgents}
      visibleSessionRows={visibleSessionRows}
      liveAgentNameCounts={liveAgentNameCounts}
      agents={agentsHook}
      integrationIssues={integrations.integrationIssues}
      composer={composer}
      memory={memoryHook}
      contextHints={contextHints}
      commandSuggestions={commandSuggestions}
      onComposeSubmit={onComposeSubmit}
      onMemorySubmit={onMemorySubmit}
    />
  );
}
