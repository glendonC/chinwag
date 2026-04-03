// chinwag_claim_files and chinwag_release_files tool handlers.

import * as z from 'zod/v4';
import { teamPreamble } from '../context.js';
import { noTeam, errorResult } from '../utils/responses.js';
import { formatWho } from '../utils/formatting.js';
import type { AddToolFn, ToolDeps } from './types.js';

export function registerLockTools(
  addTool: AddToolFn,
  { team, state }: Pick<ToolDeps, 'team' | 'state'>,
): void {
  addTool(
    'chinwag_claim_files',
    {
      description:
        'Claim advisory locks on files you are about to edit. Other agents will be warned if they try to edit locked files. Locks auto-release when your session ends or you stop heartbeating.',
      inputSchema: z.object({
        files: z.array(z.string().max(500)).max(20).describe('File paths to claim'),
      }),
    },
    async ({ files }: { files: string[] }) => {
      if (!state.teamId) return noTeam();
      try {
        const result = await team.claimFiles(state.teamId, files);
        const preamble = await teamPreamble(team, state.teamId);
        const lines: string[] = [];
        if (result.claimed?.length > 0) lines.push(`Claimed: ${result.claimed.join(', ')}`);
        if (result.blocked?.length > 0) {
          for (const b of result.blocked) {
            const who = formatWho(b.held_by, b.tool);
            lines.push(`Blocked: ${b.file} \u2014 held by ${who}`);
          }
        }
        return { content: [{ type: 'text' as const, text: `${preamble}${lines.join('\n')}` }] };
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
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
    async ({ files }: { files?: string[] }) => {
      if (!state.teamId) return noTeam();
      try {
        await team.releaseFiles(state.teamId, files);
        const msg = files ? `Released: ${files.join(', ')}` : 'All locks released.';
        return { content: [{ type: 'text' as const, text: msg }] };
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
