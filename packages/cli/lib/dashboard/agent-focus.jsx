import React from 'react';
import { Box, Text } from 'ink';
import { basename, resolve } from 'path';
import { stripAnsi } from '../utils/ansi.js';
import {
  getAgentDisplayLabel, getAgentIntent,
  getAgentOriginLabel,
} from './agent-display.js';
import { HintRow, NoticeLine } from './ui.jsx';
import { getOutput } from '../process-manager.js';

const MEDIA_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff',
  '.mp4', '.mov', '.avi', '.webm', '.mp3', '.wav', '.ogg',
]);
const CONFIG_EXTS = new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.env', '.lock']);

function fileColor(name) {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return 'cyan';
  const ext = name.slice(dot).toLowerCase();
  if (MEDIA_EXTS.has(ext)) return 'gray';
  if (CONFIG_EXTS.has(ext)) return 'yellow';
  return 'cyan';
}

function isMedia(name) {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && MEDIA_EXTS.has(name.slice(dot).toLowerCase());
}

// OSC 8 terminal hyperlink — clickable in iTerm2, VS Code/Cursor terminal
function linked(label, filePath) {
  const abs = resolve(filePath);
  return `\x1b]8;;file://${abs}\x07${label}\x1b]8;;\x07`;
}

export function AgentFocusView({
  focusedAgent,
  combinedAgents,
  conflicts,
  notice,
  showDiagnostics,
  liveAgentNameCounts,
  navHints,
}) {
  if (!focusedAgent) return <Text dimColor>Agent no longer available. Press Esc to go back.</Text>;

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
  const codeFiles = agentFiles.filter(f => !isMedia(basename(f)));
  const mediaCount = agentFiles.length - codeFiles.length;
  const agentConflicts = conflicts.filter(([file]) => agentFiles.includes(file));
  const quietMinutes = freshAgent.minutes_since_update;
  const outputSummary = freshAgent.outputPreview || null;

  const statusColor = isRunning ? 'green' : isDead ? 'red' : 'green';
  const statusLabel = isRunning ? 'live' : isDead ? (exitCode !== 0 ? 'error' : 'done') : 'live';

  return (
    <Box flexDirection="column" paddingTop={1}>
      {/* Agent header */}
      <Box>
        <Text color={statusColor} bold>{getAgentDisplayLabel(freshAgent, liveAgentNameCounts, combinedAgents)}</Text>
        {freshAgent.handle && <Text dimColor>  @{freshAgent.handle}</Text>}
      </Box>
      <Box>
        <Text color={statusColor}>{statusLabel}</Text>
        {freshAgent._duration && <Text dimColor>  {freshAgent._duration}</Text>}
      </Box>

      {/* Source */}
      <Box marginTop={1}>
        <Text dimColor>source</Text>
        <Text>  {freshAgent._managed ? 'Spawned by chinwag — full control (stop, restart, diagnostics)' : 'Connected externally — observe and message only'}</Text>
      </Box>

      {/* Exit info */}
      {isDead && exitCode !== 0 && (
        <Box marginTop={1}>
          <Text color="red">exited with code {exitCode ?? 'unknown'}</Text>
        </Box>
      )}
      {isDead && outputSummary && (
        <Box>
          <Text dimColor>{outputSummary}</Text>
        </Box>
      )}

      {/* Files */}
      {agentFiles.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>files</Text>
          {codeFiles.map(file => (
            <Text key={file}>
              <Text>  </Text>
              <Text color={fileColor(basename(file))}>{linked(basename(file), file)}</Text>
            </Text>
          ))}
          {mediaCount > 0 && (
            <Text dimColor>  {mediaCount} image{mediaCount > 1 ? 's' : ''}</Text>
          )}
        </Box>
      )}

      {/* Conflicts — only if present */}
      {agentConflicts.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">conflicts</Text>
          {agentConflicts.map(([file, owners]) => (
            <Text key={file}>
              <Text>  </Text>
              <Text color="red">{basename(file)}</Text>
              <Text dimColor>  {owners.join(' & ')}</Text>
            </Text>
          ))}
        </Box>
      )}

      {/* Quiet warning — only if actually quiet */}
      {quietMinutes != null && quietMinutes >= 15 && (
        <Box marginTop={1}>
          <Text color="yellow">quiet for {Math.round(quietMinutes)}m</Text>
        </Box>
      )}

      {/* Diagnostics (managed agents only) */}
      {freshAgent._managed && showDiagnostics && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>diagnostics</Text>
          {outputLines.length > 0 ? (
            outputLines.map((line, idx) => (
              <Text key={`${freshAgent.id}-${idx}`} dimColor>  {line}</Text>
            ))
          ) : (
            <Text dimColor>  no output</Text>
          )}
        </Box>
      )}

      <NoticeLine notice={notice} />

      <HintRow hints={navHints} />
    </Box>
  );
}
