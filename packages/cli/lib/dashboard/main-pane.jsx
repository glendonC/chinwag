import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import {
  HintRow,
  NoticeLine,
} from './ui.jsx';
import {
  KnowledgePanel,
  SessionsPanel,
} from './sections.jsx';
import { SPINNER, truncateText } from './utils.js';
import {
  isAgentAddressable, getAgentIntent,
  getAgentDisplayLabel, getIntentColor,
} from './agent-display.js';
import { detectTerminalEnvironment } from '../terminal-spawner.js';

/**
 * Renders the input bars for compose modes (command, targeted, memory-search, memory-add).
 */
export function InputBars({ composer, memory, commandSuggestions, onComposeSubmit, onMemorySubmit }) {
  return (
    <>
      {composer.composeMode === 'command' && (() => {
        const maxNameLen = Math.max(...commandSuggestions.map(e => e.name.length), 0);
        return (
          <Box flexDirection="column">
            <Box>
              <Text color="cyan">{'> '}</Text>
              <TextInput
                value={composer.composeText}
                onChange={v => { composer.setComposeText(v); composer.setCommandSelectedIdx(0); }}
                onSubmit={onComposeSubmit}
                placeholder="type a command"
              />
            </Box>
            {commandSuggestions.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                {commandSuggestions.slice(0, 6).map((entry, idx) => {
                  const sel = idx === composer.commandSelectedIdx;
                  return (
                    <Text key={entry.name}>
                      <Text color={sel ? 'cyan' : 'gray'}>{sel ? '\u203A ' : '  '}</Text>
                      <Text color={sel ? 'cyan' : 'white'}>{entry.name.padEnd(maxNameLen)}</Text>
                      <Text dimColor>  {entry.description}</Text>
                    </Text>
                  );
                })}
              </Box>
            )}
          </Box>
        );
      })()}

      {composer.composeMode === 'targeted' && (
        <Box>
          <Text color="cyan">{'@'}{composer.composeTargetLabel || 'agent'}{' '}</Text>
          <TextInput
            value={composer.composeText}
            onChange={composer.setComposeText}
            onSubmit={onComposeSubmit}
            placeholder="send a message"
          />
        </Box>
      )}

      {composer.composeMode === 'memory-search' && (
        <Box>
          <Text color="yellow">{'search '}</Text>
          <TextInput value={memory.memorySearch} onChange={memory.setMemorySearch} placeholder="search shared knowledge" />
        </Box>
      )}

      {composer.composeMode === 'memory-add' && (
        <Box>
          <Text color="green">{'save '}</Text>
          <TextInput value={memory.memoryInput} onChange={memory.setMemoryInput} onSubmit={onMemorySubmit} placeholder="save to shared knowledge" />
        </Box>
      )}
    </>
  );
}

/**
 * Renders the command bar with input bars, notice line, and hint row.
 */
export function CommandBar({ composer, memory, notice, view, commandSuggestions, onComposeSubmit, onMemorySubmit }) {
  const isMemoryView = view === 'memory';
  const isSessionsView = view === 'sessions';

  return (
    <Box paddingX={1} paddingTop={1} flexDirection="column">
      <Box borderStyle="round" borderColor={composer.isComposing ? 'cyan' : 'gray'} paddingX={1} flexDirection="column">
        <InputBars
          composer={composer}
          memory={memory}
          commandSuggestions={commandSuggestions}
          onComposeSubmit={onComposeSubmit}
          onMemorySubmit={onMemorySubmit}
        />
        {!composer.isComposing && (
          <Text dimColor>  {'>'} Press / for commands</Text>
        )}
      </Box>
      <NoticeLine notice={notice} />
      <Box paddingTop={1}>
        <HintRow hints={
          isMemoryView
            ? [
                { commandKey: '/', label: 'search', color: 'cyan' },
                { commandKey: 'a', label: 'add', color: 'green' },
                ...(memory.memorySelectedIdx >= 0 ? [{ commandKey: 'd', label: 'delete', color: 'red' }] : []),
                { commandKey: 'esc', label: 'back', color: 'cyan' },
                { commandKey: 'q', label: 'quit', color: 'gray' },
              ]
            : [
                ...(isSessionsView ? [{ commandKey: '\u2191\u2193', label: 'select', color: 'cyan' }] : []),
                { commandKey: 'q', label: 'quit', color: 'gray' },
              ]
        } />
      </Box>
    </Box>
  );
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
}) {
  const { selectedIdx, mainFocus, notice } = state;
  const { connState, connDetail, spinnerFrame, cols, projectDisplayName } = connection;
  const activeAgents = liveAgents.filter(a => !a._dead);
  const workingCount = activeAgents.filter(a => {
    const intent = getAgentIntent(a);
    return intent && !/idle/i.test(intent);
  }).length;

  return (
    <Box flexDirection="column" paddingTop={1}>
      {connState !== 'connected' && connDetail && (
        <Text color={connState === 'offline' ? 'red' : 'yellow'}>{connDetail}</Text>
      )}
      {connState === 'reconnecting' && <Text color="yellow">{SPINNER[spinnerFrame]} reconnecting</Text>}

      <Box flexDirection="column">
        <Text>
          <Text bold>agents</Text>
          {activeAgents.length > 0 && (
            <Text dimColor>{'  '}{activeAgents.length} connected</Text>
          )}
          {workingCount > 0 && (
            <Text dimColor>{' \u00B7 '}{workingCount} working</Text>
          )}
        </Text>
        {allVisibleAgents.length === 0 ? (
          <Text dimColor>  No agents connected. Press [n] to start one.</Text>
        ) : (() => {
          const toolColWidth = Math.max(4, ...allVisibleAgents.map(a => getAgentDisplayLabel(a, liveAgentNameCounts, allVisibleAgents).length)) + 1;
          const glyphColWidth = 2; // "● " or "○ "
          const maxActivity = cols ? cols - 4 - glyphColWidth - toolColWidth : Infinity;
          return (
            <Box flexDirection="column" marginTop={1}>
              {visibleSessionRows.items.map((agent, idx) => {
                const absoluteIdx = visibleSessionRows.start + idx;
                const isSelected = absoluteIdx === selectedIdx;
                const sel = isSelected && mainFocus === 'agents';
                const isDone = agent._dead;
                const isFailed = agent._failed;
                const intent = getAgentIntent(agent);
                const isIdle = !intent || /idle/i.test(intent);
                const activity = isDone
                  ? (agent.outputPreview || (isFailed ? 'exited with error' : 'completed'))
                  : (isIdle
                      ? (agent._duration ? `connected ${agent._duration}` : '\u2013')
                      : intent);
                const originGlyph = agent._managed ? '●' : '○';
                const glyphColor = isDone
                  ? (isFailed ? 'red' : 'gray')
                  : (isIdle ? 'yellow' : 'green');
                const activityColor = isDone ? undefined : getIntentColor(intent);
                const label = getAgentDisplayLabel(agent, liveAgentNameCounts, allVisibleAgents).padEnd(toolColWidth);
                return (
                  <Text key={agent.agent_id || agent.id}>
                    <Text color={sel ? 'cyan' : 'gray'}>{sel ? '\u203A ' : '  '}</Text>
                    <Text color={glyphColor} dimColor={isDone}>{originGlyph} </Text>
                    <Text bold={sel} dimColor={isDone}>{label}</Text>
                    <Text color={activityColor} dimColor={isDone}>{truncateText(activity, maxActivity)}</Text>
                  </Text>
                );
              })}
            </Box>
          );
        })()}
      </Box>

      {!agents.toolPickerOpen && !composer.isComposing && agents.unavailableCliAgents.map(tool => {
        const state = agents.getManagedToolState(tool.id);
        if (!state.recoveryCommand) return null;
        return (
          <Box key={tool.id} marginTop={1}>
            <Text>
              <Text color="yellow" bold>{tool.name}</Text>
              <Text color="yellow"> {state.detail || 'needs setup'}</Text>
              <Text dimColor>  </Text>
              <Text color="cyan" bold>[f]</Text>
              <Text dimColor> fix</Text>
            </Text>
          </Box>
        );
      })}

      {!agents.toolPickerOpen && !composer.isComposing && integrationIssues.map((integration) => {
        const issueText = integration.issues?.[0] || 'needs attention';
        return (
          <Box key={integration.id} marginTop={1}>
            <Text>
              <Text color="yellow" bold>{integration.name}</Text>
              <Text color="yellow"> {issueText}</Text>
              <Text dimColor>  </Text>
              <Text color="cyan" bold>[f]</Text>
              <Text dimColor> repair</Text>
            </Text>
          </Box>
        );
      })}

      <NoticeLine notice={notice} />

      {agents.toolPickerOpen && (() => {
        const tools = agents.readyCliAgents.length > 0 ? agents.readyCliAgents : agents.installedCliAgents;
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
                  <Text color={idx === agents.toolPickerIdx ? 'cyan' : 'gray'}>{idx === agents.toolPickerIdx ? '\u203A ' : '  '}</Text>
                  <Text color={idx === agents.toolPickerIdx ? 'cyan' : 'white'}>{tool.name}</Text>
                </Text>
              ))}
            </Box>
            <Text dimColor>{'\n'}{'\u2191\u2193'} select {'\u00B7'} enter open {'\u00B7'} esc cancel</Text>
          </Box>
        );
      })()}

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

/**
 * Renders the memory view.
 */
export function MemoryView({ memories, filteredMemories, visibleKnowledgeRows, memory, composer, state, commandSuggestions, onComposeSubmit, onMemorySubmit }) {
  const { notice } = state;
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" paddingTop={1}>
        <Text color="magenta" bold>memory</Text>
        <Text dimColor>Shared memory across your agents and teammates.</Text>
      </Box>

      <KnowledgePanel
        memories={memories}
        filteredMemories={filteredMemories}
        knowledgeVisible={visibleKnowledgeRows.items}
        windowStart={visibleKnowledgeRows.start}
        memorySearch={memory.memorySearch}
        memorySelectedIdx={memory.memorySelectedIdx}
        deleteConfirm={memory.deleteConfirm}
        deleteMsg={memory.deleteMsg}
      />

      <CommandBar
        composer={composer}
        memory={memory}
        notice={notice}
        view="memory"
        commandSuggestions={commandSuggestions}
        onComposeSubmit={onComposeSubmit}
        onMemorySubmit={onMemorySubmit}
      />
    </Box>
  );
}

/**
 * Renders the sessions view.
 */
export function SessionsView({ liveAgents, visibleSessionRows, state, cols, composer, memory, commandSuggestions, onComposeSubmit, onMemorySubmit }) {
  const { selectedIdx, notice } = state;
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" paddingTop={1}>
        <Text color="green" bold>sessions</Text>
        <Text dimColor>{liveAgents.length} live session{liveAgents.length === 1 ? '' : 's'} across managed and connected agents.</Text>
      </Box>

      <SessionsPanel
        liveAgents={visibleSessionRows.items}
        totalCount={liveAgents.length}
        windowStart={visibleSessionRows.start}
        selectedIdx={selectedIdx}
        getAgentIntent={getAgentIntent}
        cols={cols}
      />

      <CommandBar
        composer={composer}
        memory={memory}
        notice={notice}
        view="sessions"
        commandSuggestions={commandSuggestions}
        onComposeSubmit={onComposeSubmit}
        onMemorySubmit={onMemorySubmit}
      />
    </Box>
  );
}
