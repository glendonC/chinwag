// chinwag_check_conflicts tool handler.

import * as z from 'zod/v4';
import { teamPreamble, getCachedContext } from '../context.js';
import {
  noTeam,
  errorResult,
  getHttpStatus,
  safeArray,
  appendDegradedWarning,
} from '../utils/responses.js';
import { formatConflictsList, type ConflictInfo, type LockedFileInfo } from '../utils/display.js';
import { formatWho } from '../utils/formatting.js';
import { normalizePath, normalizeFiles } from '../utils/paths.js';
import { FILE_PATH_MAX_LENGTH, FILE_LIST_MAX } from '../constants.js';
import type { AddToolFn, ToolDeps } from './types.js';

const checkConflictsSchema = z.object({
  files: z
    .array(z.string().max(FILE_PATH_MAX_LENGTH))
    .max(FILE_LIST_MAX)
    .describe('File paths you plan to modify'),
});
type CheckConflictsArgs = z.infer<typeof checkConflictsSchema>;

export function registerConflictsTool(
  addTool: AddToolFn,
  { team, state }: Pick<ToolDeps, 'team' | 'state'>,
): void {
  addTool(
    'chinwag_check_conflicts',
    {
      description:
        'Check if any teammate agents are working on the same files you plan to edit. Call this BEFORE starting edits on shared code to avoid merge conflicts.',
      inputSchema: checkConflictsSchema,
    },
    async (args) => {
      if (!state.teamId) return noTeam(state);
      const { files: rawFiles } = args as CheckConflictsArgs;
      const files = normalizeFiles(rawFiles);
      try {
        const result = await team.checkConflicts(state.teamId, files);
        const preamble = await teamPreamble(team, state.teamId);
        const conflicts = safeArray<ConflictInfo>(result, 'conflicts');
        const locked = safeArray<LockedFileInfo>(result, 'locked');
        const lines = formatConflictsList(conflicts, locked);
        if (lines.length === 0) {
          return appendDegradedWarning(
            {
              content: [
                { type: 'text' as const, text: `${preamble}No conflicts. Safe to proceed.` },
              ],
            },
            state.heartbeatDead,
          );
        }
        return appendDegradedWarning(
          { content: [{ type: 'text' as const, text: `${preamble}${lines.join('\n')}` }] },
          state.heartbeatDead,
        );
      } catch (err: unknown) {
        if (getHttpStatus(err) === 401) return errorResult(err);
        // Offline fallback: check cached context for potential conflicts
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
              text: '[offline] Could not reach chinwag to check conflicts. Do not treat this as clearance to edit.',
            },
          ],
          isError: true,
        };
      }
    },
  );
}
