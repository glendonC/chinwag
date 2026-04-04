// chinwag memory tool handlers:
// chinwag_save_memory, chinwag_update_memory, chinwag_search_memory, chinwag_delete_memory

import * as z from 'zod/v4';
import { teamPreamble } from '../context.js';
import { noTeam, errorResult, safeArray, appendDegradedWarning } from '../utils/responses.js';
import type { MemoryInfo } from '../utils/display.js';
import {
  MEMORY_TEXT_MAX_LENGTH,
  TAG_MAX_LENGTH,
  TAG_LIST_MAX,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_LIMIT_MAX,
} from '../constants.js';
import type { AddToolFn, ToolDeps } from './types.js';

const saveMemorySchema = z.object({
  text: z
    .string()
    .max(MEMORY_TEXT_MAX_LENGTH)
    .describe('The knowledge to save. Be specific and actionable.'),
  tags: z
    .array(z.string().max(TAG_MAX_LENGTH))
    .max(TAG_LIST_MAX)
    .optional()
    .describe(
      'Optional tags for organization (e.g. ["setup", "redis", "testing"]). Use whatever labels make sense.',
    ),
});
type SaveMemoryArgs = z.infer<typeof saveMemorySchema>;

const updateMemorySchema = z.object({
  id: z.string().describe('Memory ID to update (UUID format, get from chinwag_search_memory)'),
  text: z.string().max(MEMORY_TEXT_MAX_LENGTH).optional().describe('Updated text content'),
  tags: z
    .array(z.string().max(TAG_MAX_LENGTH))
    .max(TAG_LIST_MAX)
    .optional()
    .describe('Updated tags'),
});
type UpdateMemoryArgs = z.infer<typeof updateMemorySchema>;

const searchMemorySchema = z.object({
  query: z
    .string()
    .max(SEARCH_QUERY_MAX_LENGTH)
    .optional()
    .describe('Search text (matches against memory content)'),
  tags: z
    .array(z.string().max(TAG_MAX_LENGTH))
    .max(TAG_LIST_MAX)
    .optional()
    .describe('Filter by tags (returns memories matching ANY of the listed tags)'),
  limit: z.number().min(1).max(SEARCH_LIMIT_MAX).optional().describe('Max results (default 20)'),
});
type SearchMemoryArgs = z.infer<typeof searchMemorySchema>;

const deleteMemorySchema = z.object({
  id: z.string().describe('Memory ID to delete (UUID format, get from chinwag_search_memory)'),
});
type DeleteMemoryArgs = z.infer<typeof deleteMemorySchema>;

export function registerMemoryTools(
  addTool: AddToolFn,
  { team, state }: Pick<ToolDeps, 'team' | 'state'>,
): void {
  addTool(
    'chinwag_save_memory',
    {
      description:
        'Save project knowledge that persists across sessions and is shared with all agents on the team. Store anything worth remembering: setup requirements, conventions, architecture decisions, gotchas, useful links, or context that would help a future agent working in this codebase. You decide what to store and how to tag it.',
      inputSchema: saveMemorySchema,
    },
    async (args) => {
      const { text, tags } = args as SaveMemoryArgs;
      if (!state.teamId) return noTeam(state);
      try {
        await team.saveMemory(state.teamId, text, tags);
        const preamble = await teamPreamble(team, state.teamId);
        const tagStr = tags?.length ? ` [${tags.join(', ')}]` : '';
        return appendDegradedWarning(
          {
            content: [{ type: 'text' as const, text: `${preamble}Memory saved${tagStr}: ${text}` }],
          },
          state.heartbeatDead,
        );
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );

  addTool(
    'chinwag_update_memory',
    {
      description:
        'Update an existing team memory. Use chinwag_search_memory first to find the ID. Any team member can update any memory -- memories are team knowledge. Use this to correct, improve, or re-tag knowledge without creating duplicates.',
      inputSchema: updateMemorySchema,
    },
    async (args) => {
      const { id, text, tags } = args as UpdateMemoryArgs;
      if (!state.teamId) return noTeam(state);
      if (!text && !tags) {
        return {
          content: [
            { type: 'text' as const, text: 'Provide at least one of text or tags to update.' },
          ],
          isError: true,
        };
      }
      try {
        const result = await team.updateMemory(state.teamId, id, text, tags);
        if (!result.ok) {
          return {
            content: [
              { type: 'text' as const, text: `Failed to update memory ${id}: ${result.error}` },
            ],
            isError: true,
          };
        }
        const preamble = await teamPreamble(team, state.teamId);
        const parts: string[] = [];
        if (text) parts.push('text updated');
        if (tags) parts.push(`tags \u2192 ${tags.join(', ')}`);
        return appendDegradedWarning(
          {
            content: [
              {
                type: 'text' as const,
                text: `${preamble}Memory ${id} updated (${parts.join(', ')}).`,
              },
            ],
          },
          state.heartbeatDead,
        );
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );

  addTool(
    'chinwag_search_memory',
    {
      description:
        'Search team project memories by keyword and/or tags. Use this to find knowledge the team has saved before starting work or when you need context.',
      inputSchema: searchMemorySchema,
    },
    async (args) => {
      const { query, tags, limit } = args as SearchMemoryArgs;
      if (!state.teamId) return noTeam(state);
      try {
        const result = await team.searchMemories(state.teamId, query, tags, limit);
        const memories = safeArray<MemoryInfo>(result, 'memories');
        if (memories.length === 0) {
          return appendDegradedWarning(
            { content: [{ type: 'text' as const, text: 'No memories found.' }] },
            state.heartbeatDead,
          );
        }
        const lines = memories.map((m) => {
          const tagStr = m.tags?.length ? ` [${m.tags.join(', ')}]` : '';
          return `${m.text}${tagStr} (id: ${m.id}, by ${m.handle})`;
        });
        return appendDegradedWarning(
          { content: [{ type: 'text' as const, text: lines.join('\n') }] },
          state.heartbeatDead,
        );
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );

  addTool(
    'chinwag_delete_memory',
    {
      description:
        'Delete a team memory by ID. Use chinwag_search_memory first to find the ID of the memory to delete. Use this to remove outdated, incorrect, or redundant knowledge.',
      inputSchema: deleteMemorySchema,
    },
    async (args) => {
      const { id } = args as DeleteMemoryArgs;
      if (!state.teamId) return noTeam(state);
      try {
        const result = await team.deleteMemory(state.teamId, id);
        if (!result.ok) {
          return {
            content: [
              { type: 'text' as const, text: `Failed to delete memory ${id}: ${result.error}` },
            ],
            isError: true,
          };
        }
        return appendDegradedWarning(
          { content: [{ type: 'text' as const, text: `Memory ${id} deleted.` }] },
          state.heartbeatDead,
        );
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
