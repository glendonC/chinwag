// chinwag_send_message tool handler.

import * as z from 'zod/v4';
import { noTeam, errorResult } from '../utils/responses.js';
import type { AddToolFn, ToolDeps } from './types.js';

export function registerMessagingTool(
  addTool: AddToolFn,
  { team, state }: Pick<ToolDeps, 'team' | 'state'>,
): void {
  addTool(
    'chinwag_send_message',
    {
      description:
        'Send a message to other agents on the team. Messages are ephemeral (auto-expire after 1 hour). Use this to coordinate with other agents -- e.g. "I just refactored auth.js, rebase before editing" or "Need help with failing tests in api/".',
      inputSchema: z.object({
        text: z.string().max(500).describe('Message text'),
        target: z
          .string()
          .max(60)
          .optional()
          .describe('Target agent_id for a direct message (omit to broadcast to all)'),
      }),
    },
    async ({ text, target }: { text: string; target?: string }) => {
      if (!state.teamId) return noTeam();
      try {
        await team.sendMessage(state.teamId, text, target);
        const dest = target ? `to ${target}` : 'to team';
        return { content: [{ type: 'text' as const, text: `Message sent ${dest}: ${text}` }] };
      } catch (err: any) {
        return errorResult(err);
      }
    },
  );
}
