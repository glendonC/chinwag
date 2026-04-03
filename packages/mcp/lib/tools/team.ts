// chinwag_join_team tool handler.

import { basename } from 'path';
import * as z from 'zod/v4';
import { clearContextCache } from '../context.js';
import { createLogger } from '../utils/logger.js';
import { errorResult, getHttpStatus, getErrorMessage } from '../utils/responses.js';
import type { AddToolFn, ToolDeps } from './types.js';

const log = createLogger('team');

export function registerTeamTool(
  addTool: AddToolFn,
  { team, state, profile }: Pick<ToolDeps, 'team' | 'state' | 'profile'>,
): void {
  addTool(
    'chinwag_join_team',
    {
      description:
        'Join a chinwag team for multi-agent coordination. Agents on the same team can see what each other is working on and detect file conflicts before they happen.',
      inputSchema: z.object({
        team_id: z
          .string()
          .max(30)
          .regex(/^[a-zA-Z0-9_-]+$/)
          .describe('Team ID (e.g., t_a7x9k2m). Found in the .chinwag file at the repo root.'),
      }),
    },
    async ({ team_id }: { team_id: string }) => {
      const previousTeamId = state.teamId;
      const previousSessionId = state.sessionId;
      try {
        await team.joinTeam(team_id, basename(process.cwd()));
        state.teamId = team_id;
        state.sessionId = null;
        state.modelReported = null;
        clearContextCache();

        if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
        let consecutiveFailures = 0;
        const MAX_HEARTBEAT_FAILURES = 20;
        state.heartbeatInterval = setInterval(() => {
          void (async () => {
            // Guard: if teamId was cleared (e.g. shutdown), skip
            if (!state.teamId) return;
            try {
              await team.heartbeat(state.teamId);
              consecutiveFailures = 0;
            } catch (err: unknown) {
              consecutiveFailures++;
              if (getHttpStatus(err) === 403) {
                try {
                  await team.joinTeam(state.teamId!, basename(process.cwd()));
                  log.info('Rejoined team after eviction');
                  consecutiveFailures = 0;
                } catch (joinErr: unknown) {
                  log.error('Rejoin failed: ' + getErrorMessage(joinErr));
                }
              } else if (consecutiveFailures <= 3 || consecutiveFailures % 10 === 0) {
                // Log first few failures, then throttle to every 10th to avoid spam
                log.warn(
                  `Heartbeat failed (attempt ${consecutiveFailures}): ${getErrorMessage(err)}`,
                  {
                    attempt: consecutiveFailures,
                  },
                );
              }
              if (consecutiveFailures >= MAX_HEARTBEAT_FAILURES && state.heartbeatInterval) {
                clearInterval(state.heartbeatInterval);
                state.heartbeatInterval = null;
                log.error(`Heartbeat stopped after ${MAX_HEARTBEAT_FAILURES} consecutive failures`);
              }
            }
          })();
        }, 30_000);

        let sessionStarted = false;
        try {
          const session = await team.startSession(state.teamId, profile.framework);
          if (session?.session_id) {
            state.sessionId = session.session_id;
            sessionStarted = true;
          }
        } catch (err: unknown) {
          log.error('Failed to start session after join: ' + getErrorMessage(err));
        }

        if (previousTeamId && previousTeamId !== team_id) {
          if (previousSessionId) {
            await team.endSession(previousTeamId, previousSessionId).catch((err: Error) => {
              log.error('Failed to end previous session: ' + err.message);
            });
          }
          await team.leaveTeam(previousTeamId).catch((err: Error) => {
            log.error('Failed to leave previous team: ' + err.message);
          });
        }

        const text = sessionStarted
          ? `Joined team ${team_id}. Session started.`
          : `Joined team ${team_id}. Team membership is active, but session start failed.`;
        return { content: [{ type: 'text' as const, text }] };
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
