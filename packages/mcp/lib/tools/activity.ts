// chinwag_update_activity tool handler.

import * as z from 'zod/v4';
import { setTerminalTitle } from '@chinwag/shared/session-registry.js';
import { teamPreamble } from '../context.js';
import { noTeam, errorResult } from '../utils/responses.js';
import type { AddToolFn, ToolDeps } from './types.js';

export function registerActivityTool(
  addTool: AddToolFn,
  { team, state }: Pick<ToolDeps, 'team' | 'state'>,
): void {
  addTool(
    'chinwag_update_activity',
    {
      description:
        'Report what files you are currently working on. IMPORTANT: Call this immediately after chinwag_claim_files to broadcast your activity. Other agents across all tools will see this in their team context.',
      inputSchema: z.object({
        files: z.array(z.string().max(500)).max(100).describe('File paths being modified'),
        summary: z
          .string()
          .max(280)
          .describe('Brief description, e.g. "Refactoring auth middleware"'),
      }),
    },
    async ({ files, summary }: { files: string[]; summary: string }) => {
      if (!state.teamId) return noTeam();
      try {
        await team.updateActivity(state.teamId, files, summary);
        // Set terminal tab title to the agent's task -- stable identity
        if (state.tty && summary) {
          const TITLE_MAX = 40;
          const label =
            summary.length > TITLE_MAX ? summary.slice(0, TITLE_MAX - 1) + '\u2026' : summary;
          setTerminalTitle(state.tty, `chinwag \u00B7 ${label}`);
        }
        const preamble = await teamPreamble(team, state.teamId);
        return {
          content: [{ type: 'text' as const, text: `${preamble}Activity updated: ${summary}` }],
        };
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
