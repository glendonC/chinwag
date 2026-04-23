// chinmeister memory tool handlers:
// chinmeister_save_memory, chinmeister_update_memory, chinmeister_search_memory, chinmeister_delete_memory

import * as z from 'zod/v4';
import { safeArray, withTimeout } from '../utils/responses.js';
import type { MemoryInfo } from '../utils/display.js';
import {
  MAX_MEMORY_TEXT_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_MEMORY,
  SEARCH_QUERY_MAX_LENGTH,
  MEMORY_SEARCH_MAX_LIMIT,
  API_TIMEOUT_MS,
} from '../constants.js';
import { BUDGET_DEFAULTS, truncateMemoryText } from '@chinmeister/shared/budget-config.js';
import { withTeam } from './middleware.js';
import type { AddToolFn, ToolDeps } from './types.js';

const saveMemorySchema = z.object({
  text: z
    .string()
    .max(MAX_MEMORY_TEXT_LENGTH)
    .describe('The knowledge to save. Be specific and actionable.'),
  tags: z
    .array(z.string().max(MAX_TAG_LENGTH))
    .max(MAX_TAGS_PER_MEMORY)
    .optional()
    .describe(
      'Optional tags for organization (e.g. ["setup", "redis", "testing"]). Use whatever labels make sense.',
    ),
});
type SaveMemoryArgs = z.infer<typeof saveMemorySchema>;

const updateMemorySchema = z.object({
  id: z.string().describe('Memory ID to update (UUID format, get from chinmeister_search_memory)'),
  text: z.string().max(MAX_MEMORY_TEXT_LENGTH).optional().describe('Updated text content'),
  tags: z
    .array(z.string().max(MAX_TAG_LENGTH))
    .max(MAX_TAGS_PER_MEMORY)
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
    .array(z.string().max(MAX_TAG_LENGTH))
    .max(MAX_TAGS_PER_MEMORY)
    .optional()
    .describe('Filter by tags (returns memories matching ANY of the listed tags)'),
  session_id: z.string().optional().describe('Filter by session ID'),
  agent_id: z.string().optional().describe('Filter by agent ID'),
  handle: z.string().optional().describe('Filter by author handle'),
  after: z.string().optional().describe('Only memories created after this ISO date'),
  before: z.string().optional().describe('Only memories created before this ISO date'),
  limit: z
    .number()
    .min(1)
    .max(MEMORY_SEARCH_MAX_LIMIT)
    .optional()
    .describe('Max results (default 20)'),
});
type SearchMemoryArgs = z.infer<typeof searchMemorySchema>;

const deleteMemorySchema = z.object({
  id: z.string().describe('Memory ID to delete (UUID format, get from chinmeister_search_memory)'),
});
type DeleteMemoryArgs = z.infer<typeof deleteMemorySchema>;

const batchDeleteSchema = z.object({
  ids: z.array(z.string()).max(100).optional().describe('Memory IDs to delete'),
  tags: z.array(z.string()).optional().describe('Delete memories matching ANY of these tags'),
  before: z.string().optional().describe('Delete memories created before this ISO date'),
});
type BatchDeleteArgs = z.infer<typeof batchDeleteSchema>;

const reviewProposalsSchema = z.object({
  limit: z.number().min(1).max(200).optional().describe('Max proposals to return (default 50)'),
});
type ReviewProposalsArgs = z.infer<typeof reviewProposalsSchema>;

const applyProposalSchema = z.object({
  proposal_id: z.string().describe('Proposal ID from chinmeister_review_consolidation_proposals'),
});
type ApplyProposalArgs = z.infer<typeof applyProposalSchema>;

const unmergeSchema = z.object({
  memory_id: z
    .string()
    .describe('Memory ID to restore (was merged into another via consolidation)'),
});
type UnmergeArgs = z.infer<typeof unmergeSchema>;

const formationSweepSchema = z.object({
  limit: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .describe('How many recent un-classified memories to process (default 20, max 50)'),
});
type FormationSweepArgs = z.infer<typeof formationSweepSchema>;

const formationListSchema = z.object({
  recommendation: z
    .enum(['keep', 'merge', 'evolve', 'discard'])
    .optional()
    .describe('Filter by what the LLM recommended'),
  limit: z.number().min(1).max(200).optional().describe('Max observations to return (default 50)'),
});
type FormationListArgs = z.infer<typeof formationListSchema>;

export function registerMemoryTools(
  addTool: AddToolFn,
  deps: Pick<ToolDeps, 'team' | 'state'>,
): void {
  const { team, state } = deps;

  addTool(
    'chinmeister_save_memory',
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
    'chinmeister_update_memory',
    {
      description:
        'Update an existing team memory. Use chinmeister_search_memory first to find the ID. Any team member can update any memory -- memories are team knowledge. Use this to correct, improve, or re-tag knowledge without creating duplicates.',
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
    'chinmeister_search_memory',
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
        // Apply budget: the agent can request fewer results, but never more
        // than the resolved team/user/runtime cap. Omitting `limit` defaults
        // to the cap itself so context stays bounded.
        const budgets = state.budgets ?? BUDGET_DEFAULTS;
        const cap = budgets.memoryResultCap;
        const effectiveLimit = typeof limit === 'number' ? Math.min(limit, cap) : cap;
        const result = await withTimeout(
          team.searchMemories(state.teamId!, query, tags, undefined, effectiveLimit, {
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
        const truncation = budgets.memoryContentTruncation;
        const lines = memories.map((m) => {
          const tagStr = m.tags?.length ? ` [${m.tags.join(', ')}]` : '';
          const body = truncateMemoryText(m.text, truncation);
          return `${body}${tagStr} (id: ${m.id}, by ${m.handle})`;
        });
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      },
      { skipPreamble: true },
    ),
  );

  addTool(
    'chinmeister_delete_memory',
    {
      description:
        'Delete a team memory by ID. Use chinmeister_search_memory first to find the ID of the memory to delete. Use this to remove outdated, incorrect, or redundant knowledge.',
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
    'chinmeister_delete_memories_batch',
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

  addTool(
    'chinmeister_review_consolidation_proposals',
    {
      description:
        'List pending consolidation proposals — pairs of memories that look like duplicates (cosine similarity + lexical overlap + tag-set agreement). Each proposal shows both memories side-by-side so you can decide whether to apply (merge) or reject. Nothing merges automatically.',
      inputSchema: reviewProposalsSchema,
    },
    withTeam(
      deps,
      async (args) => {
        const { limit } = args as ReviewProposalsArgs;
        const result = await withTimeout(
          team.listConsolidationProposals(state.teamId!, limit),
          API_TIMEOUT_MS,
        );
        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: `Failed to load proposals: ${result.error}` }],
            isError: true,
          };
        }
        const proposals = result.proposals || [];
        if (proposals.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No pending consolidation proposals. Run consolidation periodically to surface candidates.',
              },
            ],
          };
        }
        const lines = proposals.map((p) => {
          const cosine = (p.cosine * 100).toFixed(1);
          const jaccard = (p.jaccard * 100).toFixed(1);
          return [
            `[${p.id}] cosine ${cosine}% / jaccard ${jaccard}%`,
            `  source (${p.source_id}): ${p.source_text.slice(0, 120)}`,
            `  target (${p.target_id}): ${p.target_text.slice(0, 120)}`,
          ].join('\n');
        });
        return { content: [{ type: 'text' as const, text: lines.join('\n\n') }] };
      },
      { skipPreamble: true },
    ),
  );

  addTool(
    'chinmeister_apply_consolidation',
    {
      description:
        'Apply a consolidation proposal — soft-merges the source memory into the target. The source stays in the database with a merged_into pointer; search excludes it. Reversible via chinmeister_unmerge_memory.',
      inputSchema: applyProposalSchema,
    },
    withTeam(deps, async (args, { preamble }) => {
      const { proposal_id } = args as ApplyProposalArgs;
      const result = await withTimeout(
        team.applyConsolidationProposal(state.teamId!, proposal_id),
        API_TIMEOUT_MS,
      );
      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: `Failed to apply proposal: ${result.error}` }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `${preamble}Merged ${result.source_id} into ${result.target_id}. Reversible via chinmeister_unmerge_memory.`,
          },
        ],
      };
    }),
  );

  addTool(
    'chinmeister_run_formation_sweep',
    {
      description:
        'Run shadow-mode formation auditor on recent memories. For each unclassified memory, an LLM looks at the top-5 cosine-similar neighbours and records whether the new memory should be kept, merged, evolved, or discarded. Recommendations are observability only — nothing applies automatically. Use this periodically to audit memory quality and tune consolidation thresholds.',
      inputSchema: formationSweepSchema,
    },
    withTeam(deps, async (args, { preamble }) => {
      const { limit } = args as FormationSweepArgs;
      const result = await withTimeout(
        team.runFormationSweep(state.teamId!, limit),
        API_TIMEOUT_MS * 6, // sweeps over multiple memories with LLM calls
      );
      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: `Formation sweep failed: ${result.error}` }],
          isError: true,
        };
      }
      const processed = result.processed ?? 0;
      const skipped = result.skipped ?? 0;
      return {
        content: [
          {
            type: 'text' as const,
            text: `${preamble}Formation sweep: ${processed} processed, ${skipped} skipped.`,
          },
        ],
      };
    }),
  );

  addTool(
    'chinmeister_review_formation_observations',
    {
      description:
        'List recent formation observations — what the auditor LLM thought about each memory (keep / merge / evolve / discard). Filter by recommendation to focus on flagged cases. Recommendations are observability; apply consolidation explicitly via chinmeister_apply_consolidation if you agree.',
      inputSchema: formationListSchema,
    },
    withTeam(
      deps,
      async (args) => {
        const { recommendation, limit } = args as FormationListArgs;
        const filter: { recommendation?: 'keep' | 'merge' | 'evolve' | 'discard'; limit?: number } =
          {};
        if (recommendation) filter.recommendation = recommendation;
        if (limit) filter.limit = limit;
        const result = await withTimeout(
          team.listFormationObservations(state.teamId!, filter),
          API_TIMEOUT_MS,
        );
        if (!result.ok) {
          return {
            content: [
              { type: 'text' as const, text: `Failed to load observations: ${result.error}` },
            ],
            isError: true,
          };
        }
        const obs = result.observations || [];
        if (obs.length === 0) {
          const filtered = recommendation ? ` matching ${recommendation}` : '';
          return {
            content: [
              {
                type: 'text' as const,
                text: `No formation observations${filtered}. Run chinmeister_run_formation_sweep to populate.`,
              },
            ],
          };
        }
        const lines = obs.map((o) => {
          const target = o.target_id ? ` -> ${o.target_id}` : '';
          const conf = typeof o.confidence === 'number' ? ` (conf ${o.confidence.toFixed(2)})` : '';
          const reason = o.llm_reason ? ` — ${o.llm_reason}` : '';
          return `[${o.recommendation}${conf}] memory ${o.memory_id}${target}${reason}`;
        });
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      },
      { skipPreamble: true },
    ),
  );

  addTool(
    'chinmeister_unmerge_memory',
    {
      description:
        "Restore a memory that was soft-merged by consolidation. Clears the merged_into pointer so search picks it up again. Use this when consolidation absorbed a memory it shouldn't have.",
      inputSchema: unmergeSchema,
    },
    withTeam(deps, async (args, { preamble }) => {
      const { memory_id } = args as UnmergeArgs;
      const result = await withTimeout(
        team.unmergeMemory(state.teamId!, memory_id),
        API_TIMEOUT_MS,
      );
      if (!result.ok) {
        return {
          content: [
            { type: 'text' as const, text: `Failed to unmerge ${memory_id}: ${result.error}` },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: `${preamble}Memory ${memory_id} restored.` }],
      };
    }),
  );
}
