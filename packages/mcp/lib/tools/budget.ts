// chinwag_configure_budget tool handler.
//
// Runtime override for per-session context budgets. The resolved budget at
// bootstrap is the merge of hardcoded defaults + team `.chinwag` + user
// `~/.chinwag/config.json`. This tool lets an agent (or human via their agent)
// override any field for the remainder of the session.
//
// Overrides are session-local: they do not persist to disk and reset when the
// MCP server exits. Pass `reset: true` to revert to the bootstrap-resolved values.

import * as z from 'zod/v4';
import {
  parseBudgetConfig,
  resolveBudgets,
  type BudgetConfig,
  type CoordinationBroadcast,
} from '@chinwag/shared/budget-config.js';
import { loadTeamBudgets } from '../team.js';
import { loadConfig } from '../config.js';
import { MEMORY_SEARCH_MAX_LIMIT } from '../constants.js';
import type { AddToolFn, ToolDeps } from './types.js';

const configureBudgetSchema = z.object({
  memoryResultCap: z
    .number()
    .int()
    .min(1)
    .max(MEMORY_SEARCH_MAX_LIMIT)
    .optional()
    .describe(`Max memories per search (1-${MEMORY_SEARCH_MAX_LIMIT}). Lower = less context.`),
  memoryContentTruncation: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Max chars per memory body. 0 = unlimited. Lower = less context per result.'),
  coordinationBroadcast: z
    .enum(['full', 'silent'])
    .optional()
    .describe(
      'Whether chinwag_update_activity broadcasts to teammates. "silent" keeps work local.',
    ),
  reset: z
    .boolean()
    .optional()
    .describe('Clear all runtime overrides and revert to the team/user resolved budgets.'),
});
type ConfigureBudgetArgs = z.infer<typeof configureBudgetSchema>;

function formatBudget(b: BudgetConfig): string {
  const parts: string[] = [
    `memoryResultCap=${b.memoryResultCap}`,
    `memoryContentTruncation=${b.memoryContentTruncation === 0 ? 'unlimited' : b.memoryContentTruncation}`,
    `coordinationBroadcast=${b.coordinationBroadcast}`,
  ];
  return parts.join(', ');
}

/**
 * Re-resolve team + user budgets at runtime. Used on `reset: true` to rewind
 * to the non-runtime layer without remembering the original bootstrap value —
 * this means picking up any edits to `.chinwag` or `~/.chinwag/config.json`
 * made since startup, which is usually what a user wants.
 */
function resolveBaseline(): BudgetConfig {
  const team = loadTeamBudgets();
  const user = parseBudgetConfig((loadConfig() as { budgets?: unknown } | null)?.budgets);
  return resolveBudgets({ team, user });
}

export function registerBudgetTool(addTool: AddToolFn, deps: Pick<ToolDeps, 'state'>): void {
  const { state } = deps;

  addTool(
    'chinwag_configure_budget',
    {
      description:
        'Adjust per-session context budget for chinwag tools. Runtime overrides only — changes revert when the session ends. Call with no arguments to read the current resolved budget. Pass `reset: true` to clear runtime overrides.',
      inputSchema: configureBudgetSchema,
    },
    async (args: Record<string, unknown>) => {
      const parsed = args as ConfigureBudgetArgs;

      if (parsed.reset) {
        state.budgets = resolveBaseline();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Runtime overrides cleared. Budget: ${formatBudget(state.budgets)}`,
            },
          ],
        };
      }

      const overrides: Partial<BudgetConfig> = {};
      if (typeof parsed.memoryResultCap === 'number') {
        overrides.memoryResultCap = parsed.memoryResultCap;
      }
      if (typeof parsed.memoryContentTruncation === 'number') {
        overrides.memoryContentTruncation = parsed.memoryContentTruncation;
      }
      if (parsed.coordinationBroadcast) {
        overrides.coordinationBroadcast = parsed.coordinationBroadcast as CoordinationBroadcast;
      }

      if (Object.keys(overrides).length === 0) {
        return {
          content: [{ type: 'text' as const, text: `Budget: ${formatBudget(state.budgets)}` }],
        };
      }

      state.budgets = { ...state.budgets, ...overrides };
      return {
        content: [
          {
            type: 'text' as const,
            text: `Budget updated. Now: ${formatBudget(state.budgets)}`,
          },
        ],
      };
    },
  );
}
