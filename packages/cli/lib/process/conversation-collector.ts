/**
 * Post-session conversation collector.
 *
 * After a managed CLI agent session exits, reads the tool's log files via the
 * declarative spec engine and uploads parsed events to the chinwag backend for
 * conversation, token, and tool-call analytics.
 *
 * The earlier version kept hand-written fallback parsers for Claude Code JSONL
 * and Aider markdown. Those were superseded by specs/*.json plus the spec
 * validator, rolling health window, and self-healing orchestrator (see
 * ANALYTICS_SPEC.md §8). Keeping the hand-written path alive let broken specs
 * silently succeed via the fallback, masking the exact regressions the health
 * system is meant to catch. Extraction is now spec-only; adding support for a
 * new tool is a JSON spec, not TypeScript parser code.
 *
 * Runs asynchronously after session end — never blocks process cleanup.
 */
import { createLogger } from '@chinwag/shared';
import { getDataCapabilities } from '@chinwag/shared/tool-registry.js';
import { recordAttempt } from '../extraction/health.js';
import type { ChinwagConfig } from '@chinwag/shared/config.js';
import { api } from '../api.js';
import { extract } from '../extraction/engine.js';
import { loadSpec } from '../extraction/loader.js';
import type { ManagedProcess } from './types.js';

const log = createLogger('conversation-collector');

// -- Types --

interface ConversationEvent {
  role: 'user' | 'assistant';
  content: string;
  sequence: number;
  created_at?: string | undefined;
  input_tokens?: number | undefined;
  output_tokens?: number | undefined;
  cache_read_tokens?: number | undefined;
  cache_creation_tokens?: number | undefined;
  model?: string | undefined;
  stop_reason?: string | undefined;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

export interface ToolCallEvent {
  tool: string;
  at: number;
  is_error?: boolean | undefined;
  error_preview?: string | undefined;
  input_preview?: string | undefined;
  duration_ms?: number | undefined;
}

// -- Spec-based extraction --

async function extractViaSpec(
  toolId: string,
  cwd: string,
  startedAt: number,
): Promise<{
  conversations: ConversationEvent[];
  tokens: TokenUsage | null;
  toolCalls: ToolCallEvent[];
} | null> {
  const spec = await loadSpec(toolId);
  if (!spec) return null;

  try {
    const result = await extract(spec, cwd, startedAt);

    // Some tools use separate files for conversation vs tokens (e.g. Aider:
    // markdown for conversations, analytics JSONL for tokens). If the primary
    // spec didn't yield tokens, try a {toolId}-tokens spec.
    let tokens = result.tokens;
    if (!tokens) {
      const tokenSpec = await loadSpec(`${toolId}-tokens`);
      if (tokenSpec) {
        const tokenResult = await extract(tokenSpec, cwd, startedAt);
        tokens = tokenResult.tokens;
      }
    }

    const mapped = {
      conversations: result.conversations,
      tokens,
      toolCalls: result.toolCalls.map((tc) => ({
        tool: tc.tool,
        at: tc.at,
        is_error: tc.is_error || undefined,
        error_preview: tc.error_preview,
        input_preview: tc.input_preview,
        duration_ms: tc.duration_ms,
      })),
    };

    const hasOutput =
      mapped.conversations.length > 0 || mapped.tokens !== null || mapped.toolCalls.length > 0;
    recordAttempt(toolId, {
      timestamp: new Date().toISOString(),
      success: hasOutput,
      specUsed: true,
      fallbackUsed: false,
      conversationCount: mapped.conversations.length,
      tokenExtracted: mapped.tokens !== null,
      toolCallCount: mapped.toolCalls.length,
      ...(result.parseHealth ? { parseHealth: result.parseHealth } : {}),
    });

    return mapped;
  } catch (err) {
    recordAttempt(toolId, {
      timestamp: new Date().toISOString(),
      success: false,
      specUsed: true,
      fallbackUsed: false,
      conversationCount: 0,
      tokenExtracted: false,
      toolCallCount: 0,
      error: String(err),
    });

    log.warn(`spec-based extraction failed for ${toolId}: ${err}`);
    return null;
  }
}

type SpecResult = NonNullable<Awaited<ReturnType<typeof extractViaSpec>>>;
type Capability = 'conversationLogs' | 'tokenUsage' | 'toolCallLogs';

/**
 * Shared post-session collection pipeline. Each collector differs only in
 * which slice of the spec result it cares about, how to detect empty output,
 * and which endpoint to post to. Keeping the control flow in one place
 * prevents the three variants drifting.
 */
async function collect<T>(params: {
  proc: ManagedProcess;
  config: ChinwagConfig | null;
  teamId: string | null;
  sessionId: string | null;
  capability: Capability;
  label: string;
  selectFromSpec: (result: SpecResult) => T | null;
  isEmpty: (result: T) => boolean;
  uploadPath: string;
  uploadBody: (result: T) => Record<string, unknown>;
  describeSuccess: (result: T) => string;
}): Promise<void> {
  const { proc, config, teamId, sessionId, capability, label } = params;
  if (!config?.token || !teamId || !sessionId) return;

  const capabilities = getDataCapabilities(proc.toolId);
  if (!capabilities[capability]) return;

  try {
    const specResult = await extractViaSpec(proc.toolId, proc.cwd, proc.startedAt);
    if (!specResult) return;

    const selected = params.selectFromSpec(specResult);
    if (!selected || params.isEmpty(selected)) return;

    log.info(`spec engine extracted ${label} for ${proc.toolId}`);
    const client = api(config, { agentId: proc.agentId });
    await client.post(params.uploadPath, params.uploadBody(selected));
    log.info(params.describeSuccess(selected));
  } catch (err) {
    log.warn(`${label} collection failed: ${err}`);
  }
}

// -- Public API --

/**
 * Collect and upload conversation events from a completed managed session.
 */
export async function collectConversation(
  proc: ManagedProcess,
  config: ChinwagConfig | null,
  teamId: string | null,
  sessionId: string | null,
): Promise<void> {
  await collect<ConversationEvent[]>({
    proc,
    config,
    teamId,
    sessionId,
    capability: 'conversationLogs',
    label: 'conversation events',
    selectFromSpec: (spec) => (spec.conversations.length > 0 ? spec.conversations : null),
    isEmpty: (events) => events.length === 0,
    uploadPath: `/teams/${teamId}/conversations`,
    uploadBody: (events) => ({
      session_id: sessionId,
      host_tool: proc.toolId,
      events,
    }),
    describeSuccess: (events) =>
      `uploaded ${events.length} conversation events for session ${sessionId}`,
  });
}

/**
 * Collect and upload token usage from a completed managed session.
 */
export async function collectTokenUsage(
  proc: ManagedProcess,
  config: ChinwagConfig | null,
  teamId: string | null,
  sessionId: string | null,
): Promise<void> {
  await collect<TokenUsage>({
    proc,
    config,
    teamId,
    sessionId,
    capability: 'tokenUsage',
    label: 'token usage',
    selectFromSpec: (spec) => spec.tokens,
    isEmpty: (usage) =>
      usage.input_tokens === 0 &&
      usage.output_tokens === 0 &&
      usage.cache_read_tokens === 0 &&
      usage.cache_creation_tokens === 0,
    uploadPath: `/teams/${teamId}/sessiontokens`,
    uploadBody: (usage) => ({
      session_id: sessionId,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      cache_creation_tokens: usage.cache_creation_tokens,
    }),
    describeSuccess: (usage) =>
      `uploaded token usage for session ${sessionId}: ${usage.input_tokens} in, ${usage.output_tokens} out, ${usage.cache_read_tokens} cache_read, ${usage.cache_creation_tokens} cache_write`,
  });
}

/**
 * Collect and upload tool call events from a completed managed session.
 */
export async function collectToolCalls(
  proc: ManagedProcess,
  config: ChinwagConfig | null,
  teamId: string | null,
  sessionId: string | null,
): Promise<void> {
  await collect<ToolCallEvent[]>({
    proc,
    config,
    teamId,
    sessionId,
    capability: 'toolCallLogs',
    label: 'tool calls',
    selectFromSpec: (spec) => (spec.toolCalls.length > 0 ? spec.toolCalls : null),
    isEmpty: (calls) => calls.length === 0,
    uploadPath: `/teams/${teamId}/tool-calls`,
    uploadBody: (calls) => ({
      session_id: sessionId,
      calls,
    }),
    describeSuccess: (calls) => {
      const errors = calls.filter((c) => c.is_error).length;
      return (
        `uploaded ${calls.length} tool call events for session ${sessionId}` +
        (errors > 0 ? ` (${errors} errors)` : '')
      );
    },
  });
}
