// chinwag_update_activity tool handler.

import * as z from 'zod/v4';
import { setTerminalTitle } from '@chinwag/shared/session-registry.js';
import { withTeam } from './index.js';

export function registerActivityTool(addTool, deps) {
  const { team, state } = deps;

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
    withTeam(deps, async ({ files, summary }, { preamble }) => {
      await team.updateActivity(state.teamId, files, summary);
      // Set terminal tab title to the agent's task — stable identity
      if (state.tty && summary) {
        const label = summary.length > 40 ? summary.slice(0, 39) + '\u2026' : summary;
        setTerminalTitle(state.tty, `chinwag \u00B7 ${label}`);
      }
      return { content: [{ type: 'text', text: `${preamble}Activity updated: ${summary}` }] };
    }),
  );
}
