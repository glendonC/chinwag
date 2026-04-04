// chinwag_send_message tool handler.

import * as z from 'zod/v4';
import { noTeam, errorResult, appendDegradedWarning } from '../utils/responses.js';
import { MESSAGE_TEXT_MAX_LENGTH, MESSAGE_TARGET_MAX_LENGTH } from '../constants.js';
import type { AddToolFn, ToolDeps } from './types.js';

const sendMessageSchema = z.object({
  text: z.string().max(MESSAGE_TEXT_MAX_LENGTH).describe('Message text'),
  target: z
    .string()
    .max(MESSAGE_TARGET_MAX_LENGTH)
    .optional()
    .describe('Target agent_id for a direct message (omit to broadcast to all)'),
});
type SendMessageArgs = z.infer<typeof sendMessageSchema>;

export function registerMessagingTool(
  addTool: AddToolFn,
  { team, state }: Pick<ToolDeps, 'team' | 'state'>,
): void {
  addTool(
    'chinwag_send_message',
    {
      description:
        'Send a message to other agents on the team. Messages are ephemeral (auto-expire after 1 hour). Use this to coordinate with other agents -- e.g. "I just refactored auth.js, rebase before editing" or "Need help with failing tests in api/".',
      inputSchema: sendMessageSchema,
    },
    async (args) => {
      const { text, target } = args as SendMessageArgs;
      if (!state.teamId) return noTeam(state);
      try {
        await team.sendMessage(state.teamId, text, target);
        const dest = target ? `to ${target}` : 'to team';
        return appendDegradedWarning(
          { content: [{ type: 'text' as const, text: `Message sent ${dest}: ${text}` }] },
          state.heartbeatDead,
        );
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
