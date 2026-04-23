// chinmeister_join_team tool handler.

import { basename } from 'path';
import * as z from 'zod/v4';
import { clearContextCache } from '../context.js';
import { createLogger } from '../utils/logger.js';
import {
  errorResult,
  getHttpStatus,
  getErrorMessage,
  safeString,
  withTimeout,
} from '../utils/responses.js';
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_RECOVERY_INTERVAL_MS,
  MAX_HEARTBEAT_FAILURES,
  TEAM_ID_MAX_LENGTH,
  API_TIMEOUT_MS,
  nextHeartbeatRecoveryDelay,
} from '../constants.js';
import type { AddToolFn, ToolDeps } from './types.js';

const log = createLogger('team');

/** Shorter timeout for heartbeats — lightweight, latency-sensitive. */
const HEARTBEAT_TIMEOUT_MS = 5_000;

const joinTeamSchema = z.object({
  team_id: z
    .string()
    .max(TEAM_ID_MAX_LENGTH)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .describe('Team ID (e.g., t_a7x9k2m). Found in the .chinmeister file at the repo root.'),
});
type JoinTeamArgs = z.infer<typeof joinTeamSchema>;

export function registerTeamTool(
  addTool: AddToolFn,
  { team, state, profile }: Pick<ToolDeps, 'team' | 'state' | 'profile'>,
): void {
  addTool(
    'chinmeister_join_team',
    {
      description:
        'Join a chinmeister team for multi-agent coordination. Agents on the same team can see what each other is working on and detect file conflicts before they happen.',
      inputSchema: joinTeamSchema,
    },
    async (args) => {
      const { team_id } = args as JoinTeamArgs;
      const previousTeamId = state.teamId;
      const previousSessionId = state.sessionId;
      try {
        await withTimeout(team.joinTeam(team_id, basename(process.cwd())), API_TIMEOUT_MS);
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
        let recoveryDelay = HEARTBEAT_RECOVERY_INTERVAL_MS;
        let recoveryAttempts = 0;

        function startRecoveryTimer(): void {
          if (state.heartbeatRecoveryTimeout) clearTimeout(state.heartbeatRecoveryTimeout);
          const delay = recoveryDelay;
          state.heartbeatRecoveryTimeout = setTimeout(async () => {
            state.heartbeatRecoveryTimeout = null;
            recoveryAttempts++;
            if (!state.teamId || state.shuttingDown) return;
            try {
              await withTimeout(team.heartbeat(state.teamId), HEARTBEAT_TIMEOUT_MS);
              log.info('Heartbeat recovery succeeded, resuming normal interval');
              consecutiveFailures = 0;
              recoveryDelay = HEARTBEAT_RECOVERY_INTERVAL_MS;
              recoveryAttempts = 0;
              state.heartbeatDead = false;
              state.heartbeatInterval = setInterval(() => {
                void runHeartbeat();
              }, HEARTBEAT_INTERVAL_MS);
            } catch {
              recoveryDelay = nextHeartbeatRecoveryDelay(recoveryDelay);
              // Log first few attempts then throttle to every 10th.
              if (recoveryAttempts <= 3 || recoveryAttempts % 10 === 0) {
                log.warn(
                  `Heartbeat recovery failed (attempt ${recoveryAttempts}), next in ${Math.round(recoveryDelay / 1000)}s`,
                );
              }
              startRecoveryTimer();
            }
          }, delay);
        }

        async function runHeartbeat(): Promise<void> {
          // Guard: if teamId was cleared (e.g. shutdown), skip
          if (!state.teamId) return;
          try {
            await withTimeout(team.heartbeat(state.teamId), HEARTBEAT_TIMEOUT_MS);
            consecutiveFailures = 0;
          } catch (err: unknown) {
            consecutiveFailures++;
            if (getHttpStatus(err) === 403) {
              try {
                await withTimeout(
                  team.joinTeam(state.teamId!, basename(process.cwd())),
                  API_TIMEOUT_MS,
                );
                log.info('Rejoined team after eviction');
                consecutiveFailures = 0;
                // Immediately retry the heartbeat after successful rejoin
                try {
                  await withTimeout(team.heartbeat(state.teamId!), HEARTBEAT_TIMEOUT_MS);
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
          const session = await withTimeout(
            team.startSession(state.teamId, profile.framework),
            API_TIMEOUT_MS,
          );
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
            await withTimeout(
              team.endSession(previousTeamId, previousSessionId),
              API_TIMEOUT_MS,
            ).catch((err: Error) => {
              log.error('Failed to end previous session: ' + err.message);
            });
          }
          await withTimeout(team.leaveTeam(previousTeamId), API_TIMEOUT_MS).catch((err: Error) => {
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
