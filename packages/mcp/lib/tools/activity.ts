// chinwag_update_activity tool handler.

import * as z from 'zod/v4';
import { setTerminalTitle } from '@chinwag/shared/session-registry.js';
import { BUDGET_DEFAULTS } from '@chinwag/shared/budget-config.js';
import { normalizeFiles } from '../utils/paths.js';
import { withTimeout } from '../utils/responses.js';
import {
  TITLE_MAX_LENGTH,
  MAX_FILE_PATH_LENGTH,
  FILE_LIST_MAX,
  MAX_SUMMARY_LENGTH,
  API_TIMEOUT_MS,
} from '../constants.js';
import { withTeam } from './middleware.js';
import type { AddToolFn, ToolDeps } from './types.js';

const updateActivitySchema = z.object({
  files: z
    .array(z.string().max(MAX_FILE_PATH_LENGTH))
    .max(FILE_LIST_MAX)
    .describe('File paths being modified'),
  summary: z
    .string()
    .max(MAX_SUMMARY_LENGTH)
    .describe('Brief description, e.g. "Refactoring auth middleware"'),
});
type UpdateActivityArgs = z.infer<typeof updateActivitySchema>;

export function registerActivityTool(
  addTool: AddToolFn,
  deps: Pick<ToolDeps, 'team' | 'state'>,
): void {
  const { team, state } = deps;

  addTool(
    'chinwag_update_activity',
    {
      description:
        'Report what files you are currently working on. IMPORTANT: Call this immediately after chinwag_claim_files to broadcast your activity. Other agents across all tools will see this in their team context.',
      inputSchema: updateActivitySchema,
    },
    withTeam(deps, async (args, { preamble }) => {
      const { files: rawFiles, summary } = args as UpdateActivityArgs;
      const files = normalizeFiles(rawFiles);
      // Silent mode: skip the backend broadcast but still update local terminal
      // title so the developer's own environment reflects their intent.
      const budgets = state.budgets ?? BUDGET_DEFAULTS;
      const silent = budgets.coordinationBroadcast === 'silent';
      if (!silent) {
        await withTimeout(team.updateActivity(state.teamId!, files, summary), API_TIMEOUT_MS);
      }
      // Set terminal tab title to the agent's task -- stable identity
      if (state.tty && summary) {
        const label =
          summary.length > TITLE_MAX_LENGTH
            ? summary.slice(0, TITLE_MAX_LENGTH - 1) + '\u2026'
            : summary;
        setTerminalTitle(state.tty, `chinwag \u00B7 ${label}`);
      }
      const suffix = silent ? ' (local only; team broadcast disabled)' : '';
      return {
        content: [
          { type: 'text' as const, text: `${preamble}Activity updated: ${summary}${suffix}` },
        ],
      };
    }),
  );
}
