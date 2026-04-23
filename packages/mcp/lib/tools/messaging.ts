// chinmeister_send_message tool handler.

import * as z from 'zod/v4';
import { withTimeout } from '../utils/responses.js';
import { MAX_MESSAGE_LENGTH, MESSAGE_TARGET_MAX_LENGTH, API_TIMEOUT_MS } from '../constants.js';
import { withTeam } from './middleware.js';
import type { AddToolFn, ToolDeps } from './types.js';

const sendMessageSchema = z.object({
  text: z.string().max(MAX_MESSAGE_LENGTH).describe('Message text'),
  target: z
    .string()
    .max(MESSAGE_TARGET_MAX_LENGTH)
    .optional()
    .describe('Target agent_id for a direct message (omit to broadcast to all)'),
});
type SendMessageArgs = z.infer<typeof sendMessageSchema>;

export function registerMessagingTool(
  addTool: AddToolFn,
  deps: Pick<ToolDeps, 'team' | 'state'>,
): void {
  const { team, state } = deps;

  addTool(
    'chinmeister_send_message',
    {
      description:
        'Send a message to other agents on the team. Messages are ephemeral (auto-expire after 1 hour). Use this to coordinate with other agents -- e.g. "I just refactored auth.js, rebase before editing" or "Need help with failing tests in api/".',
      inputSchema: sendMessageSchema,
    },
    withTeam(
      deps,
      async (args) => {
        const { text, target } = args as SendMessageArgs;
        await withTimeout(team.sendMessage(state.teamId!, text, target), API_TIMEOUT_MS);
        const dest = target ? `to ${target}` : 'to team';
        return {
          content: [{ type: 'text' as const, text: `Message sent ${dest}: ${text}` }],
        };
      },
      { skipPreamble: true },
    ),
  );
}
