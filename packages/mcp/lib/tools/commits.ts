// chinmeister_report_commits tool handler.

import * as z from 'zod/v4';
import { withTimeout } from '../utils/responses.js';
import { API_TIMEOUT_MS } from '../constants.js';
import { withTeam } from './middleware.js';
import type { AddToolFn, ToolDeps } from './types.js';

const commitSchema = z.object({
  sha: z.string().min(7).max(40).describe('Git commit SHA (7-40 hex characters)'),
  branch: z.string().max(200).optional().describe('Branch name'),
  message: z.string().max(200).optional().describe('Commit message (first line)'),
  files_changed: z.number().int().min(0).optional().describe('Number of files changed'),
  lines_added: z.number().int().min(0).optional().describe('Lines added'),
  lines_removed: z.number().int().min(0).optional().describe('Lines removed'),
  committed_at: z.string().optional().describe('ISO timestamp of the commit'),
});

const reportCommitsSchema = z.object({
  commits: z
    .array(commitSchema)
    .min(1)
    .max(50)
    .describe('Array of commits made during this session'),
});
type ReportCommitsArgs = z.infer<typeof reportCommitsSchema>;

export function registerCommitsTool(
  addTool: AddToolFn,
  deps: Pick<ToolDeps, 'team' | 'state'>,
): void {
  const { team, state } = deps;

  addTool(
    'chinmeister_report_commits',
    {
      description:
        'Report git commits made during your current session. Call this after running git commit to link your commits to this agent session. This enables git attribution analytics — understanding which commits came from which agent sessions, tools, and models.',
      inputSchema: reportCommitsSchema,
    },
    withTeam(deps, async (args, { preamble }) => {
      const { commits } = args as ReportCommitsArgs;
      if (!state.sessionId) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `${preamble}No active session — commits not recorded. Start a session first.`,
            },
          ],
        };
      }
      const result = await withTimeout(
        team.recordCommits(state.teamId!, state.sessionId, commits),
        API_TIMEOUT_MS,
      );
      const recorded = (result as { recorded?: number }).recorded ?? commits.length;
      const shas = commits.map((c) => c.sha.slice(0, 7)).join(', ');
      return {
        content: [
          {
            type: 'text' as const,
            text: `${preamble}Recorded ${recorded} commit${recorded !== 1 ? 's' : ''}: ${shas}`,
          },
        ],
      };
    }),
  );
}
