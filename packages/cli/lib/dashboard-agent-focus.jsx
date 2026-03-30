import React from 'react';
import { Box, Text } from 'ink';
import { basename } from 'path';
import { stripAnsi } from './dashboard-utils.js';
import {
  getAgentDisplayLabel, getAgentIntent,
  getAgentOriginLabel, getAgentMeta,
} from './dashboard-agent-display.js';
import { HintRow, NoticeLine } from './dashboard-ui.jsx';
import { getOutput } from './process-manager.js';

export function AgentFocusView({
  focusedAgent,
  combinedAgents,
  conflicts,
  notice,
  showDiagnostics,
  liveAgentNameCounts,
  navHints,
}) {
  if (!focusedAgent) return null;

  const freshAgent = focusedAgent._managed
    ? (combinedAgents.find(agent => agent._managed && agent.id === focusedAgent.id) || focusedAgent)
    : (combinedAgents.find(agent => !agent._managed && agent.agent_id === focusedAgent.agent_id) || focusedAgent);
  const isRunning = freshAgent._managed ? freshAgent.status === 'running' : freshAgent.status === 'active';
  const isDead = freshAgent._managed ? freshAgent._dead : freshAgent.status !== 'active';
  const exitCode = freshAgent._exitCode;
  const outputLines = showDiagnostics && freshAgent._managed
    ? getOutput(freshAgent.id, 12)
        .map(line => stripAnsi(line))
        .map(line => line.trimEnd())
        .filter(Boolean)
    : [];
  const agentFiles = freshAgent.activity?.files || [];
  const agentConflicts = conflicts.filter(([file]) => agentFiles.includes(file));
  const sourceLabel = getAgentOriginLabel(freshAgent);
  const quietLabel = freshAgent.minutes_since_update != null && freshAgent.minutes_since_update >= 15
    ? `Quiet for ${Math.round(freshAgent.minutes_since_update)}m`
    : null;
  const outputSummary = freshAgent.outputPreview || null;

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" paddingTop={1}>
        <Text color="green" bold>session details</Text>
        <Text dimColor>{sourceLabel}</Text>
      </Box>

      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Text>
          {isRunning
            ? <Text color="green">{'\u25CF'} </Text>
            : isDead
              ? <Text color="red">{'\u25CF'} </Text>
              : <Text color="green">{'\u25CF'} </Text>
          }
          <Text bold>{getAgentDisplayLabel(freshAgent, liveAgentNameCounts)}</Text>
          {freshAgent.handle && <Text dimColor>  {freshAgent.handle}</Text>}
          {freshAgent._duration && <Text dimColor>  {freshAgent._duration}</Text>}
        </Text>
        <Text>{''}</Text>
        <Text bold>Session</Text>
        <Text dimColor>  {sourceLabel}</Text>
        {isRunning && <Text color="green">  Live</Text>}
        {isDead && exitCode === 0 && <Text dimColor>  Completed</Text>}
        {isDead && exitCode !== 0 && <Text color="red">  Exited with error (code {exitCode ?? 'unknown'})</Text>}

        <Text>{''}</Text>
        <Text bold>Work</Text>
        {getAgentIntent(freshAgent) ? (
          <Text>  {getAgentIntent(freshAgent)}</Text>
        ) : (
          <Text dimColor>  No current work summary</Text>
        )}
        {freshAgent._managed && freshAgent._dead && outputSummary && (
          <Text dimColor>  Final response: {outputSummary}</Text>
        )}
        {agentFiles.length > 0 ? (
          <Box flexDirection="column">
            {agentFiles.map(file => (
              <Text key={file} dimColor>  {basename(file)}</Text>
            ))}
          </Box>
        ) : (
          <Text dimColor>  No files reported yet</Text>
        )}

        <Text>{''}</Text>
        <Text bold>Coordination</Text>
        {quietLabel ? <Text color="yellow">  {quietLabel}</Text> : <Text dimColor>  No quiet-session signal</Text>}
        {agentConflicts.length > 0 ? (
          <Box flexDirection="column">
            {agentConflicts.map(([file, owners]) => (
              <Text key={file} color="red">  Conflict on {basename(file)} {'· '}{owners.join(' & ')}</Text>
            ))}
          </Box>
        ) : (
          <Text dimColor>  No active conflicts involving this agent</Text>
        )}
        {getAgentMeta(freshAgent) && <Text dimColor>  {getAgentMeta(freshAgent)}</Text>}

        {freshAgent._managed && (
          <>
            <Text>{''}</Text>
            <Text bold>Diagnostics</Text>
            {!showDiagnostics ? (
              <Text dimColor>  Hidden by default. Press [l] to inspect captured process output.</Text>
            ) : outputLines.length > 0 ? (
              <Box flexDirection="column">
                {outputLines.map((line, idx) => (
                  <Text key={`${freshAgent.id}-${idx}`} dimColor>  {line}</Text>
                ))}
              </Box>
            ) : (
              <Text dimColor>  No captured output yet</Text>
            )}
          </>
        )}
      </Box>

      <Box paddingX={1} paddingTop={1}>
        <NoticeLine notice={notice} />
      </Box>

      <Box paddingTop={1}>
        <HintRow hints={navHints} />
      </Box>
    </Box>
  );
}
