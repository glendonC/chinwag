import React, { useReducer, useEffect, useRef, useCallback, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { basename } from 'path';
import {
  buildCombinedAgentRows,
  buildDashboardView,
} from './view.js';
import { HintRow } from './ui.jsx';
import { useDashboardConnection } from './connection.jsx';
import { useMemoryManager } from './memory.js';
import { useAgentLifecycle } from './agents.js';
import { useComposer } from './composer.js';
import { useIntegrationDoctor } from './integrations.js';
import { createInputHandler, createCommandHandler } from './input.js';
import { MainPane, MemoryView, SessionsView } from './main-pane.jsx';
import { AgentFocusView } from './agent-focus.jsx';
import {
  MIN_WIDTH, SPINNER,
  openWebDashboard, getVisibleWindow, formatProjectPath,
} from './utils.js';
import { isAgentAddressable } from './agent-display.js';
import { dashboardReducer, initialState } from './reducer.js';

// ── Constants ───────────────────────────────────────
const RECENTLY_FINISHED_LIMIT = 3;
const MIN_VIEWPORT_ROWS = 4;
const VIEWPORT_CHROME_ROWS = 11;
const COMMAND_SUGGESTION_LIMIT = 5;


// ── Main Dashboard component ────────────────────────

export function Dashboard({ config, navigate, layout, projectLabel = null, appVersion = '0.1.0', setFooterHints }) {
  const { stdout } = useStdout();
  const viewportRows = layout?.viewportRows || 18;

  // ── Connection + project state ─────────────────────
  const connection = useDashboardConnection({ config, stdout });
  const {
    teamId, teamName, projectRoot, detectedTools,
    context, error, connState, connDetail, spinnerFrame, cols,
    retry: connectionRetry, bumpRefreshKey,
  } = connection;

  // ── UI state (single reducer) ──────────────────────
  const [state, dispatch] = useReducer(dashboardReducer, initialState);
  const { view, mainFocus, selectedIdx, focusedAgent, showDiagnostics, notice } = state;
  const isHomeView = view === 'home';
  const isSessionsView = view === 'sessions';
  const isMemoryView = view === 'memory';
  const isAgentFocusView = view === 'agent-focus';

  // ── Flash notification ─────────────────────────────
  const noticeTimer = useRef(null);
  const flash = useCallback((msg, opts = {}) => {
    const tone = typeof opts === 'object' ? opts.tone || 'info' : 'info';
    const autoClearMs = typeof opts === 'object' ? opts.autoClearMs : null;
    if (noticeTimer.current) { clearTimeout(noticeTimer.current); noticeTimer.current = null; }
    dispatch({ type: 'FLASH', text: msg, tone });
    if (autoClearMs && autoClearMs > 0) {
      noticeTimer.current = setTimeout(() => {
        dispatch({ type: 'CLEAR_NOTICE', text: msg });
        noticeTimer.current = null;
      }, autoClearMs);
    }
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  // ── Custom hooks ───────────────────────────────────
  const memory = useMemoryManager({ config, teamId, bumpRefreshKey, flash }, state, dispatch);
  const agents = useAgentLifecycle({ config, teamId, projectRoot, stdout, flash });
  const integrations = useIntegrationDoctor({ projectRoot, flash });
  const composer = useComposer({
    config, teamId, bumpRefreshKey, flash,
    clearMemorySearch: memory.clearMemorySearch,
    clearMemoryInput: memory.clearMemoryInput,
  }, state, dispatch);

  // ── Footer hints (pushed to shell) ─────────────────
  useEffect(() => {
    if (!setFooterHints) return;
    if (composer.isComposing) {
      setFooterHints([{ key: 'esc', label: 'back' }, { key: 'q', label: 'quit', color: 'gray' }]);
    } else {
      const ready = agents.readyCliAgents;
      const primary = ready[0] || agents.installedCliAgents[0];
      const nLabel = primary
        ? (ready.length > 1 ? 'new agent' : `new ${primary.name}`)
        : 'new agent';
      setFooterHints([
        { key: 'n', label: nLabel, color: 'green' },
        { key: 'w', label: 'web' },
        { key: '/', label: 'more' },
        { key: 'q', label: 'quit', color: 'gray' },
      ]);
    }
  }, [composer.isComposing, agents.installedCliAgents, agents.managedToolStates]);

  // ── Derived data ───────────────────────────────────
  const {
    getToolName, conflicts, memories, filteredMemories, visibleMemories, visibleAgents,
  } = buildDashboardView({
    context, detectedTools, memoryFilter: null,
    memorySearch: composer.composeMode === 'memory-search' ? memory.memorySearch : '',
    cols, projectDir: teamName || basename(process.cwd()),
  });

  const combinedAgents = buildCombinedAgentRows({
    managedAgents: agents.managedAgents,
    connectedAgents: visibleAgents,
    getToolName,
  });
  const liveAgents = combinedAgents.filter(agent => !agent._dead);
  const recentlyFinished = combinedAgents
    .filter(agent => agent._managed && agent._dead)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, RECENTLY_FINISHED_LIMIT);
  const allVisibleAgents = [...liveAgents, ...recentlyFinished];
  const selectedAgent = selectedIdx >= 0 ? allVisibleAgents[selectedIdx] : null;
  const mainSelectedAgent = mainFocus === 'agents' ? selectedAgent : null;
  const knowledgeVisible = isMemoryView || composer.composeMode === 'memory-search' || composer.composeMode === 'memory-add'
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
  const visibleSessionRows = getVisibleWindow(allVisibleAgents, selectedIdx, Math.max(MIN_VIEWPORT_ROWS, viewportRows - VIEWPORT_CHROME_ROWS));
  const visibleKnowledgeRows = getVisibleWindow(knowledgeVisible, memory.memorySelectedIdx, Math.max(MIN_VIEWPORT_ROWS, viewportRows - VIEWPORT_CHROME_ROWS));

  // ── Command palette ────────────────────────────────
  const commandEntries = useMemo(() => [
    { name: '/new', description: 'Open a tool in a new terminal tab' },
    ...((agents.unavailableCliAgents.some(tool => agents.getManagedToolState(tool.id).recoveryCommand)
      || integrations.integrationIssues.length > 0)
      ? [{ name: '/fix', description: 'Open the main setup fix flow' }] : []),
    { name: '/recheck', description: 'Refresh available tools and integration health' },
    { name: '/doctor', description: 'Scan local Chinwag integration health' },
    ...(integrations.integrationIssues.length > 0
      ? [{ name: '/repair', description: 'Repair detected integration issues' }] : []),
    ...(hasMemories ? [{ name: '/knowledge', description: 'View shared knowledge' }] : []),
    ...(hasLiveAgents ? [{ name: '/history', description: 'View past agent activity' }] : []),
    { name: '/web', description: 'Open chinwag in browser' },
    ...(selectedAgent && isAgentAddressable(selectedAgent)
      ? [{ name: '/message', description: `Message ${selectedAgent._display}` }] : []),
    { name: '/help', description: 'Show command help' },
  ], [agents.unavailableCliAgents, agents.managedToolStates, integrations.integrationIssues,
      hasMemories, hasLiveAgents, selectedAgent]);

  const commandQuery = composer.composeMode === 'command'
    ? composer.composeText.trim().replace(/^\//, '').toLowerCase() : '';
  const commandSuggestions = composer.composeMode === 'command'
    ? commandEntries.filter((entry) => {
        if (!commandQuery) return true;
        const normalized = entry.name.slice(1).toLowerCase();
        return normalized.startsWith(commandQuery) || entry.description.toLowerCase().includes(commandQuery);
      }).slice(0, COMMAND_SUGGESTION_LIMIT + 1)
    : [];

  // ── Clamp selection indices ────────────────────────
  useEffect(() => {
    dispatch({ type: 'CLAMP_SELECTION', listLength: allVisibleAgents.length });
  }, [allVisibleAgents.length]);

  useEffect(() => {
    dispatch({ type: 'CLAMP_MEMORY_SELECTION', listLength: visibleMemories.length });
  }, [visibleMemories.length]);

  // ── Handlers ───────────────────────────────────────
  const handleOpenWebDashboard = useCallback(() => {
    const result = openWebDashboard(config?.token);
    flash(
      result.ok ? 'Opened web dashboard' : `Could not open browser${result.error ? `: ${result.error}` : ''}`,
      result.ok ? { tone: 'success' } : { tone: 'error' }
    );
  }, [config?.token, flash]);

  const handleCommandSubmit = useCallback(
    createCommandHandler({
      agents, integrations, composer, memory, flash, dispatch,
      handleOpenWebDashboard, liveAgents, selectedAgent,
      isAgentAddressable,
    }),
    [agents, integrations, composer, memory, flash,
     handleOpenWebDashboard, liveAgents, selectedAgent]
  );

  const onComposeSubmit = useCallback(() => {
    composer.onComposeSubmit(commandSuggestions, handleCommandSubmit);
  }, [composer, commandSuggestions, handleCommandSubmit]);

  const onMemorySubmit = useCallback(() => {
    memory.onMemorySubmit();
    dispatch({ type: 'CLEAR_COMPOSE' });
  }, [memory]);

  // ── Input handling (wrapped in useCallback) ────────
  const inputHandler = useCallback(
    createInputHandler({
      state, dispatch,
      cols, error, context, connectionRetry,
      allVisibleAgents, liveAgents, visibleMemories,
      hasLiveAgents, hasMemories, mainSelectedAgent,
      liveAgentNameCounts,
      agents, integrations, composer, memory,
      commandSuggestions, handleCommandSubmit, handleOpenWebDashboard,
      navigate,
    }),
    [state,
     cols, error, context, connectionRetry,
     allVisibleAgents, liveAgents, visibleMemories,
     hasLiveAgents, hasMemories, mainSelectedAgent,
     agents, integrations, composer, memory,
     commandSuggestions, handleCommandSubmit, handleOpenWebDashboard,
     navigate]
  );

  useInput(inputHandler);

  // ── Nav hints ──────────────────────────────────────
  const navItems = useMemo(() => {
    if (isAgentFocusView) {
      const items = [{ key: 'esc', label: 'back', color: 'cyan' }];
      if (focusedAgent?._managed && !focusedAgent._dead) items.push({ key: 'x', label: 'stop', color: 'red' });
      if (focusedAgent?._managed && focusedAgent._dead) {
        items.push({ key: 'r', label: 'restart', color: 'green' });
        items.push({ key: 'x', label: 'remove', color: 'red' });
      }
      if (isAgentAddressable(focusedAgent)) items.push({ key: 'm', label: 'message', color: 'cyan' });
      if (focusedAgent?._managed) items.push({ key: 'l', label: showDiagnostics ? 'hide diagnostics' : 'diagnostics', color: 'yellow' });
      return items;
    }
    if (composer.isComposing) {
      return [
        { key: 'enter', label: composer.composeMode === 'memory-add' ? 'save' : composer.composeMode === 'memory-search' ? 'search' : 'send', color: 'green' },
        { key: 'esc', label: 'cancel', color: 'cyan' },
      ];
    }
    return [{ key: 'q', label: 'quit', color: 'gray' }];
  }, [isAgentFocusView, focusedAgent, showDiagnostics, composer.isComposing, composer.composeMode]);

  // ── Contextual hints ───────────────────────────────
  const contextHints = useMemo(() => {
    const hints = [];
    if (mainSelectedAgent) {
      hints.push({ commandKey: 'enter', label: 'inspect', color: 'cyan' });
      if (isAgentAddressable(mainSelectedAgent)) hints.push({ commandKey: 'm', label: 'message', color: 'cyan' });
      if (mainSelectedAgent._managed && !mainSelectedAgent._dead) hints.push({ commandKey: 'x', label: 'stop', color: 'red' });
    }
    return hints;
  }, [mainSelectedAgent]);

  // ── Guards ─────────────────────────────────────────
  if (cols < MIN_WIDTH) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>Terminal too narrow ({cols} cols). Widen to at least {MIN_WIDTH}.</Text>
        <Text>{''}</Text>
        <Text><Text color="cyan" bold>[q]</Text><Text dimColor> quit</Text></Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Text color="red" bold>{error}</Text>
        <Text>{''}</Text>
        <Text dimColor>
          {error.includes('chinwag init') ? 'Set up this project first, then relaunch.'
            : error.includes('expired') ? 'Your auth token is no longer valid.'
            : 'Check the issue above and try again.'}
        </Text>
        <HintRow hints={[
          ...(error.includes('expired') || error.includes('.chinwag') ? [] : [{ commandKey: 'r', label: 'retry', color: 'cyan' }]),
          { commandKey: 'q', label: 'quit', color: 'gray' },
        ]} />
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
            <Text color="cyan">{connState === 'connecting' ? 'Connecting to team' : (connDetail || 'Reconnecting')}</Text>
          </Text>
        ) : (
          <Box flexDirection="column">
            <Text color="red">{connDetail || 'Cannot reach server.'}</Text>
            <Text>{''}</Text>
            <HintRow hints={[
              { commandKey: 'r', label: 'retry now', color: 'cyan' },
              { commandKey: 'q', label: 'quit', color: 'gray' },
            ]} />
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
        navHints={navItems.map(item => ({ commandKey: item.key, label: item.label, color: item.color || 'cyan' }))}
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
        memory={memory}
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
        memory={memory}
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
      agents={agents}
      integrationIssues={integrations.integrationIssues}
      composer={composer}
      memory={memory}
      contextHints={contextHints}
      commandSuggestions={commandSuggestions}
      onComposeSubmit={onComposeSubmit}
      onMemorySubmit={onMemorySubmit}
    />
  );
}
