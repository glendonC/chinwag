// Team message routes - send and get messages.

import type { RouteDefinition } from '../../lib/router.js';
import { checkContent } from '../../moderation.js';
import { rpc } from '../../lib/env.js';
import { json } from '../../lib/http.js';
import { teamJsonRoute, teamRoute, doResult } from '../../lib/middleware.js';
import { createLogger } from '../../lib/logger.js';
import { teamErrorStatus } from '../../lib/request-utils.js';
import { requireString, withRateLimit } from '../../lib/validation.js';
import { MAX_MESSAGE_LENGTH, RATE_LIMIT_MESSAGES } from '../../lib/constants.js';

const log = createLogger('routes.messages');

export const handleTeamSendMessage = teamJsonRoute(
  async ({ body, user, env, db, agentId, runtime, team }) => {
    const text = requireString(body, 'text', MAX_MESSAGE_LENGTH);
    if (!text) return json({ error: 'text is required' }, 400);

    const modResult = await checkContent(text, env);
    if (modResult.blocked) {
      if (modResult.reason === 'moderation_unavailable') {
        log.warn('content moderation unavailable: blocking message as fail-safe');
        return json(
          { error: 'Content moderation is temporarily unavailable. Please try again.' },
          503,
        );
      }
      return json({ error: 'Content blocked' }, 400);
    }

    const { target } = body;
    if (target !== undefined && typeof target !== 'string')
      return json({ error: 'target must be a string' }, 400);

    return withRateLimit(
      db,
      `messages:${user.id}`,
      RATE_LIMIT_MESSAGES,
      'Message limit reached (200/day). Try again tomorrow.',
      async () => {
        const result = rpc(
          await team.sendMessage(
            agentId,
            user.handle,
            runtime,
            text,
            (target as string) || null,
            user.id,
          ),
        );
        if ('error' in result) {
          log.warn(`sendMessage failed: ${result.error}`);
          return json({ error: result.error }, teamErrorStatus(result));
        }
        return json(result, 201);
      },
    );
  },
);

export const handleTeamGetMessages = teamRoute(async ({ request, agentId, team, user }) => {
  const url = new URL(request.url);
  const since = url.searchParams.get('since') || null;

  return doResult(team.getMessages(agentId, since, user.id), 'getMessages');
});

/**
 * Per-team chat-style message routes.
 */
export function registerMessagesRoutes(TID: string): RouteDefinition[] {
  return [
    { method: 'POST', path: `/teams/${TID}/messages`, handler: handleTeamSendMessage },
    { method: 'GET', path: `/teams/${TID}/messages`, handler: handleTeamGetMessages },
  ];
}
