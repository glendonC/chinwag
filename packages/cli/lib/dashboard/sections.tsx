import React from 'react';
import { Box, Text } from 'ink';
import { getAnimatedGlyph } from './ui.jsx';
import { truncateText } from './utils.js';
import type { CombinedAgentRow, MemoryEntry } from './view.js';

function shortSessionId(agentId: string | null | undefined): string {
  if (!agentId) return '';
  const parts = agentId.split(':');
  if (parts.length >= 3 && parts[2]) return parts[2].slice(0, 4);
  if (parts.length >= 2 && parts[1]) return parts[1].slice(0, 4);
  return '';
}

interface SessionsPanelProps {
  liveAgents: CombinedAgentRow[];
  totalCount?: number;
  windowStart?: number;
  selectedIdx: number;
  getAgentIntent: (agent: CombinedAgentRow) => string | null;
  cols: number;
}

export function SessionsPanel({
  liveAgents,
  totalCount = liveAgents.length,
  windowStart = 0,
  selectedIdx,
  getAgentIntent,
  cols,
}: SessionsPanelProps): React.ReactNode {
  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      <Text>
        <Text color="cyan" bold>
          Sessions
        </Text>
        <Text dimColor> {totalCount} active</Text>
      </Text>
      {liveAgents.map((agent, idx) => {
        const absoluteIdx = windowStart + idx;
        const isSelected = absoluteIdx === selectedIdx;
        const intent = truncateText(getAgentIntent(agent), cols - 10);
        const sessionTag = shortSessionId(agent.agent_id);
        return (
          <Box key={agent.agent_id || agent.id} flexDirection="column">
            <Text>
              <Text color={isSelected ? 'cyan' : 'green'}>
                {' '}
                {isSelected ? getAnimatedGlyph('selected') : getAnimatedGlyph('running')}{' '}
              </Text>
              <Text bold>{agent._display}</Text>
              {sessionTag ? <Text dimColor> #{sessionTag}</Text> : null}
              {agent._duration ? <Text dimColor> {agent._duration}</Text> : null}
            </Text>
            {intent ? <Text dimColor> {intent}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

interface KnowledgePanelProps {
  memories: MemoryEntry[];
  filteredMemories: MemoryEntry[];
  knowledgeVisible: MemoryEntry[];
  windowStart?: number;
  memorySearch: string;
  memorySelectedIdx: number;
  deleteConfirm: boolean;
  deleteMsg: string | null;
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
}: KnowledgePanelProps): React.ReactNode {
  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      <Text>
        <Text color="magenta" bold>
          Knowledge
        </Text>
        <Text dimColor> {memories.length} saved</Text>
        {memorySearch ? <Text color="yellow"> &quot;{memorySearch}&quot;</Text> : null}
      </Text>
      {filteredMemories.length === 0 ? (
        <Text dimColor> No matches for &quot;{memorySearch}&quot;.</Text>
      ) : (
        <>
          {knowledgeVisible.map((mem, idx) => {
            const tagStr = mem.tags?.length ? `[${mem.tags.join(', ')}]` : '';
            const absoluteIdx = windowStart + idx;
            const isSelected = absoluteIdx === memorySelectedIdx;
            return (
              <Text key={mem.id || idx}>
                {isSelected ? (
                  <Text color="cyan"> {getAnimatedGlyph('selected')} </Text>
                ) : (
                  <Text>{'  '}</Text>
                )}
                {tagStr && <Text dimColor>{tagStr} </Text>}
                <Text>{mem.text}</Text>
                {isSelected && mem.handle && <Text dimColor> - {mem.handle}</Text>}
              </Text>
            );
          })}
        </>
      )}
      {deleteConfirm && <Text color="red"> Press [d] again to confirm, [Esc] to cancel</Text>}
      {deleteMsg && <Text dimColor> {deleteMsg}</Text>}
    </Box>
  );
}
