// chinwag memory tool handlers:
// chinwag_save_memory, chinwag_update_memory, chinwag_search_memory, chinwag_delete_memory

import * as z from 'zod/v4';
import { safeArray, withTimeout } from '../utils/responses.js';
import type { MemoryInfo } from '../utils/display.js';
import {
  MEMORY_TEXT_MAX_LENGTH,
  TAG_MAX_LENGTH,
  TAG_LIST_MAX,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_LIMIT_MAX,
  API_TIMEOUT_MS,
} from '../constants.js';
import { withTeam } from './middleware.js';
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
  session_id: z.string().optional().describe('Filter by session ID'),
  agent_id: z.string().optional().describe('Filter by agent ID'),
  handle: z.string().optional().describe('Filter by author handle'),
  after: z.string().optional().describe('Only memories created after this ISO date'),
  before: z.string().optional().describe('Only memories created before this ISO date'),
  limit: z.number().min(1).max(SEARCH_LIMIT_MAX).optional().describe('Max results (default 20)'),
});
type SearchMemoryArgs = z.infer<typeof searchMemorySchema>;

const deleteMemorySchema = z.object({
  id: z.string().describe('Memory ID to delete (UUID format, get from chinwag_search_memory)'),
});
type DeleteMemoryArgs = z.infer<typeof deleteMemorySchema>;

const batchDeleteSchema = z.object({
  ids: z.array(z.string()).max(100).optional().describe('Memory IDs to delete'),
  tags: z.array(z.string()).optional().describe('Delete memories matching ANY of these tags'),
  before: z.string().optional().describe('Delete memories created before this ISO date'),
});
type BatchDeleteArgs = z.infer<typeof batchDeleteSchema>;

export function registerMemoryTools(
  addTool: AddToolFn,
  deps: Pick<ToolDeps, 'team' | 'state'>,
): void {
  const { team, state } = deps;

  addTool(
    'chinwag_save_memory',
    {
      description:
        'Save project knowledge that persists across sessions and is shared with all agents on the team. Store anything worth remembering: setup requirements, conventions, architecture decisions, gotchas, useful links, or context that would help a future agent working in this codebase. You decide what to store and how to tag it.',
      inputSchema: saveMemorySchema,
    },
    withTeam(deps, async (args, { preamble }) => {
      const { text, tags } = args as SaveMemoryArgs;
      await withTimeout(team.saveMemory(state.teamId!, text, tags), API_TIMEOUT_MS);
      const tagStr = tags?.length ? ` [${tags.join(', ')}]` : '';
      return {
        content: [{ type: 'text' as const, text: `${preamble}Memory saved${tagStr}: ${text}` }],
      };
    }),
  );

  addTool(
    'chinwag_update_memory',
    {
      description:
        'Update an existing team memory. Use chinwag_search_memory first to find the ID. Any team member can update any memory -- memories are team knowledge. Use this to correct, improve, or re-tag knowledge without creating duplicates.',
      inputSchema: updateMemorySchema,
    },
    withTeam(deps, async (args, { preamble }) => {
      const { id, text, tags } = args as UpdateMemoryArgs;
      if (!text && !tags) {
        return {
          content: [
            { type: 'text' as const, text: 'Provide at least one of text or tags to update.' },
          ],
          isError: true,
        };
      }
      const result = await withTimeout(
        team.updateMemory(state.teamId!, id, text, tags),
        API_TIMEOUT_MS,
      );
      if (!result.ok) {
        return {
          content: [
            { type: 'text' as const, text: `Failed to update memory ${id}: ${result.error}` },
          ],
          isError: true,
        };
      }
      const parts: string[] = [];
      if (text) parts.push('text updated');
      if (tags) parts.push(`tags \u2192 ${tags.join(', ')}`);
      return {
        content: [
          {
            type: 'text' as const,
            text: `${preamble}Memory ${id} updated (${parts.join(', ')}).`,
          },
        ],
      };
    }),
  );

  addTool(
    'chinwag_search_memory',
    {
      description:
        'Search team project memories by keyword and/or tags. Use this to find knowledge the team has saved before starting work or when you need context.',
      inputSchema: searchMemorySchema,
    },
    withTeam(
      deps,
      async (args) => {
        const { query, tags, session_id, agent_id, handle, after, before, limit } =
          args as SearchMemoryArgs;
        const result = await withTimeout(
          team.searchMemories(state.teamId!, query, tags, undefined, limit, {
            sessionId: session_id,
            agentId: agent_id,
            handle,
            after,
            before,
          }),
          API_TIMEOUT_MS,
        );
        const memories = safeArray<MemoryInfo>(result, 'memories');
        if (memories.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No memories found.' }] };
        }
        const lines = memories.map((m) => {
          const tagStr = m.tags?.length ? ` [${m.tags.join(', ')}]` : '';
          return `${m.text}${tagStr} (id: ${m.id}, by ${m.handle})`;
        });
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      },
      { skipPreamble: true },
    ),
  );

  addTool(
    'chinwag_delete_memory',
    {
      description:
        'Delete a team memory by ID. Use chinwag_search_memory first to find the ID of the memory to delete. Use this to remove outdated, incorrect, or redundant knowledge.',
      inputSchema: deleteMemorySchema,
    },
    withTeam(
      deps,
      async (args) => {
        const { id } = args as DeleteMemoryArgs;
        const result = await withTimeout(team.deleteMemory(state.teamId!, id), API_TIMEOUT_MS);
        if (!result.ok) {
          return {
            content: [
              { type: 'text' as const, text: `Failed to delete memory ${id}: ${result.error}` },
            ],
            isError: true,
          };
        }
        return { content: [{ type: 'text' as const, text: `Memory ${id} deleted.` }] };
      },
      { skipPreamble: true },
    ),
  );

  addTool(
    'chinwag_delete_memories_batch',
    {
      description:
        'Delete multiple memories at once. Provide IDs, tags, and/or a before-date filter. Use this for bulk cleanup of outdated or redundant knowledge.',
      inputSchema: batchDeleteSchema,
    },
    withTeam(
      deps,
      async (args) => {
        const { ids, tags, before } = args as BatchDeleteArgs;
        if (!ids?.length && !tags?.length && !before) {
          return {
            content: [
              { type: 'text' as const, text: 'Provide at least one of ids, tags, or before.' },
            ],
            isError: true,
          };
        }
        const filter: Record<string, unknown> = {};
        if (ids?.length) filter.ids = ids;
        if (tags?.length) filter.tags = tags;
        if (before) filter.before = before;
        const result = await withTimeout(
          team.deleteMemoriesBatch(
            state.teamId!,
            filter as { ids?: string[]; tags?: string[]; before?: string },
          ),
          API_TIMEOUT_MS,
        );
        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: `Batch delete failed: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text' as const, text: `Deleted ${result.deleted || 0} memories.` }],
        };
      },
      { skipPreamble: true },
    ),
  );
}
