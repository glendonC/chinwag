// chinwag_claim_files and chinwag_release_files tool handlers.

import * as z from 'zod/v4';
import { teamPreamble } from '../context.js';
import { noTeam, errorResult, safeArray, appendDegradedWarning } from '../utils/responses.js';
import { normalizeFiles } from '../utils/paths.js';
import { formatWho } from '../utils/formatting.js';
import { FILE_PATH_MAX_LENGTH, LOCK_FILE_LIST_MAX } from '../constants.js';
import type { AddToolFn, ToolDeps } from './types.js';

const claimFilesSchema = z.object({
  files: z
    .array(z.string().max(FILE_PATH_MAX_LENGTH))
    .max(LOCK_FILE_LIST_MAX)
    .describe('File paths to claim'),
});
type ClaimFilesArgs = z.infer<typeof claimFilesSchema>;

const releaseFilesSchema = z.object({
  files: z
    .array(z.string().max(FILE_PATH_MAX_LENGTH))
    .max(LOCK_FILE_LIST_MAX)
    .optional()
    .describe('File paths to release (omit to release all your locks)'),
});
type ReleaseFilesArgs = z.infer<typeof releaseFilesSchema>;

export function registerLockTools(
  addTool: AddToolFn,
  { team, state }: Pick<ToolDeps, 'team' | 'state'>,
): void {
  addTool(
    'chinwag_claim_files',
    {
      description:
        'Claim advisory locks on files you are about to edit. Other agents will be warned if they try to edit locked files. Locks auto-release when your session ends or you stop heartbeating.',
      inputSchema: claimFilesSchema,
    },
    async (args) => {
      if (!state.teamId) return noTeam(state);
      const { files: rawFiles } = args as ClaimFilesArgs;
      const files = normalizeFiles(rawFiles);
      try {
        const result = await team.claimFiles(state.teamId, files);
        const preamble = await teamPreamble(team, state.teamId);
        const lines: string[] = [];
        const claimed = safeArray<string>(result, 'claimed');
        const blocked = safeArray<{ file: string; held_by: string; tool?: string }>(
          result,
          'blocked',
        );
        if (claimed.length > 0) lines.push(`Claimed: ${claimed.join(', ')}`);
        if (blocked.length > 0) {
          for (const b of blocked) {
            const who = formatWho(b.held_by, b.tool);
            lines.push(`Blocked: ${b.file} \u2014 held by ${who}`);
          }
        }
        return appendDegradedWarning(
          { content: [{ type: 'text' as const, text: `${preamble}${lines.join('\n')}` }] },
          state.heartbeatDead,
        );
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
      inputSchema: releaseFilesSchema,
    },
    async (args) => {
      if (!state.teamId) return noTeam(state);
      const { files: rawFiles } = args as ReleaseFilesArgs;
      const files = rawFiles ? normalizeFiles(rawFiles) : undefined;
      try {
        await team.releaseFiles(state.teamId, files);
        const msg = files ? `Released: ${files.join(', ')}` : 'All locks released.';
        return appendDegradedWarning(
          { content: [{ type: 'text' as const, text: msg }] },
          state.heartbeatDead,
        );
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
