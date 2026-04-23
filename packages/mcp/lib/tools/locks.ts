// chinmeister_claim_files and chinmeister_release_files tool handlers.

import * as z from 'zod/v4';
import { safeArray, withTimeout } from '../utils/responses.js';
import { normalizeFiles } from '../utils/paths.js';
import { formatWho } from '../utils/formatting.js';
import { MAX_FILE_PATH_LENGTH, LOCK_CLAIM_MAX_FILES, API_TIMEOUT_MS } from '../constants.js';
import { withTeam } from './middleware.js';
import type { AddToolFn, ToolDeps } from './types.js';

const claimFilesSchema = z.object({
  files: z
    .array(z.string().max(MAX_FILE_PATH_LENGTH))
    .max(LOCK_CLAIM_MAX_FILES)
    .describe(
      'Paths or glob patterns to claim. A concrete path (e.g. src/auth/tokens.ts) claims one file; a glob (e.g. src/auth/**/*.ts, **/*.test.ts) claims a whole scope so other agents are warned before editing anything inside it. Glob syntax is gitignore-flavoured: *, **, and ?.',
    ),
  ttl_seconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Optional lease duration. Omit for heartbeat-only liveness (the default). Set for a bounded reservation (e.g. 1800 for 30 minutes while refactoring) so the claim reaps automatically if you forget to release.',
    ),
});
type ClaimFilesArgs = z.infer<typeof claimFilesSchema>;

const releaseFilesSchema = z.object({
  files: z
    .array(z.string().max(MAX_FILE_PATH_LENGTH))
    .max(LOCK_CLAIM_MAX_FILES)
    .optional()
    .describe('File paths to release (omit to release all your locks)'),
});
type ReleaseFilesArgs = z.infer<typeof releaseFilesSchema>;

export function registerLockTools(
  addTool: AddToolFn,
  deps: Pick<ToolDeps, 'team' | 'state'>,
): void {
  const { team, state } = deps;

  addTool(
    'chinmeister_claim_files',
    {
      description:
        'Claim advisory locks on files or scopes you are about to edit. Accepts concrete paths (src/auth/tokens.ts) or glob patterns (src/auth/**/*.ts) in the same array. Other agents will be warned if they try to edit a file that matches any of your active claims. Locks auto-release when your session ends or when ttl_seconds expires.',
      inputSchema: claimFilesSchema,
    },
    withTeam(deps, async (args, { preamble }) => {
      const { files: rawFiles, ttl_seconds } = args as ClaimFilesArgs;
      const files = normalizeFiles(rawFiles);
      const result = await withTimeout(
        team.claimFiles(state.teamId!, files, ttl_seconds),
        API_TIMEOUT_MS,
      );
      const lines: string[] = [];
      const claimed = safeArray<string>(result, 'claimed');
      const blocked = safeArray<{
        file: string;
        held_by: string;
        tool?: string;
        blocked_by_glob?: string | null;
      }>(result, 'blocked');
      if (claimed.length > 0) lines.push(`Claimed: ${claimed.join(', ')}`);
      if (blocked.length > 0) {
        for (const b of blocked) {
          const who = formatWho(b.held_by, b.tool);
          const scope = b.blocked_by_glob ? ` via scope ${b.blocked_by_glob}` : '';
          lines.push(`Blocked: ${b.file} \u2014 held by ${who}${scope}`);
        }
      }
      return {
        content: [{ type: 'text' as const, text: `${preamble}${lines.join('\n')}` }],
      };
    }),
  );

  addTool(
    'chinmeister_release_files',
    {
      description:
        'Release advisory locks on files you previously claimed. Call this when you are done editing files so other agents can work on them.',
      inputSchema: releaseFilesSchema,
    },
    withTeam(
      deps,
      async (args) => {
        const { files: rawFiles } = args as ReleaseFilesArgs;
        const files = rawFiles ? normalizeFiles(rawFiles) : undefined;
        await withTimeout(team.releaseFiles(state.teamId!, files), API_TIMEOUT_MS);
        const msg = files ? `Released: ${files.join(', ')}` : 'All locks released.';
        return { content: [{ type: 'text' as const, text: msg }] };
      },
      { skipPreamble: true },
    ),
  );
}
