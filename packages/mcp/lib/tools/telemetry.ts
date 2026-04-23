// Optional MCP telemetry tools: chinmeister_record_tokens and chinmeister_record_tool_call.
//
// These are "bonus capture" tools — some cooperative agents will call them
// voluntarily. For tools without hooks or logs, this captures 10-30% of
// sessions. Zero downside: if the agent doesn't call them, nothing breaks.
//
// Token data is accumulated locally per session and flushed on session end.
// Tool call data is posted immediately (individual calls are cheap).

import * as z from 'zod/v4';
import { withTimeout } from '../utils/responses.js';
import { API_TIMEOUT_MS } from '../constants.js';
import { withTeam } from './middleware.js';
import type { AddToolFn, ToolDeps } from './types.js';

const recordTokensSchema = z.object({
  input_tokens: z.number().int().min(0).describe('Input tokens used in this API call'),
  output_tokens: z.number().int().min(0).describe('Output tokens generated'),
  cache_read_tokens: z.number().int().min(0).optional().describe('Tokens served from prompt cache'),
  cache_creation_tokens: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Tokens written to prompt cache'),
});

const recordToolCallSchema = z.object({
  tool_name: z.string().max(100).describe('Name of the tool that was called'),
  success: z.boolean().describe('Whether the tool call succeeded'),
  duration_ms: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('How long the tool call took in milliseconds'),
  error: z.string().max(200).optional().describe('Error message if the call failed'),
});

const recordEditSchema = z.object({
  file: z
    .string()
    .min(1)
    .max(500)
    .describe('Path of the file that was edited, relative to the repo root'),
  lines_added: z.number().int().min(0).optional().describe('Number of lines added by this edit'),
  lines_removed: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Number of lines removed by this edit'),
});

export function registerTelemetryTools(
  addTool: AddToolFn,
  deps: Pick<ToolDeps, 'team' | 'state'>,
): void {
  const { team, state } = deps;

  addTool(
    'chinmeister_record_tokens',
    {
      description:
        'Record token usage from an API call. Call this after each LLM response to help chinmeister track cost and efficiency across tools. Optional but improves analytics accuracy.',
      inputSchema: recordTokensSchema,
    },
    withTeam(deps, async (args, { preamble }) => {
      const parsed = args as z.infer<typeof recordTokensSchema>;

      if (!state.sessionId) {
        return {
          content: [{ type: 'text' as const, text: `${preamble}No active session.` }],
        };
      }

      await withTimeout(
        team.recordSessionTokens(state.teamId!, state.sessionId, {
          input_tokens: parsed.input_tokens,
          output_tokens: parsed.output_tokens,
          cache_read_tokens: parsed.cache_read_tokens ?? 0,
          cache_creation_tokens: parsed.cache_creation_tokens ?? 0,
        }),
        API_TIMEOUT_MS,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `${preamble}Token usage recorded: ${parsed.input_tokens} in, ${parsed.output_tokens} out.`,
          },
        ],
      };
    }),
  );

  addTool(
    'chinmeister_record_edit',
    {
      description:
        "Record that you edited a file. Call this each time you modify a source file so chinmeister's edit count and per-file churn metrics stay accurate for tools without hook capture (Aider, Codex, Cline, Continue, JetBrains, Amazon Q). Claude Code, Cursor, and Windsurf already capture edits via hooks — don't double-report from those. Optional but closes the silent-zero gap; calling on every edit is correct.",
      inputSchema: recordEditSchema,
    },
    withTeam(deps, async (args, { preamble }) => {
      const parsed = args as z.infer<typeof recordEditSchema>;

      await withTimeout(
        team.recordEdit(
          state.teamId!,
          parsed.file,
          parsed.lines_added ?? 0,
          parsed.lines_removed ?? 0,
        ),
        API_TIMEOUT_MS,
      );

      const linesSuffix =
        (parsed.lines_added ?? 0) > 0 || (parsed.lines_removed ?? 0) > 0
          ? ` (+${parsed.lines_added ?? 0} / -${parsed.lines_removed ?? 0})`
          : '';
      return {
        content: [
          {
            type: 'text' as const,
            text: `${preamble}Edit recorded: ${parsed.file}${linesSuffix}.`,
          },
        ],
      };
    }),
  );

  addTool(
    'chinmeister_record_tool_call',
    {
      description:
        'Record a tool call for analytics. Call this after executing a tool to help chinmeister track tool usage patterns, error rates, and one-shot success rate. Optional but improves analytics accuracy.',
      inputSchema: recordToolCallSchema,
    },
    withTeam(deps, async (args, { preamble }) => {
      const parsed = args as z.infer<typeof recordToolCallSchema>;

      if (!state.sessionId) {
        return {
          content: [{ type: 'text' as const, text: `${preamble}No active session.` }],
        };
      }

      await withTimeout(
        team.recordToolCalls(state.teamId!, state.sessionId, [
          {
            tool: parsed.tool_name,
            at: Date.now(),
            is_error: !parsed.success,
            error_preview: parsed.error?.slice(0, 200),
            duration_ms: parsed.duration_ms,
          },
        ]),
        API_TIMEOUT_MS,
      );

      const status = parsed.success ? 'succeeded' : 'failed';
      return {
        content: [
          {
            type: 'text' as const,
            text: `${preamble}Tool call recorded: ${parsed.tool_name} ${status}.`,
          },
        ],
      };
    }),
  );
}
