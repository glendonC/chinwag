// chinwag_join_team tool handler.

import { basename } from 'path';
import * as z from 'zod/v4';
import { clearContextCache } from '../context.js';
import { errorResult } from '../utils/responses.js';

export function registerTeamTool(addTool, { team, state, profile }) {
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
        state.modelReported = false;
        clearContextCache();

        if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
        state.heartbeatInterval = setInterval(async () => {
          try {
            await team.heartbeat(state.teamId);
          } catch (err) {
            if (err.status === 403) {
              try {
                await team.joinTeam(state.teamId, basename(process.cwd()));
                console.error('[chinwag] Rejoined team after eviction');
              } catch (joinErr) {
                console.error('[chinwag] Rejoin failed:', joinErr.message);
              }
            } else {
              console.error('[chinwag] Heartbeat failed:', err.message);
            }
          }
        }, 30_000);

        let sessionStarted = false;
        try {
          const session = await team.startSession(state.teamId, profile.framework);
          if (session?.session_id) {
            state.sessionId = session.session_id;
            sessionStarted = true;
          }
        } catch (err) {
          console.error('[chinwag] Failed to start session after join:', err.message);
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
