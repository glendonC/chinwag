import * as z from 'zod/v4';
import { refreshContext, offlinePrefix } from '../context.js';
import { noTeam } from '../utils/responses.js';
import { formatToolTag, formatWho } from '../utils/formatting.js';
function registerContextTool(addTool, { team, state }) {
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
      if (model && model !== state.modelReported && state.teamId) {
        void (async () => {
          const teamId = state.teamId;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              await team.reportModel(teamId, model);
              state.modelReported = model;
              return;
            } catch (err) {
              const message = err instanceof Error ? err.message : 'unknown';
              console.error(`[chinwag] Model report failed (attempt ${attempt + 1}/2):`, message);
              if (attempt === 0) await new Promise((r) => setTimeout(r, 1e3));
            }
          }
          state.modelReported = null;
        })();
      }
      const ctx = await refreshContext(team, state.teamId);
      if (!ctx) {
        return {
          content: [
            {
              type: 'text',
              text: 'No team context available (API unreachable, no cached data).',
            },
          ],
          isError: true,
        };
      }
      const lines = [];
      if (offlinePrefix()) lines.push('[offline \u2014 showing cached data]');
      if (!ctx.members || ctx.members.length === 0) {
        lines.push('No other agents connected.');
      } else {
        lines.push('Agents:');
        for (const m of ctx.members) {
          const toolInfo = formatToolTag(m.tool) ? `, ${m.tool}` : '';
          const activity = m.activity
            ? `working on ${m.activity.files.join(', ')}${m.activity.summary ? ` \u2014 "${m.activity.summary}"` : ''}`
            : 'idle';
          lines.push(`  ${m.handle} (${m.status}${toolInfo}): ${activity}`);
        }
      }
      if (ctx.locks && ctx.locks.length > 0) {
        lines.push('');
        lines.push('Locked files:');
        for (const l of ctx.locks) {
          const who = formatWho(l.owner_handle, l.tool);
          lines.push(`  ${l.file_path} \u2014 ${who} (${Math.round(l.minutes_held)}m)`);
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
    },
  );
}
export { registerContextTool };
