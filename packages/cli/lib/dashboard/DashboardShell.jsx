import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { HintRow } from './ui.jsx';
import { MainPane, MemoryView, SessionsView } from './main-pane.jsx';
import { AgentFocusView } from './agent-focus.jsx';
import { MIN_WIDTH, SPINNER } from './utils.js';
import { isAgentAddressable } from './agent-display.js';
import { useCommandPalette } from './CommandPalette.jsx';
import { useDashboard } from './DashboardProvider.jsx';
import { useDashboardInput } from './use-dashboard-input.js';

/**
 * Dashboard shell: layout, input routing, view rendering.
 * Reads all state from DashboardProvider context.
 */
export function DashboardShell() {
  const ctx = useDashboard();
  const {
    state,
    context,
    error,
    connState,
    connDetail,
    spinnerFrame,
    cols,
    memory,
    agents,
    integrations,
    composer,
    conflicts,
    memories,
    filteredMemories,
    combinedAgents,
    liveAgents,
    allVisibleAgents,
    mainSelectedAgent,
    projectDisplayName,
    liveAgentNameCounts,
    visibleSessionRows,
    visibleKnowledgeRows,
  } = ctx;

  const { view, selectedIdx: stateSelectedIdx, mainFocus, focusedAgent, showDiagnostics } = state;
  const isAgentFocusView = view === 'agent-focus';
  const isMemoryView = view === 'memory';
  const isSessionsView = view === 'sessions';

  const commandPalette = useCommandPalette();
  const { commandSuggestions, onComposeSubmit, onMemorySubmit } = commandPalette;

  useDashboardInput({ commandPalette });

  // ── Nav hints ──────────────────────────────────────
  const navItems = useMemo(() => {
    if (isAgentFocusView) {
      const items = [{ key: 'esc', label: 'back', color: 'cyan' }];
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
    const hints = [];
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

  // ── View routing ───────────────────────────────────
  if (isAgentFocusView && focusedAgent) {
    return (
      <AgentFocusView
        focusedAgent={focusedAgent}
        combinedAgents={combinedAgents}
        conflicts={conflicts}
        notice={state.notice}
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

  if (isMemoryView) {
    return (
      <MemoryView
        memories={memories}
        filteredMemories={filteredMemories}
        visibleKnowledgeRows={visibleKnowledgeRows}
        memory={memory}
        composer={composer}
        notice={state.notice}
        commandSuggestions={commandSuggestions}
        onComposeSubmit={onComposeSubmit}
        onMemorySubmit={onMemorySubmit}
      />
    );
  }

  if (isSessionsView) {
    return (
      <SessionsView
        liveAgents={liveAgents}
        visibleSessionRows={visibleSessionRows}
        selectedIdx={stateSelectedIdx}
        cols={cols}
        composer={composer}
        memory={memory}
        notice={state.notice}
        commandSuggestions={commandSuggestions}
        onComposeSubmit={onComposeSubmit}
        onMemorySubmit={onMemorySubmit}
      />
    );
  }

  return (
    <MainPane
      projectDisplayName={projectDisplayName}
      connState={connState}
      connDetail={connDetail}
      spinnerFrame={spinnerFrame}
      cols={cols}
      allVisibleAgents={allVisibleAgents}
      liveAgents={liveAgents}
      visibleSessionRows={visibleSessionRows}
      selectedIdx={stateSelectedIdx}
      mainFocus={mainFocus}
      liveAgentNameCounts={liveAgentNameCounts}
      agents={agents}
      integrationIssues={integrations.integrationIssues}
      composer={composer}
      memory={memory}
      notice={state.notice}
      contextHints={contextHints}
      commandSuggestions={commandSuggestions}
      onComposeSubmit={onComposeSubmit}
      onMemorySubmit={onMemorySubmit}
    />
  );
}
