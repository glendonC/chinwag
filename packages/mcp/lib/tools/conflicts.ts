// chinmeister_check_conflicts tool handler.

import * as z from 'zod/v4';
import { getCachedContext } from '../context.js';
import { getHttpStatus, safeArray, withTimeout } from '../utils/responses.js';
import { formatConflictsList, type ConflictInfo, type LockedFileInfo } from '../utils/display.js';
import { formatWho } from '../utils/formatting.js';
import { normalizePath, normalizeFiles } from '../utils/paths.js';
import { MAX_FILE_PATH_LENGTH, FILE_LIST_MAX, API_TIMEOUT_MS } from '../constants.js';
import { withTeam } from './middleware.js';
import type { AddToolFn, ToolDeps } from './types.js';
import type { McpToolResult } from '../utils/responses.js';

const checkConflictsSchema = z.object({
  files: z
    .array(z.string().max(MAX_FILE_PATH_LENGTH))
    .max(FILE_LIST_MAX)
    .describe('File paths you plan to modify'),
});
type CheckConflictsArgs = z.infer<typeof checkConflictsSchema>;

/**
 * Offline fallback: check cached context for potential file overlaps.
 * Returns a conservative result warning the caller not to treat it as live clearance.
 */
function offlineFallback(files: string[]): McpToolResult {
  const cached = getCachedContext();
  if (cached?.members) {
    const myFiles = new Set(files.map(normalizePath));
    const warnings: string[] = [];
    for (const m of cached.members) {
      if (m.status !== 'active' || !m.activity?.files) continue;
      const overlap = m.activity.files.map(normalizePath).filter((f) => myFiles.has(f));
      if (overlap.length > 0) {
        const who = formatWho(m.handle, m.tool);
        warnings.push(`\u26A0 ${who} was working on ${overlap.join(', ')} (cached)`);
      }
    }
    if (warnings.length > 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `[offline \u2014 cached overlap only]\n${warnings.join('\n')}\nDo not treat this as live clearance to edit.`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: '[offline \u2014 cached data only] No overlapping files were found in cache. Do not treat this as live clearance to edit.',
        },
      ],
    };
  }
  return {
    content: [
      {
        type: 'text' as const,
        text: '[offline] Could not reach chinmeister to check conflicts. Do not treat this as clearance to edit.',
      },
    ],
    isError: true,
  };
}

export function registerConflictsTool(
  addTool: AddToolFn,
  deps: Pick<ToolDeps, 'team' | 'state'>,
): void {
  const { team, state } = deps;

  addTool(
    'chinmeister_check_conflicts',
    {
      description:
        'Check if any teammate agents are working on the same files you plan to edit. Call this BEFORE starting edits on shared code to avoid merge conflicts.',
      inputSchema: checkConflictsSchema,
    },
    withTeam(deps, async (args, { preamble }) => {
      const { files: rawFiles } = args as CheckConflictsArgs;
      const files = normalizeFiles(rawFiles);

      let result: unknown;
      try {
        result = (await withTimeout(
          team.checkConflicts(state.teamId!, files),
          API_TIMEOUT_MS,
        )) as unknown;
      } catch (err: unknown) {
        // Auth errors bubble up to withTeam's catch -> errorResult()
        if (getHttpStatus(err) === 401) throw err;
        // All other failures: offline fallback with cached data
        return offlineFallback(files);
      }

      const conflicts = safeArray<ConflictInfo>(result, 'conflicts');
      const locked = safeArray<LockedFileInfo>(result, 'locked');
      const lines = formatConflictsList(conflicts, locked);
      if (lines.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `${preamble}No conflicts. Safe to proceed.` }],
        };
      }
      return {
        content: [{ type: 'text' as const, text: `${preamble}${lines.join('\n')}` }],
      };
    }),
  );
}
