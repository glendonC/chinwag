import React from 'react';
import { Box, Text } from 'ink';
import { HintRow, NoticeLine } from './ui.jsx';
import type { HintItem } from './ui.jsx';
import { InputBars } from './input-bars.jsx';
import { SPINNER, truncateText } from './utils.js';
import { getAgentIntent, getAgentDisplayLabel, getIntentColor } from './agent-display.js';
import { detectTerminalEnvironment } from '../terminal-spawner.js';
import type { CombinedAgentRow } from './view.js';
import type { DashboardState } from './reducer.js';
import type { UseAgentLifecycleReturn } from './agents.js';
import type { UseComposerReturn } from './composer.js';
import type { UseMemoryManagerReturn } from './memory.js';
import type { IntegrationScanResult } from '@chinwag/shared/integration-doctor.js';

interface CommandSuggestion {
  name: string;
  description?: string;
}

// ── Agents table ────────────────────────────────────

interface AgentsTableProps {
  agents: CombinedAgentRow[];
  visibleRows: { items: CombinedAgentRow[]; start: number };
  selectedIdx: number;
  mainFocus: string;
  liveAgentNameCounts: Map<string, number>;
  allVisibleAgents: CombinedAgentRow[];
  cols: number;
}

function AgentsTable({
  agents: allAgents,
  visibleRows,
  selectedIdx,
  mainFocus,
  liveAgentNameCounts,
  allVisibleAgents,
  cols,
}: AgentsTableProps): React.ReactNode {
  const toolColWidth =
    Math.max(
      4,
      ...allAgents.map(
        (a) => getAgentDisplayLabel(a, liveAgentNameCounts, allVisibleAgents).length,
      ),
    ) + 1;
  const glyphColWidth = 2;
  const maxActivity = cols ? cols - 4 - glyphColWidth - toolColWidth : Infinity;

  return (
    <Box flexDirection="column" marginTop={1}>
      {visibleRows.items.map((agent, idx) => {
        const absoluteIdx = visibleRows.start + idx;
        const isSelected = absoluteIdx === selectedIdx;
        const sel = isSelected && mainFocus === 'agents';
        const isDone = agent._dead;
        const isFailed = agent._failed;
        const intent = getAgentIntent(agent);
        const isIdle = !intent || /idle/i.test(intent);
        const activity = isDone
          ? agent.outputPreview || (isFailed ? 'exited with error' : 'completed')
          : isIdle
            ? agent._duration
              ? `connected ${agent._duration}`
              : '\u2013'
            : intent;
        const originGlyph = agent._managed ? '●' : '○';
        const glyphColor = isDone ? (isFailed ? 'red' : 'gray') : isIdle ? 'yellow' : 'green';
        const activityColor = isDone ? undefined : getIntentColor(intent);
        const label = getAgentDisplayLabel(agent, liveAgentNameCounts, allVisibleAgents).padEnd(
          toolColWidth,
        );
        return (
          <Text key={agent.agent_id || agent.id}>
            <Text color={sel ? 'cyan' : 'gray'}>{sel ? '\u203A ' : '  '}</Text>
            <Text color={glyphColor} dimColor={isDone}>
              {originGlyph}{' '}
            </Text>
            <Text bold={sel} dimColor={isDone}>
              {label}
            </Text>
            <Text {...(activityColor ? { color: activityColor } : {})} dimColor={isDone}>
              {truncateText(activity, maxActivity)}
            </Text>
          </Text>
        );
      })}
    </Box>
  );
}

// ── Tool picker overlay ─────────────────────────────

interface ToolPickerOverlayProps {
  agents: UseAgentLifecycleReturn;
}

function ToolPickerOverlay({ agents }: ToolPickerOverlayProps): React.ReactNode {
  const tools =
    agents.readyCliAgents.length > 0 ? agents.readyCliAgents : agents.installedCliAgents;
  const termEnv = detectTerminalEnvironment();

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text dimColor>Opens in: </Text>
        <Text>{termEnv.name}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {tools.map((tool, idx) => (
          <Text key={tool.id}>
            <Text color={idx === agents.toolPickerIdx ? 'cyan' : 'gray'}>
              {idx === agents.toolPickerIdx ? '\u203A ' : '  '}
            </Text>
            <Text color={idx === agents.toolPickerIdx ? 'cyan' : 'white'}>{tool.name}</Text>
          </Text>
        ))}
      </Box>
      <Text dimColor>
        {'\n'}
        {'\u2191\u2193'} select {'\u00B7'} enter open {'\u00B7'} esc cancel
      </Text>
    </Box>
  );
}

// ── Main pane ───────────────────────────────────────

interface MainPaneConnectionProps {
  connState: string;
  connDetail: string | null;
  spinnerFrame: number;
  cols: number;
  projectDisplayName: string | null | undefined;
}

interface MainPaneProps {
  state: DashboardState;
  connection: MainPaneConnectionProps;
  allVisibleAgents: CombinedAgentRow[];
  liveAgents: CombinedAgentRow[];
  visibleSessionRows: { items: CombinedAgentRow[]; start: number };
  liveAgentNameCounts: Map<string, number>;
  agents: UseAgentLifecycleReturn;
  integrationIssues: IntegrationScanResult[];
  composer: UseComposerReturn;
  memory: UseMemoryManagerReturn;
  contextHints: HintItem[];
  commandSuggestions: CommandSuggestion[];
  onComposeSubmit: () => void;
  onMemorySubmit: () => void;
}

/**
 * Renders the home view main pane with agents table, tool issues, tool picker, and compose overlay.
 */
export function MainPane({
  state,
  connection,
  allVisibleAgents,
  liveAgents,
  visibleSessionRows,
  liveAgentNameCounts,
  agents,
  integrationIssues,
  composer,
  memory,
  contextHints,
  commandSuggestions,
  onComposeSubmit,
  onMemorySubmit,
}: MainPaneProps): React.ReactNode {
  const { selectedIdx, mainFocus, notice } = state;
  const { connState, connDetail, spinnerFrame, cols, projectDisplayName } = connection;
  const activeAgents = liveAgents.filter((a) => !a._dead);
  const workingCount = activeAgents.filter((a) => {
    const intent = getAgentIntent(a);
    return intent && !/idle/i.test(intent);
  }).length;

  return (
    <Box flexDirection="column" paddingTop={1}>
      {connState !== 'connected' && connDetail && (
        <Text color={connState === 'offline' ? 'red' : 'yellow'}>{connDetail}</Text>
      )}
      {connState === 'reconnecting' && (
        <Text color="yellow">{SPINNER[spinnerFrame]} reconnecting</Text>
      )}

      <Box flexDirection="column">
        <Text>
          <Text bold>agents</Text>
          {activeAgents.length > 0 && (
            <Text dimColor>
              {'  '}
              {activeAgents.length} connected
            </Text>
          )}
          {workingCount > 0 && (
            <Text dimColor>
              {' \u00B7 '}
              {workingCount} working
            </Text>
          )}
        </Text>
        {allVisibleAgents.length === 0 ? (
          <Text dimColor> No agents connected. Press [n] to start one.</Text>
        ) : (
          <AgentsTable
            agents={allVisibleAgents}
            visibleRows={visibleSessionRows}
            selectedIdx={selectedIdx}
            mainFocus={mainFocus}
            liveAgentNameCounts={liveAgentNameCounts}
            allVisibleAgents={allVisibleAgents}
            cols={cols}
          />
        )}
      </Box>

      {!agents.toolPickerOpen &&
        !composer.isComposing &&
        agents.unavailableCliAgents.map((tool) => {
          const toolState = agents.getManagedToolState(tool.id);
          if (!toolState.recoveryCommand) return null;
          return (
            <Box key={tool.id} marginTop={1}>
              <Text>
                <Text color="yellow" bold>
                  {tool.name}
                </Text>
                <Text color="yellow"> {toolState.detail || 'needs setup'}</Text>
                <Text dimColor> </Text>
                <Text color="cyan" bold>
                  [f]
                </Text>
                <Text dimColor> fix</Text>
              </Text>
            </Box>
          );
        })}

      {!agents.toolPickerOpen &&
        !composer.isComposing &&
        integrationIssues.map((integration) => {
          const issueText = integration.issues?.[0] || 'needs attention';
          return (
            <Box key={integration.id} marginTop={1}>
              <Text>
                <Text color="yellow" bold>
                  {integration.name}
                </Text>
                <Text color="yellow"> {issueText}</Text>
                <Text dimColor> </Text>
                <Text color="cyan" bold>
                  [f]
                </Text>
                <Text dimColor> repair</Text>
              </Text>
            </Box>
          );
        })}

      <NoticeLine notice={notice} />

      {agents.toolPickerOpen && <ToolPickerOverlay agents={agents} />}

      {composer.isComposing && (
        <Box paddingTop={1} flexDirection="column">
          <InputBars
            composer={composer}
            memory={memory}
            commandSuggestions={commandSuggestions}
            onComposeSubmit={onComposeSubmit}
            onMemorySubmit={onMemorySubmit}
          />
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>directory: {projectDisplayName}</Text>
      </Box>

      <HintRow hints={contextHints} />
    </Box>
  );
}
