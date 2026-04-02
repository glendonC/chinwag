// chinwag memory tool handlers:
// chinwag_save_memory, chinwag_update_memory, chinwag_search_memory, chinwag_delete_memory

import * as z from 'zod/v4';
import { withTeam } from './index.js';

export function registerMemoryTools(addTool, deps) {
  const { team, state } = deps;

  addTool(
    'chinwag_save_memory',
    {
      description:
        'Save project knowledge that persists across sessions and is shared with all agents on the team. Store anything worth remembering: setup requirements, conventions, architecture decisions, gotchas, useful links, or context that would help a future agent working in this codebase. You decide what to store and how to tag it.',
      inputSchema: z.object({
        text: z.string().max(2000).describe('The knowledge to save. Be specific and actionable.'),
        tags: z
          .array(z.string().max(50))
          .max(10)
          .optional()
          .describe(
            'Optional tags for organization (e.g. ["setup", "redis", "testing"]). Use whatever labels make sense.',
          ),
      }),
    },
    withTeam(deps, async ({ text, tags }, { preamble }) => {
      await team.saveMemory(state.teamId, text, tags);
      const tagStr = tags?.length ? ` [${tags.join(', ')}]` : '';
      return { content: [{ type: 'text', text: `${preamble}Memory saved${tagStr}: ${text}` }] };
    }),
  );

  addTool(
    'chinwag_update_memory',
    {
      description:
        'Update an existing team memory. Use chinwag_search_memory first to find the ID. Any team member can update any memory — memories are team knowledge. Use this to correct, improve, or re-tag knowledge without creating duplicates.',
      inputSchema: z.object({
        id: z
          .string()
          .describe('Memory ID to update (UUID format, get from chinwag_search_memory)'),
        text: z.string().max(2000).optional().describe('Updated text content'),
        tags: z.array(z.string().max(50)).max(10).optional().describe('Updated tags'),
      }),
    },
    withTeam(deps, async ({ id, text, tags }, { preamble }) => {
      if (!text && !tags) {
        return {
          content: [{ type: 'text', text: 'Provide at least one of text or tags to update.' }],
          isError: true,
        };
      }
      const result = await team.updateMemory(state.teamId, id, text, tags);
      if (result.error) {
        return {
          content: [{ type: 'text', text: `Failed to update memory ${id}: ${result.error}` }],
          isError: true,
        };
      }
      const parts = [];
      if (text) parts.push('text updated');
      if (tags) parts.push(`tags \u2192 ${tags.join(', ')}`);
      return {
        content: [{ type: 'text', text: `${preamble}Memory ${id} updated (${parts.join(', ')}).` }],
      };
    }),
  );

  addTool(
    'chinwag_search_memory',
    {
      description:
        'Search team project memories by keyword and/or tags. Use this to find knowledge the team has saved before starting work or when you need context.',
      inputSchema: z.object({
        query: z
          .string()
          .max(200)
          .optional()
          .describe('Search text (matches against memory content)'),
        tags: z
          .array(z.string().max(50))
          .max(10)
          .optional()
          .describe('Filter by tags (returns memories matching ANY of the listed tags)'),
        limit: z.number().min(1).max(50).optional().describe('Max results (default 20)'),
      }),
    },
    withTeam(
      deps,
      async ({ query, tags, limit }) => {
        const result = await team.searchMemories(state.teamId, query, tags, limit);
        if (!result.memories || result.memories.length === 0) {
          return { content: [{ type: 'text', text: 'No memories found.' }] };
        }
        const lines = result.memories.map((m) => {
          const tagStr = m.tags?.length ? ` [${m.tags.join(', ')}]` : '';
          return `${m.text}${tagStr} (id: ${m.id}, by ${m.handle || m.source_handle})`;
        });
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      },
      { skipPreamble: true },
    ),
  );

  addTool(
    'chinwag_delete_memory',
    {
      description:
        'Delete a team memory by ID. Use chinwag_search_memory first to find the ID of the memory to delete. Use this to remove outdated, incorrect, or redundant knowledge.',
      inputSchema: z.object({
        id: z
          .string()
          .describe('Memory ID to delete (UUID format, get from chinwag_search_memory)'),
      }),
    },
    withTeam(
      deps,
      async ({ id }) => {
        const result = await team.deleteMemory(state.teamId, id);
        if (result.error) {
          return {
            content: [{ type: 'text', text: `Failed to delete memory ${id}: ${result.error}` }],
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: `Memory ${id} deleted.` }] };
      },
      { skipPreamble: true },
    ),
  );
}
