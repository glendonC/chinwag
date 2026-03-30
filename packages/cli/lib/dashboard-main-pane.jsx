import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { HintRow, NoticeLine } from './dashboard-ui.jsx';

/**
 * MainPane — the primary overview screen of the dashboard.
 * Shows project info, launcher, live agents, and action hints.
 */
export function MainPane({
  appVersion,
  projectDisplayName,
  projectDisplayPath,
  mainFocus,
  // Launcher state
  launcherSummary,
  selectedLaunchTool,
  selectedLaunchToolState,
  canLaunchSelectedTool,
  launcherChoices,
  installedCliAgents,
  getManagedToolState,
  // Compose state
  composeMode,
  composeText,
  setComposeText,
  onTaskLaunchSubmit,
  // Agent state
  liveAgents,
  recentResult,
  getRecentResultSummary,
  visibleSessionRows,
  selectedIdx,
  getAgentDisplayLabel,
  getAgentIntent,
  getAgentOriginLabel,
  getIntentColor,
  // Hints and overlays
  mainActionHints,
  overlayBar,
  dashboardRail,
}) {
  return (
    <Box flexDirection="column" paddingTop={1}>
      {dashboardRail}
      <Box borderStyle="round" borderColor={mainFocus === 'launcher' ? 'cyan' : 'gray'} paddingX={1} flexDirection="column">
        <Text>
          <Text color="magenta" bold>chinwag</Text>
          <Text dimColor> (v{appVersion})</Text>
        </Text>
        <Text>
          <Text dimColor>project: </Text>
          <Text color="cyan" bold>{projectDisplayName}</Text>
        </Text>
        <Text>
          <Text dimColor>directory: </Text>
          <Text>{projectDisplayPath}</Text>
        </Text>
        <Text>
          <Text dimColor>launcher: </Text>
          <Text color={canLaunchSelectedTool ? 'cyan' : selectedLaunchTool ? 'yellow' : 'white'}>{launcherSummary}</Text>
          {selectedLaunchTool && !canLaunchSelectedTool && selectedLaunchToolState?.detail ? (
            <Text dimColor>  {selectedLaunchToolState.detail}</Text>
          ) : null}
        </Text>
        {launcherChoices.length > 0 ? (
          <Box flexWrap="wrap" paddingTop={1}>
            {launcherChoices.map((tool, idx) => {
              const state = getManagedToolState(tool.id).state;
              const selected = selectedLaunchTool?.id === tool.id;
              const ready = state === 'ready';
              return (
                <Box key={tool.id} marginRight={2}>
                  <Text color={selected ? 'cyan' : ready ? 'white' : 'gray'} bold={selected || ready}>[{idx + 1}] {tool.name}</Text>
                  {!ready ? <Text dimColor> unavailable</Text> : null}
                </Box>
              );
            })}
          </Box>
        ) : null}
        {composeMode === 'launch' && selectedLaunchTool ? (
          canLaunchSelectedTool ? (
            <Box flexDirection="column" paddingTop={1}>
              <Box>
                <Text color={mainFocus === 'launcher' ? 'cyan' : 'gray'}>{mainFocus === 'launcher' ? '› ' : '  '}</Text>
                <Text color="cyan">{selectedLaunchTool.name}{'> '}</Text>
                <TextInput
                  value={composeText}
                  onChange={setComposeText}
                  onSubmit={onTaskLaunchSubmit}
                  placeholder="Describe the task to delegate..."
                />
              </Box>
              {launcherChoices.length > 1 ? (
                <Text dimColor>Press [esc], then choose another launcher.</Text>
              ) : null}
            </Box>
          ) : (
            <Box flexDirection="column" paddingTop={1}>
              <Text color="yellow">{selectedLaunchToolState?.detail || `${selectedLaunchTool.name} is not ready`}</Text>
              <Text dimColor>
                {launcherChoices.some(tool => getManagedToolState(tool.id).state === 'ready')
                  ? 'Pick a ready launcher above, or press [f]/[u].'
                  : 'Press [f] or [u] to make a launcher ready.'}
              </Text>
            </Box>
          )
        ) : (
          <Text>
            <Text color={mainFocus === 'launcher' ? 'cyan' : 'gray'}>{mainFocus === 'launcher' ? '› ' : '  '}</Text>
            <Text color={installedCliAgents.length > 0 ? 'cyan' : 'gray'} bold={installedCliAgents.length > 0}>[n]</Text>
            <Text bold={mainFocus === 'launcher'}> new task</Text>
            <Text dimColor>  {installedCliAgents.length > 0 ? 'start here' : 'no launchers configured'}</Text>
          </Text>
        )}
      </Box>

      {recentResult ? (
        <Box paddingTop={1}>
          <Text dimColor>Last result: {recentResult._display} · {getRecentResultSummary(recentResult)}</Text>
        </Box>
      ) : null}

      {liveAgents.length === 0 ? (
        <Box flexDirection="column" paddingTop={2}>
          <Text dimColor>No live agents yet.</Text>
          <Text dimColor>Agents started elsewhere appear here automatically.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" paddingTop={2}>
          <Text>
            <Text bold>live agents</Text>
            <Text dimColor>  {liveAgents.length} live</Text>
          </Text>
          <Box flexDirection="column" paddingTop={1}>
            {visibleSessionRows.items.map((agent, idx) => {
              const absoluteIdx = visibleSessionRows.start + idx;
              const isSelected = absoluteIdx === selectedIdx;
              const intent = getAgentIntent(agent);
              const origin = getAgentOriginLabel(agent);
              return (
                <Box key={agent.agent_id || agent.id} flexDirection="column" paddingBottom={1}>
                  <Text>
                    <Text color={isSelected && mainFocus === 'agents' ? 'cyan' : 'gray'}>{isSelected && mainFocus === 'agents' ? '› ' : '  '}</Text>
                    <Text color={agent._managed ? 'green' : 'cyan'}>● </Text>
                    <Text bold={isSelected && mainFocus === 'agents'}>{getAgentDisplayLabel(agent)}</Text>
                  </Text>
                  <Text>
                    <Text dimColor>  {origin} · </Text>
                    <Text color={getIntentColor(intent)} dimColor={getIntentColor(intent) === 'gray'}>{intent || 'Idle'}</Text>
                  </Text>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      <HintRow hints={mainActionHints} />
      {overlayBar}
    </Box>
  );
}
