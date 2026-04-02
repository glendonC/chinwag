import React from 'react';
import { Box, Text } from 'ink';
import { getAnimatedGlyph } from './ui.jsx';
import { truncateText } from './utils.js';

function shortSessionId(agentId) {
  if (!agentId) return '';
  const parts = agentId.split(':');
  if (parts.length >= 3) return parts[2].slice(0, 4);
  if (parts.length >= 2) return parts[1].slice(0, 4);
  return '';
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
