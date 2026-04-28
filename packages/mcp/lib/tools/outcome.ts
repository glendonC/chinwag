// chinmeister_report_outcome tool handler.

import * as z from 'zod/v4';
import { withTimeout } from '../utils/responses.js';
import { API_TIMEOUT_MS } from '../constants.js';
import { withTeam } from './middleware.js';
import type { AddToolFn, ToolDeps } from './types.js';

const reportOutcomeSchema = z.object({
  outcome: z
    .enum(['completed', 'abandoned', 'failed'])
    .describe(
      'Session outcome: completed (task done), abandoned (gave up or blocked), failed (errors prevented completion)',
    ),
  summary: z
    .string()
    .max(500)
    .optional()
    .describe('Brief description of what was accomplished or why the session ended this way'),
});
type ReportOutcomeArgs = z.infer<typeof reportOutcomeSchema>;

export function registerOutcomeTool(
  addTool: AddToolFn,
  deps: Pick<ToolDeps, 'team' | 'state'>,
): void {
  const { team, state } = deps;

  addTool(
    'chinmeister_report_outcome',
    {
      description:
        'Report the outcome of your current session before it ends. Call this when you finish a task (completed), give up (abandoned), or encounter unrecoverable errors (failed). This powers workflow analytics that help developers understand and improve their AI-assisted development.',
      inputSchema: reportOutcomeSchema,
    },
    withTeam(deps, async (args, { preamble }) => {
      const { outcome, summary } = args as ReportOutcomeArgs;
      await withTimeout(
        team.reportOutcome(state.teamId!, outcome, summary || null),
        API_TIMEOUT_MS,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: `${preamble}Session outcome recorded: ${outcome}${summary ? ` - ${summary}` : ''}`,
          },
        ],
      };
    }),
  );
}
