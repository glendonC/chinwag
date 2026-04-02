// chinwag_get_team_context tool handler.

import * as z from 'zod/v4';
import { refreshContext, offlinePrefix } from '../context.js';
import { noTeam } from '../utils/responses.js';
import { formatWho } from '../utils/formatting.js';
import { formatTeamContextDisplay } from '../utils/display.js';

export function registerContextTool(addTool, { team, state }) {
  // Promise-based mutex: stores the in-flight report promise so concurrent
  // calls await the same attempt instead of firing duplicates. Cleared on
  // success (done) or failure (retry allowed).
  let modelReportPromise = null;

  addTool(
    'chinwag_get_team_context',
    {
      description:
        'Get the full state of your team: who is online, what everyone is working on, and any file overlaps. Use this to orient yourself before starting work.',
      inputSchema: z.object({
        model: z
          .string()
          .max(100)
          .optional()
          .describe(
            'Your model identifier (e.g. "claude-opus-4-6", "gpt-4o"). Include on first call.',
          ),
      }),
    },
    async ({ model } = {}) => {
      if (!state.teamId) return noTeam();

      // Fire-once model enrichment with Promise-based dedup.
      // Tracks which model was reported (not just a boolean) so a different
      // model triggers a new report. Concurrent calls share the in-flight
      // promise. Cleared on failure to allow retry.
      if (model && model !== state.reportedModel && state.teamId && !modelReportPromise) {
        modelReportPromise = team
          .reportModel(state.teamId, model)
          .then(() => {
            state.reportedModel = model;
          })
          .catch((err) => {
            console.error('[chinwag] Model report failed:', err.message);
          })
          .finally(() => {
            modelReportPromise = null;
          });
      }
      const ctx = await refreshContext(team, state.teamId);
      if (!ctx) {
        return {
          content: [
            { type: 'text', text: 'No team context available (API unreachable, no cached data).' },
          ],
          isError: true,
        };
      }

      const lines = [];
      if (offlinePrefix()) lines.push('[offline — showing cached data]');

      // Shared display logic for members, locks, and memories
      const contextLines = formatTeamContextDisplay(ctx);
      if (contextLines.length === 0) {
        lines.push('No other agents connected.');
      } else {
        lines.push('Agents:');
        lines.push(...contextLines);
      }

      // Messages (tool-specific — not in shared display)
      if (ctx.messages && ctx.messages.length > 0) {
        lines.push('');
        lines.push('Messages:');
        for (const msg of ctx.messages) {
          const from = formatWho(msg.from_handle, msg.from_tool);
          lines.push(`  ${from}: ${msg.text}`);
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
}
