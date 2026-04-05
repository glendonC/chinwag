// chinwag_join_team tool handler.

import { basename } from 'path';
import * as z from 'zod/v4';
import { clearContextCache } from '../context.js';
import { createLogger } from '../utils/logger.js';
import { errorResult, getHttpStatus, getErrorMessage, safeString } from '../utils/responses.js';
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_RECOVERY_INTERVAL_MS,
  MAX_HEARTBEAT_FAILURES,
  TEAM_ID_MAX_LENGTH,
} from '../constants.js';
import type { AddToolFn, ToolDeps } from './types.js';

const log = createLogger('team');

const joinTeamSchema = z.object({
  team_id: z
    .string()
    .max(TEAM_ID_MAX_LENGTH)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .describe('Team ID (e.g., t_a7x9k2m). Found in the .chinwag file at the repo root.'),
});
type JoinTeamArgs = z.infer<typeof joinTeamSchema>;

export function registerTeamTool(
  addTool: AddToolFn,
  { team, state, profile }: Pick<ToolDeps, 'team' | 'state' | 'profile'>,
): void {
  addTool(
    'chinwag_join_team',
    {
      description:
        'Join a chinwag team for multi-agent coordination. Agents on the same team can see what each other is working on and detect file conflicts before they happen.',
      inputSchema: joinTeamSchema,
    },
    async (args) => {
      const { team_id } = args as JoinTeamArgs;
      const previousTeamId = state.teamId;
      const previousSessionId = state.sessionId;
      try {
        await team.joinTeam(team_id, basename(process.cwd()));
        state.teamId = team_id;
        state.sessionId = null;
        state.modelReported = null;
        state.heartbeatDead = false;
        state.teamJoinError = null;
        clearContextCache();

        if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
        if (state.heartbeatRecoveryTimeout) {
          clearTimeout(state.heartbeatRecoveryTimeout);
          state.heartbeatRecoveryTimeout = null;
        }
        let consecutiveFailures = 0;

        function startRecoveryTimer(): void {
          if (state.heartbeatRecoveryTimeout) clearTimeout(state.heartbeatRecoveryTimeout);
          state.heartbeatRecoveryTimeout = setTimeout(async () => {
            state.heartbeatRecoveryTimeout = null;
            if (!state.teamId || state.shuttingDown) return;
            try {
              await team.heartbeat(state.teamId);
              // Recovery succeeded — restart normal heartbeat loop
              log.info('Heartbeat recovery succeeded, resuming normal interval');
              consecutiveFailures = 0;
              state.heartbeatDead = false;
              state.heartbeatInterval = setInterval(() => {
                void runHeartbeat();
              }, HEARTBEAT_INTERVAL_MS);
            } catch {
              // Recovery failed — schedule another attempt
              log.warn('Heartbeat recovery attempt failed, will retry');
              startRecoveryTimer();
            }
          }, HEARTBEAT_RECOVERY_INTERVAL_MS);
        }

        async function runHeartbeat(): Promise<void> {
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
                // Immediately retry the heartbeat after successful rejoin
                try {
                  await team.heartbeat(state.teamId!);
                } catch (hbErr: unknown) {
                  log.warn('Post-rejoin heartbeat failed, next interval will retry', {
                    error: getErrorMessage(hbErr),
                  });
                }
              } catch (joinErr: unknown) {
                log.error('Rejoin failed: ' + getErrorMessage(joinErr));
                // Rejoin failed — count it as a failure (already incremented above)
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
              state.heartbeatDead = true;
              log.error(
                `Heartbeat stopped after ${MAX_HEARTBEAT_FAILURES} consecutive failures. ` +
                  'Starting recovery timer.',
              );
              startRecoveryTimer();
            }
          }
        }

        state.heartbeatInterval = setInterval(() => {
          void runHeartbeat();
        }, HEARTBEAT_INTERVAL_MS);

        let sessionStarted = false;
        try {
          const session = await team.startSession(state.teamId, profile.framework);
          const sessionId = safeString(session, 'session_id');
          if (sessionId) {
            state.sessionId = sessionId;
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
