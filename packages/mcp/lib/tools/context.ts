// chinmeister_get_team_context tool handler.

import * as z from 'zod/v4';
import { refreshContext, offlinePrefix } from '../context.js';
import { createLogger } from '../utils/logger.js';
import { getErrorMessage, safeArray, withTimeout } from '../utils/responses.js';
import { formatToolTag, formatWho, type TeamMember } from '../utils/formatting.js';
import type { LockContextInfo, MessageInfo, MemoryInfo } from '../utils/display.js';
import { MAX_MODEL_LENGTH, API_TIMEOUT_MS } from '../constants.js';
import { withTeam } from './middleware.js';
import type { AddToolFn, ToolDeps } from './types.js';

const log = createLogger('tools');

const getTeamContextSchema = z.object({
  model: z
    .string()
    .max(MAX_MODEL_LENGTH)
    .optional()
    .describe('Your model identifier (e.g. "claude-opus-4-6", "gpt-4o"). Include on first call.'),
});
type GetTeamContextArgs = z.infer<typeof getTeamContextSchema>;

export function registerContextTool(
  addTool: AddToolFn,
  deps: Pick<ToolDeps, 'team' | 'state'>,
): void {
  const { team, state } = deps;

  addTool(
    'chinmeister_get_team_context',
    {
      description:
        'Get the full state of your team: who is online, what everyone is working on, and any file overlaps. Use this to orient yourself before starting work.',
      inputSchema: getTeamContextSchema,
    },
    withTeam(
      deps,
      async (args) => {
        const { model } = (args ?? {}) as GetTeamContextArgs;

        // Deferred model enrichment -- fire-and-forget on first report.
        // Tracks which model was reported (not just a boolean) so a different
        // model triggers a new report. Uses modelReportInflight to deduplicate
        // concurrent calls. Retries once on failure; clears both flags so the
        // next tool call will try again.
        if (
          model &&
          model !== state.modelReported &&
          model !== state.modelReportInflight &&
          state.teamId
        ) {
          state.modelReportInflight = model;
          const modelToReport = model; // capture narrowed string for named function

          async function reportModelAsync(): Promise<void> {
            const teamId = state.teamId!;
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                await withTimeout(team.reportModel(teamId, modelToReport), API_TIMEOUT_MS);
                state.modelReported = modelToReport;
                state.modelReportInflight = null;
                return;
              } catch (err: unknown) {
                log.warn(`Model report failed (attempt ${attempt + 1}/2): ${getErrorMessage(err)}`);
                if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
              }
            }
            // All retries exhausted — clear so next tool call retries
            state.modelReported = null;
            state.modelReportInflight = null;
          }

          void reportModelAsync();
        }
        const ctx = await refreshContext(team, state.teamId!);
        if (!ctx) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No team context available (API unreachable, no cached data).',
              },
            ],
            isError: true,
          };
        }

        const lines: string[] = [];
        const offline = offlinePrefix();
        if (offline) lines.push(offline.trim());

        const members = safeArray<TeamMember>(ctx, 'members');
        const locks = safeArray<LockContextInfo>(ctx, 'locks');
        const messages = safeArray<MessageInfo>(ctx, 'messages');
        const memories = safeArray<MemoryInfo>(ctx, 'memories');

        if (members.length === 0) {
          lines.push('No other agents connected.');
        } else {
          lines.push('Agents:');
          for (const m of members) {
            const toolInfo = formatToolTag(m.tool) ? `, ${m.tool}` : '';
            const activity = m.activity
              ? `working on ${m.activity.files.join(', ')}${m.activity.summary ? ` \u2014 "${m.activity.summary}"` : ''}`
              : 'idle';
            lines.push(`  ${m.handle} (${m.status}${toolInfo}): ${activity}`);
          }
        }

        if (locks.length > 0) {
          lines.push('');
          lines.push('Locked files:');
          for (const l of locks) {
            const who = formatWho(l.owner_handle, l.tool);
            lines.push(`  ${l.file_path} \u2014 ${who} (${Math.round(l.minutes_held)}m)`);
          }
        }

        if (messages.length > 0) {
          lines.push('');
          lines.push('Messages:');
          for (const msg of messages) {
            const from = formatWho(msg.from_handle, msg.from_tool);
            lines.push(`  ${from}: ${msg.text}`);
          }
        }

        if (memories.length > 0) {
          lines.push('');
          lines.push('Project knowledge:');
          for (const mem of memories) {
            const tagStr = mem.tags?.length ? ` [${mem.tags.join(', ')}]` : '';
            lines.push(`  ${mem.text}${tagStr}`);
          }
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      },
      { skipPreamble: true },
    ),
  );
}
