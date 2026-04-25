// Team command routes — submit and list commands for daemon relay.

import type { RouteDefinition } from '../../lib/router.js';
import { rpc } from '../../lib/env.js';
import { json } from '../../lib/http.js';
import { teamJsonRoute, teamRoute, doResult } from '../../lib/middleware.js';
import { createLogger } from '../../lib/logger.js';
import { teamErrorStatus } from '../../lib/request-utils.js';
import { requireString, withRateLimit } from '../../lib/validation.js';
import { RATE_LIMIT_COMMANDS, MAX_COMMAND_PAYLOAD_LENGTH } from '../../lib/constants.js';

const log = createLogger('routes.commands');

export const handleTeamSubmitCommand = teamJsonRoute(async ({ body, user, db, agentId, team }) => {
  const type = requireString(body, 'type', 20);
  if (!type) return json({ error: 'type is required (spawn, stop, or message)' }, 400);

  const payload = body.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return json({ error: 'payload must be an object' }, 400);
  }

  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > MAX_COMMAND_PAYLOAD_LENGTH) {
    return json({ error: 'payload too large' }, 400);
  }

  return withRateLimit(
    db,
    `commands:${user.id}`,
    RATE_LIMIT_COMMANDS,
    'Command limit reached (50/day). Try again tomorrow.',
    async () => {
      const result = rpc(
        await team.submitCommand(
          agentId,
          user.id,
          user.handle,
          type,
          payload as Record<string, unknown>,
        ),
      );
      if ('error' in result) {
        log.warn(`submitCommand failed: ${result.error}`);
        return json({ error: result.error }, teamErrorStatus(result));
      }
      return json(result, 201);
    },
  );
});

export const handleTeamGetCommands = teamRoute(async ({ agentId, team, user }) => {
  return doResult(team.getCommands(agentId, user.id), 'getCommands');
});

/**
 * Per-team daemon relay commands.
 */
export function registerCommandsRoutes(TID: string): RouteDefinition[] {
  return [
    { method: 'POST', path: `/teams/${TID}/commands`, handler: handleTeamSubmitCommand },
    { method: 'GET', path: `/teams/${TID}/commands`, handler: handleTeamGetCommands },
  ];
}
