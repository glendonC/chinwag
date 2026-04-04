// chinwag_update_activity tool handler.

import * as z from 'zod/v4';
import { setTerminalTitle } from '@chinwag/shared/session-registry.js';
import { teamPreamble } from '../context.js';
import { noTeam, errorResult, appendDegradedWarning } from '../utils/responses.js';
import { normalizeFiles } from '../utils/paths.js';
import {
  TITLE_MAX_LENGTH,
  FILE_PATH_MAX_LENGTH,
  FILE_LIST_MAX,
  SUMMARY_MAX_LENGTH,
} from '../constants.js';
import type { AddToolFn, ToolDeps } from './types.js';

const updateActivitySchema = z.object({
  files: z
    .array(z.string().max(FILE_PATH_MAX_LENGTH))
    .max(FILE_LIST_MAX)
    .describe('File paths being modified'),
  summary: z
    .string()
    .max(SUMMARY_MAX_LENGTH)
    .describe('Brief description, e.g. "Refactoring auth middleware"'),
});
type UpdateActivityArgs = z.infer<typeof updateActivitySchema>;

export function registerActivityTool(
  addTool: AddToolFn,
  { team, state }: Pick<ToolDeps, 'team' | 'state'>,
): void {
  addTool(
    'chinwag_update_activity',
    {
      description:
        'Report what files you are currently working on. IMPORTANT: Call this immediately after chinwag_claim_files to broadcast your activity. Other agents across all tools will see this in their team context.',
      inputSchema: updateActivitySchema,
    },
    async (args) => {
      const { files: rawFiles, summary } = args as UpdateActivityArgs;
      if (!state.teamId) return noTeam(state);
      try {
        const files = normalizeFiles(rawFiles);
        await team.updateActivity(state.teamId, files, summary);
        // Set terminal tab title to the agent's task -- stable identity
        if (state.tty && summary) {
          const label =
            summary.length > TITLE_MAX_LENGTH
              ? summary.slice(0, TITLE_MAX_LENGTH - 1) + '\u2026'
              : summary;
          setTerminalTitle(state.tty, `chinwag \u00B7 ${label}`);
        }
        const preamble = await teamPreamble(team, state.teamId);
        const result = {
          content: [{ type: 'text' as const, text: `${preamble}Activity updated: ${summary}` }],
        };
        return appendDegradedWarning(result, state.heartbeatDead);
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
