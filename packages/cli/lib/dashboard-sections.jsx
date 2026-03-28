import React from 'react';
import { Box, Text } from 'ink';
import { getAnimatedGlyph } from './dashboard-ui.jsx';

function truncateText(text, max) {
  if (!text) return text;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function summarizeLiveAgents(liveAgents) {
  const counts = new Map();
  for (const agent of liveAgents) {
    const label = agent._display || agent.tool || 'Agent';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
    .join(', ');
}

function shortSessionId(agentId) {
  if (!agentId) return '';
  const parts = agentId.split(':');
  if (parts.length >= 3) return parts[2].slice(0, 4);
  if (parts.length >= 2) return parts[1].slice(0, 4);
  return '';
}

function FeedLine({ accent = 'gray', title, subtitle = null }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        <Text color={accent}>  {'\u203A'} </Text>
        <Text bold>{title}</Text>
      </Text>
      {subtitle ? <Text dimColor>    {subtitle}</Text> : null}
    </Box>
  );
}

export function OverviewHeader({ projectName, summary }) {
  const showProject = projectName && projectName.toLowerCase() !== 'chinwag';
  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      <Text>
        <Text color="cyan" bold>chinwag</Text>
        {showProject ? <Text dimColor>  · {projectName}</Text> : null}
      </Text>
      <Text dimColor>{summary}</Text>
    </Box>
  );
}

export function AttentionSection({ items, cols }) {
  if (!items.length) return null;

  return (
    <Box flexDirection="column" paddingTop={1}>
      {items.slice(0, 1).map((item, idx) => (
        <FeedLine
          key={`${item.kind}-${idx}`}
          accent={item.kind === 'conflict' ? 'red' : 'yellow'}
          title={truncateText(item.text, cols - 8)}
        />
      ))}
    </Box>
  );
}

export function OverviewSummary({
  readyTools,
  unavailableTools,
  checkingTools,
  getManagedToolState,
  liveAgents,
  recentResult,
  cols,
}) {
  const hasLiveAgents = liveAgents.length > 0;
  const primaryIssue = unavailableTools[0] || null;

  return (
    <Box flexDirection="column" paddingTop={1}>
      {hasLiveAgents ? (
        <FeedLine
          accent="green"
          title={`${liveAgents.length} active session${liveAgents.length === 1 ? '' : 's'}`}
          subtitle={summarizeLiveAgents(liveAgents)}
        />
      ) : (
        <FeedLine
          title="No active agents"
          subtitle={readyTools.length > 0 ? 'Type /new to start one here.' : 'Open one in your editor or use /help.'}
        />
      )}

      {!hasLiveAgents && readyTools.length > 0 && (
        <FeedLine
          accent="green"
          title="Start a task"
          subtitle={readyTools.length === 1 ? `Use ${readyTools[0].name}.` : `${readyTools.length} tools available.`}
        />
      )}

      {!hasLiveAgents && checkingTools.length > 0 && (
        <FeedLine
          accent="yellow"
          title="Checking available tools"
          subtitle={`Working through ${checkingTools.length} tool${checkingTools.length === 1 ? '' : 's'}.`}
        />
      )}

      {!hasLiveAgents && primaryIssue && (
        <FeedLine
          accent="yellow"
          title={`${primaryIssue.name} needs attention`}
          subtitle={truncateText(getManagedToolState(primaryIssue.id).detail || 'Needs setup', cols - 8)}
        />
      )}

      {recentResult && !primaryIssue && (
        <FeedLine
          accent={recentResult._failed ? 'red' : 'green'}
          title={`Last result · ${recentResult._display}`}
          subtitle={truncateText(recentResult.summary, cols - 8)}
        />
      )}
    </Box>
  );
}

export function SessionsPanel({
  liveAgents,
  totalCount = liveAgents.length,
  windowStart = 0,
  selectedIdx,
  getAgentIntent,
  cols,
}) {
  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      <Text>
        <Text color="cyan" bold>Sessions</Text>
        <Text dimColor>  {totalCount} active</Text>
      </Text>
      {liveAgents.map((agent, idx) => {
        const absoluteIdx = windowStart + idx;
        const isSelected = absoluteIdx === selectedIdx;
        const intent = truncateText(getAgentIntent(agent), cols - 10);
        const sessionTag = shortSessionId(agent.agent_id);
        return (
          <Box key={agent.agent_id || agent.id} flexDirection="column">
            <Text>
              <Text color={isSelected ? 'cyan' : 'green'}>  {isSelected ? getAnimatedGlyph('selected') : getAnimatedGlyph('running')} </Text>
              <Text bold>{agent._display}</Text>
              {sessionTag ? <Text dimColor>  #{sessionTag}</Text> : null}
              {agent._duration ? <Text dimColor>  {agent._duration}</Text> : null}
            </Text>
            {intent ? <Text dimColor>    {intent}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

export function KnowledgePanel({
  memories,
  filteredMemories,
  knowledgeVisible,
  windowStart = 0,
  memorySearch,
  memorySelectedIdx,
  deleteConfirm,
  deleteMsg,
}) {
  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      <Text>
        <Text color="magenta" bold>Knowledge</Text>
        <Text dimColor>  {memories.length} saved</Text>
        {memorySearch ? <Text color="yellow">  "{memorySearch}"</Text> : null}
      </Text>
      {filteredMemories.length === 0 ? (
        <Text dimColor>  No matches for "{memorySearch}".</Text>
      ) : (
        <>
          {knowledgeVisible.map((mem, idx) => {
            const tagStr = mem.tags?.length ? `[${mem.tags.join(', ')}]` : '';
            const absoluteIdx = windowStart + idx;
            const isSelected = absoluteIdx === memorySelectedIdx;
            return (
              <Text key={mem.id || idx}>
                {isSelected
                  ? <Text color="cyan">  {getAnimatedGlyph('selected')} </Text>
                  : <Text>{'  '}</Text>}
                {tagStr && <Text dimColor>{tagStr}  </Text>}
                <Text>{mem.text}</Text>
                {isSelected && mem.source_handle && (
                  <Text dimColor>  — {mem.source_handle}</Text>
                )}
              </Text>
            );
          })}
        </>
      )}
      {deleteConfirm && (
        <Text color="red">  Press [d] again to confirm, [Esc] to cancel</Text>
      )}
      {deleteMsg && <Text dimColor>  {deleteMsg}</Text>}
    </Box>
  );
}
