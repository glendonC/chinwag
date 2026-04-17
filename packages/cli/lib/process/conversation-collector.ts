/**
 * Post-session conversation collector.
 *
 * After a managed CLI agent session exits, reads conversation logs and
 * uploads parsed events to the chinwag backend for conversation analytics.
 *
 * Supported tools:
 * - Claude Code: reads JSONL conversation files from ~/.claude/projects/
 * - Aider: reads .aider.chat.history.md from the working directory
 *
 * Runs asynchronously after session end — never blocks process cleanup.
 */
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
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

type ConversationParser = (cwd: string, startedAt: number) => Promise<ConversationEvent[]>;
type TokenParser = (cwd: string, startedAt: number) => Promise<TokenUsage | null>;
type ToolCallParser = (cwd: string, startedAt: number) => Promise<ToolCallEvent[]>;

// -- Spec-based extraction (primary path) --
// Tries declarative JSON spec first. Falls back to hand-written parsers
// for tools that don't have a spec yet or if the spec engine fails.

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

    // Record health: spec-based extraction succeeded
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
    // Record health: spec-based extraction failed
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

    log.warn(
      `spec-based extraction failed for ${toolId}, falling back to hand-written parser: ${err}`,
    );
    return null;
  }
}

// -- Hand-written parser registries (fallback) --
// Kept alongside spec-based extraction until every tool has a validated spec.

const CONVERSATION_PARSERS: Record<string, ConversationParser> = {
  'claude-code': parseClaudeCodeConversation,
  aider: parseAiderConversation,
};

const TOKEN_PARSERS: Record<string, TokenParser> = {
  'claude-code': extractClaudeCodeTokenUsage,
};

const TOOL_CALL_PARSERS: Record<string, ToolCallParser> = {
  'claude-code': parseClaudeCodeToolCalls,
};

type SpecResult = NonNullable<Awaited<ReturnType<typeof extractViaSpec>>>;
type Capability = 'conversationLogs' | 'tokenUsage' | 'toolCallLogs';

/**
 * Shared post-session collection pipeline. Each collector differs only in
 * which slice of the spec result it cares about, which hand-written parser
 * to fall back to, how to detect empty output, and which endpoint to post.
 * Keeping the control flow in one place prevents the three variants drifting.
 */
async function collect<T>(params: {
  proc: ManagedProcess;
  config: ChinwagConfig | null;
  teamId: string | null;
  sessionId: string | null;
  capability: Capability;
  label: string;
  selectFromSpec: (result: SpecResult) => T | null;
  handWrittenParser: ((cwd: string, startedAt: number) => Promise<T | null>) | undefined;
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
    let result: T | null = null;

    const specResult = await extractViaSpec(proc.toolId, proc.cwd, proc.startedAt);
    if (specResult) {
      const fromSpec = params.selectFromSpec(specResult);
      if (fromSpec && !params.isEmpty(fromSpec)) {
        result = fromSpec;
        log.info(`spec engine extracted ${label} for ${proc.toolId}`);
      }
    }

    if (!result && params.handWrittenParser) {
      const fromParser = await params.handWrittenParser(proc.cwd, proc.startedAt);
      if (fromParser && !params.isEmpty(fromParser)) {
        result = fromParser;
      }
    }

    if (!result) return;

    const client = api(config, { agentId: proc.agentId });
    await client.post(params.uploadPath, params.uploadBody(result));
    log.info(params.describeSuccess(result));
  } catch (err) {
    log.warn(`${label} collection failed: ${err}`);
  }
}

// -- Public API --

/**
 * Collect and upload conversation events from a completed managed session.
 * Tries spec-based extraction first, falls back to hand-written parsers.
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
    handWrittenParser: CONVERSATION_PARSERS[proc.toolId],
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
 * Tries spec-based extraction first, falls back to hand-written parsers.
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
    handWrittenParser: TOKEN_PARSERS[proc.toolId],
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
 * Tries spec-based extraction first, falls back to hand-written parsers.
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
    handWrittenParser: TOOL_CALL_PARSERS[proc.toolId],
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

// -- Claude Code shared helpers --

/**
 * Find the newest JSONL file for a Claude Code project.
 * Claude Code stores sessions in ~/.claude/projects/<project-hash>/
 * where project-hash is the CWD path with / replaced by -.
 */
async function findNewestClaudeCodeJsonl(cwd: string, startedAt: number): Promise<string | null> {
  const projectsDir = join(homedir(), '.claude', 'projects');

  try {
    await stat(projectsDir);
  } catch {
    return null;
  }

  const projectHash = cwd.replace(/\//g, '-');

  const candidates: string[] = [];
  const projectDirs = await readdir(projectsDir);

  for (const dir of projectDirs) {
    if (dir === projectHash || dir.endsWith(projectHash)) {
      candidates.push(dir);
    }
  }

  const dirsToSearch = candidates.length > 0 ? candidates : projectDirs;
  if (candidates.length === 0) {
    log.warn(`no exact project match for ${projectHash}, searching all projects`);
  }

  let newestFile: string | null = null;
  let newestMtime = 0;

  for (const dir of dirsToSearch) {
    const dirPath = join(projectsDir, dir);
    const dirStat = await stat(dirPath).catch(() => null);
    if (!dirStat?.isDirectory()) continue;

    const entries = await readdir(dirPath).catch(() => []);
    for (const entry of entries) {
      const entryPath = join(dirPath, entry);
      const entryStat = await stat(entryPath).catch(() => null);

      if (entryStat?.isDirectory()) {
        const subFiles = await readdir(entryPath).catch(() => []);
        for (const file of subFiles) {
          if (!file.endsWith('.jsonl')) continue;
          const filePath = join(entryPath, file);
          const fileStat = await stat(filePath).catch(() => null);
          if (!fileStat) continue;
          if (fileStat.mtimeMs > startedAt && fileStat.mtimeMs > newestMtime) {
            newestMtime = fileStat.mtimeMs;
            newestFile = filePath;
          }
        }
      } else if (entry.endsWith('.jsonl') && entryStat) {
        if (entryStat.mtimeMs > startedAt && entryStat.mtimeMs > newestMtime) {
          newestMtime = entryStat.mtimeMs;
          newestFile = entryPath;
        }
      }
    }
  }

  return newestFile;
}

// -- Claude Code conversation parser --

async function parseClaudeCodeConversation(
  cwd: string,
  startedAt: number,
): Promise<ConversationEvent[]> {
  try {
    const file = await findNewestClaudeCodeJsonl(cwd, startedAt);
    if (!file) return [];
    const content = await readFile(file, 'utf-8');
    return parseClaudeCodeJsonl(content);
  } catch (err) {
    log.warn(`failed to read Claude Code conversations: ${err}`);
    return [];
  }
}

function parseClaudeCodeJsonl(content: string): ConversationEvent[] {
  const events: ConversationEvent[] = [];
  const lines = content.split('\n').filter(Boolean);
  let sequence = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      // Claude Code JSONL format has type: 'human' or 'assistant' messages
      if (entry.type === 'human' || entry.role === 'user') {
        const text = extractMessageText(entry);
        if (text) {
          events.push({
            role: 'user',
            content: text,
            sequence: sequence++,
            created_at: entry.timestamp || undefined,
          });
        }
      } else if (entry.type === 'assistant' || entry.role === 'assistant') {
        const text = extractMessageText(entry);
        if (text) {
          events.push({
            role: 'assistant',
            content: text,
            sequence: sequence++,
            created_at: entry.timestamp || undefined,
          });
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

function extractMessageText(entry: Record<string, unknown>): string | null {
  // Handle various message content formats
  if (typeof entry.message === 'string') return entry.message;
  if (typeof entry.text === 'string') return entry.text;
  if (typeof entry.content === 'string') return entry.content;

  // Handle content array format (Anthropic API style)
  if (Array.isArray(entry.content)) {
    const textParts = (entry.content as Array<Record<string, unknown>>)
      .filter((block) => block.type === 'text')
      .map((block) => block.text as string)
      .filter(Boolean);
    return textParts.length > 0 ? textParts.join('\n') : null;
  }

  // Handle nested message object
  if (entry.message && typeof entry.message === 'object') {
    const msg = entry.message as Record<string, unknown>;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      const textParts = (msg.content as Array<Record<string, unknown>>)
        .filter((block) => block.type === 'text')
        .map((block) => block.text as string)
        .filter(Boolean);
      return textParts.length > 0 ? textParts.join('\n') : null;
    }
  }

  return null;
}

// -- Aider parser --

/**
 * Parse Aider's conversation history file.
 * Aider writes `.aider.chat.history.md` in the project directory.
 */
async function parseAiderConversation(
  cwd: string,
  startedAt: number,
): Promise<ConversationEvent[]> {
  const historyPath = join(cwd, '.aider.chat.history.md');

  try {
    const fileStat = await stat(historyPath);
    // Only read if modified after session started
    if (fileStat.mtimeMs < startedAt) return [];

    const content = await readFile(historyPath, 'utf-8');
    return parseAiderMarkdown(content);
  } catch {
    return [];
  }
}

function parseAiderMarkdown(content: string): ConversationEvent[] {
  const events: ConversationEvent[] = [];
  const lines = content.split('\n');
  let sequence = 0;
  let currentRole: 'user' | 'assistant' | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    // Aider uses #### markers for user messages and #### for assistant
    if (line.startsWith('#### ')) {
      // Flush previous message
      if (currentRole && currentContent.length > 0) {
        events.push({
          role: currentRole,
          content: currentContent.join('\n').trim(),
          sequence: sequence++,
        });
        currentContent = [];
      }
      currentRole = 'user';
      const text = line.slice(5).trim();
      if (text) currentContent.push(text);
    } else if (line.startsWith('> ')) {
      // Assistant responses in blockquotes
      if (currentRole === 'user' && currentContent.length > 0) {
        events.push({
          role: currentRole,
          content: currentContent.join('\n').trim(),
          sequence: sequence++,
        });
        currentContent = [];
      }
      currentRole = 'assistant';
      currentContent.push(line.slice(2));
    } else if (currentRole) {
      currentContent.push(line);
    }
  }

  // Flush last message
  if (currentRole && currentContent.length > 0) {
    events.push({
      role: currentRole,
      content: currentContent.join('\n').trim(),
      sequence: sequence++,
    });
  }

  return events;
}

// -- Token extraction --

/**
 * Extract token usage from Claude Code JSONL conversation files.
 *
 * Sums all four Anthropic token fields — input (non-cached), output, cache
 * creation (prompt-cache writes), and cache read (prompt-cache hits). Without
 * the cache fields, heavy-cache workloads (Claude Code's default) report ~7%
 * of real token volume and a materially wrong cost number downstream.
 */
async function extractClaudeCodeTokenUsage(
  cwd: string,
  startedAt: number,
): Promise<TokenUsage | null> {
  try {
    const file = await findNewestClaudeCodeJsonl(cwd, startedAt);
    if (!file) return null;

    const content = await readFile(file, 'utf-8');
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;

    for (const line of content.split('\n').filter(Boolean)) {
      try {
        const entry = JSON.parse(line);
        const usage =
          entry.usage ||
          (entry.message && typeof entry.message === 'object' ? entry.message.usage : null);
        if (usage && typeof usage === 'object') {
          // Nullish coalescing, not falsy — a measured zero is valid data and
          // must not be treated as "missing field."
          totalInput += (usage.input_tokens as number) ?? 0;
          totalOutput += (usage.output_tokens as number) ?? 0;
          totalCacheRead += (usage.cache_read_input_tokens as number) ?? 0;
          totalCacheCreation += (usage.cache_creation_input_tokens as number) ?? 0;
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (totalInput === 0 && totalOutput === 0 && totalCacheRead === 0 && totalCacheCreation === 0) {
      return null;
    }
    return {
      input_tokens: totalInput,
      output_tokens: totalOutput,
      cache_read_tokens: totalCacheRead,
      cache_creation_tokens: totalCacheCreation,
    };
  } catch (err) {
    log.warn(`failed to extract Claude Code token usage: ${err}`);
    return null;
  }
}

// -- Claude Code tool call parser --

/**
 * Extract per-tool-call events from Claude Code JSONL files.
 * Each tool_use content block on assistant messages is paired with
 * its matching tool_result on the subsequent user message.
 */
async function parseClaudeCodeToolCalls(cwd: string, startedAt: number): Promise<ToolCallEvent[]> {
  try {
    const file = await findNewestClaudeCodeJsonl(cwd, startedAt);
    if (!file) return [];

    const content = await readFile(file, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    // First pass: collect tool_use requests and tool_result responses
    const requests = new Map<string, { name: string; timestamp: string; inputPreview: string }>();
    const results = new Map<
      string,
      { timestamp: string; isError: boolean; errorPreview: string | null }
    >();

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const contentBlocks = Array.isArray(entry.content)
          ? entry.content
          : entry.message?.content && Array.isArray(entry.message.content)
            ? entry.message.content
            : [];

        for (const block of contentBlocks) {
          if (block.type === 'tool_use' && block.id && block.name) {
            const input = block.input || {};
            const preview =
              input.file_path || input.command?.slice(0, 200) || input.pattern || input.query || '';
            requests.set(block.id, {
              name: block.name,
              timestamp: entry.timestamp || '',
              inputPreview: String(preview).slice(0, 200),
            });
          } else if (block.type === 'tool_result' && block.tool_use_id) {
            const isError = block.is_error === true;
            const errorContent = isError ? String(block.content || '').slice(0, 200) : null;
            results.set(block.tool_use_id, {
              timestamp: entry.timestamp || '',
              isError,
              errorPreview: errorContent,
            });
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Pair requests with results
    const events: ToolCallEvent[] = [];
    for (const [id, req] of requests) {
      const res = results.get(id);
      const requestedAt = req.timestamp ? new Date(req.timestamp).getTime() : 0;
      const completedAt = res?.timestamp ? new Date(res.timestamp).getTime() : 0;
      const durationMs = requestedAt > 0 && completedAt > 0 ? completedAt - requestedAt : undefined;

      events.push({
        tool: req.name,
        at: requestedAt || Date.now(),
        is_error: res?.isError || false,
        error_preview: res?.errorPreview || undefined,
        input_preview: req.inputPreview || undefined,
        duration_ms: durationMs && durationMs >= 0 ? durationMs : undefined,
      });
    }

    return events;
  } catch (err) {
    log.warn(`failed to parse Claude Code tool calls: ${err}`);
    return [];
  }
}
