import React, { useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { HintRow } from './ui.jsx';
import { useDashboardConnection } from './connection.jsx';
import type { UseDashboardConnectionReturn } from './connection.jsx';
import { useMemoryManager } from './memory.js';
import type { UseMemoryManagerReturn } from './memory.js';
import { useAgentLifecycle } from './agents.js';
import type { UseAgentLifecycleReturn } from './agents.js';
import { useComposer } from './composer.js';
import type { UseComposerReturn } from './composer.js';
import { useIntegrationDoctor } from './integrations.js';
import type { UseIntegrationDoctorReturn } from './integrations.js';
import { createInputHandler, createCommandHandler } from './input.js';
import { MainPane, MemoryView, SessionsView } from './main-pane.jsx';
import { AgentFocusView } from './agent-focus.jsx';
import { MIN_WIDTH, SPINNER, openWebDashboard, formatProjectPath } from './utils.js';
import { isAgentAddressable } from './agent-display.js';
import {
  ViewProvider,
  ConnectionProvider,
  AgentProvider,
  MemoryProvider,
  CommandPaletteProvider,
  useView,
  useAgents,
  useMemory,
  useCommandPalette,
} from './context.jsx';
import type { ChinwagConfig } from '../config.js';

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
  config: ChinwagConfig | null;
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

interface DashboardProvidersProps {
  config: ChinwagConfig | null;
  navigate: (to: string) => void;
  viewportRows: number;
  setFooterHints: ((hints: FooterHint[]) => void) | null;
  stdout: NodeJS.WriteStream | null;
}

/**
 * Sets up connection + domain hooks, wires them into the provider tree.
 * Must be a child of ViewProvider so hooks can call useView().
 */
function DashboardProviders({
  config,
  navigate,
  viewportRows,
  setFooterHints,
  stdout,
}: DashboardProvidersProps): React.ReactNode {
  const { flash } = useView();

  // ── Connection + project state ─────────────────────
  const connection = useDashboardConnection({ config, stdout });
  const { teamId, teamName, projectRoot, detectedTools, context, cols } = connection;

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
  const integrations = useIntegrationDoctor({ projectRoot, flash });
  const composer = useComposer({
    config,
    teamId,
    bumpRefreshKey: connection.bumpRefreshKey,
    flash,
    clearMemorySearch: memoryHook.clearMemorySearch,
    clearMemoryInput: memoryHook.clearMemoryInput,
  });

  // ── Compose the providers, then render the inner component ──
  return (
    <ConnectionProvider connection={connection}>
      <AgentProvider
        agents={agentsHook}
        context={context}
        detectedTools={detectedTools}
        teamName={teamName}
        cols={cols}
        viewportRows={viewportRows}
      >
        <MemoryProvider
          memory={memoryHook}
          context={context}
          detectedTools={detectedTools}
          teamName={teamName}
          cols={cols}
          composeMode={composer.composeMode}
          viewportRows={viewportRows}
        >
          <DashboardInner
            config={config}
            navigate={navigate}
            viewportRows={viewportRows}
            setFooterHints={setFooterHints}
            connection={connection}
            memoryHook={memoryHook}
            agentsHook={agentsHook}
            integrations={integrations}
            composer={composer}
          />
        </MemoryProvider>
      </AgentProvider>
    </ConnectionProvider>
  );
}

interface DashboardInnerProps {
  config: ChinwagConfig | null;
  navigate: (to: string) => void;
  viewportRows: number;
  setFooterHints: ((hints: FooterHint[]) => void) | null;
  connection: UseDashboardConnectionReturn;
  memoryHook: UseMemoryManagerReturn;
  agentsHook: UseAgentLifecycleReturn;
  integrations: UseIntegrationDoctorReturn;
  composer: UseComposerReturn;
}

/**
 * Bridge component: reads Agent/Memory contexts to get derived data needed
 * by CommandPaletteProvider, then wraps the main view in that provider.
 */
function DashboardInner({
  config,
  navigate,
  viewportRows,
  setFooterHints,
  connection,
  memoryHook,
  agentsHook,
  integrations,
  composer,
}: DashboardInnerProps): React.ReactNode {
  const { selectedAgent, hasLiveAgents } = useAgents();
  const { hasMemories } = useMemory();

  return (
    <CommandPaletteProvider
      composer={composer}
      agents={agentsHook}
      integrations={integrations}
      hasMemories={hasMemories}
      hasLiveAgents={hasLiveAgents}
      selectedAgent={selectedAgent}
    >
      <DashboardViewComponent
        config={config}
        navigate={navigate}
        viewportRows={viewportRows}
        setFooterHints={setFooterHints}
        connection={connection}
        memoryHook={memoryHook}
        agentsHook={agentsHook}
        integrations={integrations}
        composer={composer}
      />
    </CommandPaletteProvider>
  );
}

interface DashboardViewProps {
  config: ChinwagConfig | null;
  navigate: (to: string) => void;
  viewportRows: number;
  setFooterHints: ((hints: FooterHint[]) => void) | null;
  connection: UseDashboardConnectionReturn;
  memoryHook: UseMemoryManagerReturn;
  agentsHook: UseAgentLifecycleReturn;
  integrations: UseIntegrationDoctorReturn;
  composer: UseComposerReturn;
}

/**
 * Handles input, rendering, and all view-level logic.
 * Consumes all 5 domain contexts for derived data.
 */
function DashboardViewComponent({
  config,
  navigate,
  viewportRows: _viewportRows,
  setFooterHints,
  connection,
  memoryHook,
  agentsHook,
  integrations,
  composer,
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
  const { state, dispatch, notice, flash } = useView();
  const { view, focusedAgent, showDiagnostics } = state;
  const isSessionsView = view === 'sessions';
  const isMemoryView = view === 'memory';
  const isAgentFocusView = view === 'agent-focus';

  // ── Context-derived data ───────────────────────────
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
  } = useAgents();

  const { memories, filteredMemories, visibleMemories, visibleKnowledgeRows, hasMemories } =
    useMemory();

  const { commandSuggestions } = useCommandPalette();

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

  // Factory function patterns — React Compiler can't infer closure deps
  // from createCommandHandler/createInputHandler factories.
  const handleCommandSubmit = useMemo(
    () =>
      createCommandHandler({
        agents: agentsHook,
        integrations,
        composer,
        memory: memoryHook,
        flash,
        dispatch,
        handleOpenWebDashboard,
        liveAgents,
        selectedAgent,
        isAgentAddressable,
      }),
    [
      agentsHook,
      integrations,
      composer,
      memoryHook,
      flash,
      dispatch,
      handleOpenWebDashboard,
      liveAgents,
      selectedAgent,
    ],
  );

  const inputHandler = useMemo(
    () =>
      createInputHandler({
        state,
        dispatch,
        cols,
        error,
        context,
        connectionRetry,
        allVisibleAgents,
        liveAgents,
        visibleMemories,
        hasLiveAgents,
        hasMemories,
        mainSelectedAgent,
        liveAgentNameCounts,
        agents: agentsHook,
        integrations,
        composer,
        memory: memoryHook,
        commandSuggestions,
        handleCommandSubmit,
        handleOpenWebDashboard,
        navigate,
      }),
    [
      state,
      dispatch,
      cols,
      error,
      context,
      connectionRetry,
      allVisibleAgents,
      liveAgents,
      visibleMemories,
      hasLiveAgents,
      hasMemories,
      mainSelectedAgent,
      liveAgentNameCounts,
      agentsHook,
      integrations,
      composer,
      memoryHook,
      commandSuggestions,
      handleCommandSubmit,
      handleOpenWebDashboard,
      navigate,
    ],
  );

  const onComposeSubmit = useCallback(() => {
    composer.onComposeSubmit(commandSuggestions, handleCommandSubmit);
  }, [composer, commandSuggestions, handleCommandSubmit]);

  const onMemorySubmit = useCallback(() => {
    memoryHook.onMemorySubmit();
    composer.setComposeMode(null);
  }, [memoryHook, composer]);

  useInput(inputHandler);

  // ── Nav hints ──────────────────────────────────────
  const navItems = useMemo(() => {
    if (isAgentFocusView) {
      const items: FooterHint[] = [{ key: 'esc', label: 'back', color: 'cyan' }];
      if (focusedAgent?._managed && !focusedAgent._dead)
        items.push({ key: 'x', label: 'stop', color: 'red' });
      if (focusedAgent?._managed && focusedAgent._dead) {
        items.push({ key: 'r', label: 'restart', color: 'green' });
        items.push({ key: 'x', label: 'remove', color: 'red' });
      }
      if (isAgentAddressable(focusedAgent))
        items.push({ key: 'm', label: 'message', color: 'cyan' });
      if (focusedAgent?._managed)
        items.push({
          key: 'l',
          label: showDiagnostics ? 'hide diagnostics' : 'diagnostics',
          color: 'yellow',
        });
      return items;
    }
    if (composer.isComposing) {
      return [
        {
          key: 'enter',
          label:
            composer.composeMode === 'memory-add'
              ? 'save'
              : composer.composeMode === 'memory-search'
                ? 'search'
                : 'send',
          color: 'green',
        },
        { key: 'esc', label: 'cancel', color: 'cyan' },
      ];
    }
    return [{ key: 'q', label: 'quit', color: 'gray' }];
  }, [isAgentFocusView, focusedAgent, showDiagnostics, composer.isComposing, composer.composeMode]);

  // ── Contextual hints ───────────────────────────────
  const contextHints = useMemo(() => {
    const hints: Array<{ commandKey: string; label: string; color: string }> = [];
    if (mainSelectedAgent) {
      hints.push({ commandKey: 'enter', label: 'inspect', color: 'cyan' });
      if (isAgentAddressable(mainSelectedAgent))
        hints.push({ commandKey: 'm', label: 'message', color: 'cyan' });
      if (mainSelectedAgent._managed && !mainSelectedAgent._dead)
        hints.push({ commandKey: 'x', label: 'stop', color: 'red' });
    }
    return hints;
  }, [mainSelectedAgent]);

  // ── Guards ─────────────────────────────────────────
  if (cols < MIN_WIDTH) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>
          Terminal too narrow ({cols} cols). Widen to at least {MIN_WIDTH}.
        </Text>
        <Text>{''}</Text>
        <Text>
          <Text color="cyan" bold>
            [q]
          </Text>
          <Text dimColor> quit</Text>
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Text color="red" bold>
          {error}
        </Text>
        <Text>{''}</Text>
        <Text dimColor>
          {error.includes('chinwag init')
            ? 'Set up this project first, then relaunch.'
            : error.includes('expired')
              ? 'Your auth token is no longer valid.'
              : 'Check the issue above and try again.'}
        </Text>
        <HintRow
          hints={[
            ...(error.includes('expired') || error.includes('.chinwag')
              ? []
              : [{ commandKey: 'r', label: 'retry', color: 'cyan' }]),
            { commandKey: 'q', label: 'quit', color: 'gray' },
          ]}
        />
      </Box>
    );
  }

  if (!context) {
    const isAutoRetrying = connState === 'connecting' || connState === 'reconnecting';
    const spin = SPINNER[spinnerFrame];
    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {isAutoRetrying ? (
          <Text>
            <Text color="cyan">{spin} </Text>
            <Text color="cyan">
              {connState === 'connecting' ? 'Connecting to team' : connDetail || 'Reconnecting'}
            </Text>
          </Text>
        ) : (
          <Box flexDirection="column">
            <Text color="red">{connDetail || 'Cannot reach server.'}</Text>
            <Text>{''}</Text>
            <HintRow
              hints={[
                { commandKey: 'r', label: 'retry now', color: 'cyan' },
                { commandKey: 'q', label: 'quit', color: 'gray' },
              ]}
            />
          </Box>
        )}
      </Box>
    );
  }

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
