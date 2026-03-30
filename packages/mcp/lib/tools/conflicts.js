// chinwag_check_conflicts tool handler.

import * as z from 'zod/v4';
import { teamPreamble, getCachedContext } from '../context.js';
import { noTeam, errorResult } from '../utils/responses.js';
import { formatConflictsList } from '../utils/display.js';
import { formatWho } from '../utils/formatting.js';

function normalizePath(filePath) {
  return filePath.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
}

export function registerConflictsTool(addTool, { team, state }) {
  addTool(
    'chinwag_check_conflicts',
    {
      description: 'Check if any teammate agents are working on the same files you plan to edit. Call this BEFORE starting edits on shared code to avoid merge conflicts.',
      inputSchema: z.object({
        files: z.array(z.string().max(500)).max(100).describe('File paths you plan to modify'),
      }),
    },
    async ({ files }) => {
      if (!state.teamId) return noTeam();
      try {
        const result = await team.checkConflicts(state.teamId, files);
        const preamble = await teamPreamble(team, state.teamId);
        const lines = formatConflictsList(result.conflicts, result.locked);
        if (lines.length === 0) {
          return { content: [{ type: 'text', text: `${preamble}No conflicts. Safe to proceed.` }] };
        }
        return { content: [{ type: 'text', text: `${preamble}${lines.join('\n')}` }] };
      } catch (err) {
        if (err.status === 401) return errorResult(err);
        // Offline fallback: check cached context for potential conflicts
        const cached = getCachedContext();
        if (cached?.members) {
          const myFiles = new Set(files.map(normalizePath));
          const warnings = [];
          for (const m of cached.members) {
            if (m.status !== 'active' || !m.activity?.files) continue;
            const overlap = m.activity.files.map(normalizePath).filter(f => myFiles.has(f));
            if (overlap.length > 0) {
              const who = formatWho(m.handle, m.tool);
              warnings.push(`\u26A0 ${who} was working on ${overlap.join(', ')} (cached)`);
            }
          }
          if (warnings.length > 0) {
            return {
              content: [{ type: 'text', text: `[offline \u2014 cached overlap only]\n${warnings.join('\n')}\nDo not treat this as live clearance to edit.` }],
              isError: true,
            };
          }
          return {
            content: [{ type: 'text', text: '[offline \u2014 cached data only] No overlapping files were found in cache. Do not treat this as live clearance to edit.' }],
          };
        }
        return {
          content: [{ type: 'text', text: '[offline] Could not reach chinwag to check conflicts. Do not treat this as clearance to edit.' }],
          isError: true,
        };
      }
    }
  );
}
