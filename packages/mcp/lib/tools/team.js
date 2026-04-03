import { basename } from 'path';
import * as z from 'zod/v4';
import { clearContextCache } from '../context.js';
import { errorResult } from '../utils/responses.js';
function registerTeamTool(addTool, { team, state, profile }) {
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
    async ({ team_id }) => {
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
        state.heartbeatInterval = setInterval(() => {
          void (async () => {
            try {
              await team.heartbeat(state.teamId);
              consecutiveFailures = 0;
            } catch (err) {
              consecutiveFailures++;
              const status = err instanceof Error && 'status' in err ? err.status : void 0;
              if (status === 403) {
                try {
                  await team.joinTeam(state.teamId, basename(process.cwd()));
                  console.error('[chinwag] Rejoined team after eviction');
                  consecutiveFailures = 0;
                } catch (joinErr) {
                  const joinMessage = joinErr instanceof Error ? joinErr.message : String(joinErr);
                  console.error('[chinwag] Rejoin failed:', joinMessage);
                }
              } else {
                const message = err instanceof Error ? err.message : String(err);
                console.error(
                  `[chinwag] Heartbeat failed (attempt ${consecutiveFailures}):`,
                  message,
                );
              }
            }
          })();
        }, 3e4);
        let sessionStarted = false;
        try {
          const session = await team.startSession(state.teamId, profile.framework);
          if (session?.session_id) {
            state.sessionId = session.session_id;
            sessionStarted = true;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[chinwag] Failed to start session after join:', message);
        }
        if (previousTeamId && previousTeamId !== team_id) {
          if (previousSessionId) {
            await team.endSession(previousTeamId, previousSessionId).catch((err) => {
              console.error('[chinwag] Failed to end previous session:', err.message);
            });
          }
          await team.leaveTeam(previousTeamId).catch((err) => {
            console.error('[chinwag] Failed to leave previous team:', err.message);
          });
        }
        const text = sessionStarted
          ? `Joined team ${team_id}. Session started.`
          : `Joined team ${team_id}. Team membership is active, but session start failed.`;
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
export { registerTeamTool };
