// chinwag_claim_files and chinwag_release_files tool handlers.

import * as z from 'zod/v4';
import { formatWho } from '../utils/formatting.js';
import { noTeam, errorResult } from '../utils/responses.js';
import { withTeam } from './index.js';

export function registerLockTools(addTool, deps) {
  const { team, state } = deps;

  addTool(
    'chinwag_claim_files',
    {
      description:
        'Claim advisory locks on files you are about to edit. Other agents will be warned if they try to edit locked files. Locks auto-release when your session ends or you stop heartbeating.',
      inputSchema: z.object({
        files: z.array(z.string().max(500)).max(20).describe('File paths to claim'),
      }),
    },
    withTeam(deps, async ({ files }, { preamble }) => {
      const result = await team.claimFiles(state.teamId, files);
      const lines = [];
      if (result.claimed?.length > 0) lines.push(`Claimed: ${result.claimed.join(', ')}`);
      if (result.blocked?.length > 0) {
        for (const b of result.blocked) {
          const who = formatWho(b.held_by, b.tool);
          lines.push(`Blocked: ${b.file} — held by ${who}`);
        }
      }
      return { content: [{ type: 'text', text: `${preamble}${lines.join('\n')}` }] };
    }),
  );

  addTool(
    'chinwag_release_files',
    {
      description:
        'Release advisory locks on files you previously claimed. Call this when you are done editing files so other agents can work on them.',
      inputSchema: z.object({
        files: z
          .array(z.string().max(500))
          .max(20)
          .optional()
          .describe('File paths to release (omit to release all your locks)'),
      }),
    },
    withTeam(
      deps,
      async ({ files }) => {
        await team.releaseFiles(state.teamId, files);
        const msg = files ? `Released: ${files.join(', ')}` : 'All locks released.';
        return { content: [{ type: 'text', text: msg }] };
      },
      { skipPreamble: true },
    ),
  );
}
