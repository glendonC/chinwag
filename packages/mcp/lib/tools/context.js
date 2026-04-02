// chinwag_get_team_context tool handler.

import * as z from 'zod/v4';
import { refreshContext, offlinePrefix } from '../context.js';
import { noTeam } from '../utils/responses.js';
import { formatToolTag, formatWho } from '../utils/formatting.js';

export function registerContextTool(addTool, { team, state }) {
  addTool(
    'chinwag_get_team_context',
    {
      description: 'Get the full state of your team: who is online, what everyone is working on, and any file overlaps. Use this to orient yourself before starting work.',
      inputSchema: z.object({
        model: z.string().max(100).optional().describe('Your model identifier (e.g. "claude-opus-4-6", "gpt-4o"). Include on first call.'),
      }),
    },
    async ({ model } = {}) => {
      if (!state.teamId) return noTeam();

      // Deferred model enrichment — fire-and-forget on first report.
      // Set flag optimistically to prevent duplicate reports from concurrent calls.
      if (model && !state.modelReported && state.teamId) {
        state.modelReported = true;
        (async () => {
          try {
            await team.reportModel(state.teamId, model);
          } catch (err) {
            state.modelReported = false;
            console.error('[chinwag] Model report failed:', err.message);
          }
        })();
      }
      const ctx = await refreshContext(team, state.teamId);
      if (!ctx) {
        return { content: [{ type: 'text', text: 'No team context available (API unreachable, no cached data).' }], isError: true };
      }

      const lines = [];
      if (offlinePrefix()) lines.push('[offline — showing cached data]');

      if (!ctx.members || ctx.members.length === 0) {
        lines.push('No other agents connected.');
      } else {
        lines.push('Agents:');
        for (const m of ctx.members) {
          const toolInfo = formatToolTag(m.tool) ? `, ${m.tool}` : '';
          const activity = m.activity
            ? `working on ${m.activity.files.join(', ')}${m.activity.summary ? ` — "${m.activity.summary}"` : ''}`
            : 'idle';
          lines.push(`  ${m.handle} (${m.status}${toolInfo}): ${activity}`);
        }
      }

      if (ctx.locks && ctx.locks.length > 0) {
        lines.push('');
        lines.push('Locked files:');
        for (const l of ctx.locks) {
          const who = formatWho(l.owner_handle, l.tool);
          lines.push(`  ${l.file_path} — ${who} (${Math.round(l.minutes_held)}m)`);
        }
      }

      if (ctx.messages && ctx.messages.length > 0) {
        lines.push('');
        lines.push('Messages:');
        for (const msg of ctx.messages) {
          const from = formatWho(msg.from_handle, msg.from_tool);
          lines.push(`  ${from}: ${msg.text}`);
        }
      }

      if (ctx.memories && ctx.memories.length > 0) {
        lines.push('');
        lines.push('Project knowledge:');
        for (const mem of ctx.memories) {
          const tagStr = mem.tags?.length ? ` [${mem.tags.join(', ')}]` : '';
          lines.push(`  ${mem.text}${tagStr}`);
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );
}
