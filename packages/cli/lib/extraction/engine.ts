/**
 * Generic extraction engine.
 *
 * Executes declarative ParserSpec files against tool log files.
 * Handles JSONL line-by-line processing, JSON parsing, markdown
 * state machines, field resolution with dot-notation + fallbacks,
 * token normalization, and tool call request/result pairing.
 *
 * ~340 lines. Adding a new tool = writing a JSON spec, not code.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { createLogger } from '@chinwag/shared';
import type {
  ParserSpec,
  FileDiscovery,
  TokenExtractionSpec,
  ConversationExtractionSpec,
  ToolCallExtractionSpec,
  MarkdownExtractionSpec,
  NormalizedTokens,
  ExtractedConversation,
  ExtractedToolCall,
  ExtractionResult,
} from './types.js';

const log = createLogger('extraction-engine');

// Warn threshold for JSONL parse rot: if a tool ships a format change that
// corrupts most lines, we want an operator-visible signal immediately — not a
// slow bleed visible only in the rolling health window. Small files (< 10
// lines) are skipped to avoid noise on thin sessions.
const MALFORMED_WARN_RATIO = 0.2;
const MALFORMED_WARN_MIN_LINES = 10;

// ── File discovery ────────────────────────────────

async function discoverFile(
  discovery: FileDiscovery,
  cwd: string,
  startedAt: number,
): Promise<string | null> {
  switch (discovery.strategy) {
    case 'project-hash':
      return discoverProjectHash(discovery.baseDir, discovery.ext, cwd, startedAt);
    case 'glob':
      return discoverGlob(discovery.pattern, startedAt);
    case 'fixed-path':
      return discoverFixed(discovery.relativePath, cwd, startedAt);
  }
}

async function discoverProjectHash(
  baseDir: string,
  ext: string,
  cwd: string,
  startedAt: number,
): Promise<string | null> {
  const resolvedBase = baseDir.replace('~', homedir());
  const projectHash = cwd.replace(/\//g, '-');

  try {
    await stat(resolvedBase);
  } catch {
    return null;
  }

  const dirs = await readdir(resolvedBase);
  const candidates = dirs.filter((d) => d === projectHash || d.endsWith(projectHash));
  const dirsToSearch = candidates.length > 0 ? candidates : dirs;

  let newestFile: string | null = null;
  let newestMtime = 0;

  for (const dir of dirsToSearch) {
    const dirPath = join(resolvedBase, dir);
    const dirStat = await stat(dirPath).catch(() => null);
    if (!dirStat?.isDirectory()) continue;

    const entries = await readdir(dirPath).catch(() => []);
    for (const entry of entries) {
      const entryPath = join(dirPath, entry);
      const entryStat = await stat(entryPath).catch(() => null);

      if (entryStat?.isDirectory()) {
        const subFiles = await readdir(entryPath).catch(() => []);
        for (const file of subFiles) {
          if (!file.endsWith(ext)) continue;
          const filePath = join(entryPath, file);
          const fileStat = await stat(filePath).catch(() => null);
          if (fileStat && fileStat.mtimeMs > startedAt && fileStat.mtimeMs > newestMtime) {
            newestMtime = fileStat.mtimeMs;
            newestFile = filePath;
          }
        }
      } else if (entry.endsWith(ext) && entryStat) {
        if (entryStat.mtimeMs > startedAt && entryStat.mtimeMs > newestMtime) {
          newestMtime = entryStat.mtimeMs;
          newestFile = entryPath;
        }
      }
    }
  }

  return newestFile;
}

async function discoverGlob(pattern: string, startedAt: number): Promise<string | null> {
  const now = new Date();
  const expanded = pattern
    .replace('~', homedir())
    .replace('{YYYY}', String(now.getFullYear()))
    .replace('{MM}', String(now.getMonth() + 1).padStart(2, '0'))
    .replace('{DD}', String(now.getDate()).padStart(2, '0'));

  // Simple glob: split at first wildcard, list files in the directory portion
  const starIdx = expanded.indexOf('*');
  if (starIdx === -1) {
    const s = await stat(expanded).catch(() => null);
    return s && s.mtimeMs > startedAt ? expanded : null;
  }

  const dir = expanded.slice(0, expanded.lastIndexOf('/', starIdx) + 1);
  const suffix = expanded.slice(expanded.lastIndexOf('.'));

  let newest: string | null = null;
  let newestMtime = 0;

  try {
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith(suffix)) continue;
      const full = join(dir, f);
      const s = await stat(full).catch(() => null);
      if (s && s.mtimeMs > startedAt && s.mtimeMs > newestMtime) {
        newestMtime = s.mtimeMs;
        newest = full;
      }
    }
  } catch {
    // directory doesn't exist
  }

  return newest;
}

async function discoverFixed(
  relativePath: string,
  cwd: string,
  startedAt: number,
): Promise<string | null> {
  const full = resolve(cwd, relativePath);
  try {
    const s = await stat(full);
    return s.mtimeMs > startedAt ? full : null;
  } catch {
    return null;
  }
}

// ── Field resolution ──────────────────────────────

function resolvePath(obj: unknown, dotPath: string): unknown {
  let current = obj;
  for (const key of dotPath.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function resolveWithFallbacks(obj: unknown, primary: string, fallbacks?: string[]): unknown {
  const val = resolvePath(obj, primary);
  if (val != null) return val;
  if (!fallbacks) return undefined;
  for (const fb of fallbacks) {
    const fbVal = resolvePath(obj, fb);
    if (fbVal != null) return fbVal;
  }
  return undefined;
}

// ── Token extraction ──────────────────────────────

function extractTokensFromEntry(
  entry: unknown,
  spec: TokenExtractionSpec,
): { input: number; output: number; cacheRead: number; cacheCreation: number } | null {
  // Empty usagePath means token fields live directly on the entry
  const usage = spec.usagePath
    ? resolveWithFallbacks(entry, spec.usagePath, spec.usagePathFallbacks)
    : entry;
  if (!usage || typeof usage !== 'object') return null;

  const u = usage as Record<string, unknown>;
  const input = (u[spec.fieldMapping.input_tokens] as number) ?? 0;
  const output = (u[spec.fieldMapping.output_tokens] as number) ?? 0;
  const cacheRead = spec.fieldMapping.cache_read_tokens
    ? ((u[spec.fieldMapping.cache_read_tokens] as number) ?? 0)
    : 0;
  const cacheCreation = spec.fieldMapping.cache_creation_tokens
    ? ((u[spec.fieldMapping.cache_creation_tokens] as number) ?? 0)
    : 0;

  return { input, output, cacheRead, cacheCreation };
}

function normalizeTokens(
  raw: { input: number; output: number; cacheRead: number; cacheCreation: number },
  normalization: 'anthropic' | 'openai',
): NormalizedTokens {
  if (normalization === 'openai') {
    return {
      input_tokens: Math.max(0, raw.input - raw.cacheRead),
      output_tokens: raw.output,
      cache_read_tokens: raw.cacheRead,
      cache_creation_tokens: 0,
    };
  }
  return {
    input_tokens: raw.input,
    output_tokens: raw.output,
    cache_read_tokens: raw.cacheRead,
    cache_creation_tokens: raw.cacheCreation,
  };
}

// ── Conversation extraction (JSONL/JSON) ──────────

function extractConversationFromEntry(
  entry: unknown,
  spec: ConversationExtractionSpec,
  sequence: number,
): ExtractedConversation | null {
  let role: 'user' | 'assistant' | null = null;
  const fields = [spec.roleDetection.field, ...(spec.roleDetection.fieldFallbacks ?? [])];
  for (const f of fields) {
    const val = String(resolvePath(entry, f) ?? '');
    if (spec.roleDetection.userValues.includes(val)) {
      role = 'user';
      break;
    }
    if (spec.roleDetection.assistantValues.includes(val)) {
      role = 'assistant';
      break;
    }
  }
  if (!role) return null;

  let content: string | null = null;
  for (const path of spec.contentPaths) {
    const val = resolvePath(entry, path);
    if (typeof val === 'string' && val.length > 0) {
      content = val;
      break;
    }
    if (Array.isArray(val)) {
      const texts = (val as Array<Record<string, unknown>>)
        .filter((b) => b.type === 'text')
        .map((b) => b.text as string)
        .filter(Boolean);
      if (texts.length > 0) {
        content = texts.join('\n');
        break;
      }
    }
  }
  if (!content) return null;

  const timestamp = spec.timestampPath
    ? (resolvePath(entry, spec.timestampPath) as string | undefined)
    : undefined;

  const result: ExtractedConversation = {
    role,
    content,
    sequence,
    created_at: timestamp || undefined,
  };

  // Per-message token/model/stop_reason (assistant entries only in practice)
  if (spec.tokenPaths) {
    const it = resolvePath(entry, spec.tokenPaths.input_tokens) as number | undefined;
    const ot = resolvePath(entry, spec.tokenPaths.output_tokens) as number | undefined;
    if (it != null) result.input_tokens = it;
    if (ot != null) result.output_tokens = ot;
    if (spec.tokenPaths.cache_read_tokens) {
      const cr = resolvePath(entry, spec.tokenPaths.cache_read_tokens) as number | undefined;
      if (cr != null) result.cache_read_tokens = cr;
    }
    if (spec.tokenPaths.cache_creation_tokens) {
      const cc = resolvePath(entry, spec.tokenPaths.cache_creation_tokens) as number | undefined;
      if (cc != null) result.cache_creation_tokens = cc;
    }
  }
  if (spec.modelPath) {
    const m = resolvePath(entry, spec.modelPath) as string | undefined;
    if (m) result.model = m;
  }
  if (spec.stopReasonPath) {
    const sr = resolvePath(entry, spec.stopReasonPath) as string | undefined;
    if (sr) result.stop_reason = sr;
  }

  return result;
}

// ── Conversation extraction (markdown) ────────────

function extractMarkdownConversations(
  content: string,
  spec: MarkdownExtractionSpec,
): ExtractedConversation[] {
  const events: ExtractedConversation[] = [];
  const lines = content.split('\n');
  let sequence = 0;
  let currentRole: 'user' | 'assistant' | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith(spec.userMarker)) {
      if (currentRole && currentContent.length > 0) {
        events.push({
          role: currentRole,
          content: currentContent.join('\n').trim(),
          sequence: sequence++,
        });
        currentContent = [];
      }
      currentRole = 'user';
      const text = line.slice(spec.userMarker.length).trim();
      if (text) currentContent.push(text);
    } else if (line.startsWith(spec.assistantMarker)) {
      if (currentRole === 'user' && currentContent.length > 0) {
        events.push({
          role: currentRole,
          content: currentContent.join('\n').trim(),
          sequence: sequence++,
        });
        currentContent = [];
      }
      currentRole = 'assistant';
      currentContent.push(line.slice(spec.assistantMarker.length));
    } else if (currentRole) {
      currentContent.push(line);
    }
  }

  if (currentRole && currentContent.length > 0) {
    events.push({
      role: currentRole,
      content: currentContent.join('\n').trim(),
      sequence: sequence++,
    });
  }

  return events;
}

// ── Tool call extraction ──────────────────────────

function extractToolCallsFromEntries(
  entries: unknown[],
  spec: ToolCallExtractionSpec,
): ExtractedToolCall[] {
  const requests = new Map<string, { name: string; timestamp: string; inputPreview: string }>();
  const results = new Map<
    string,
    { timestamp: string; isError: boolean; errorPreview: string | null }
  >();

  for (const entry of entries) {
    const blocks = resolveWithFallbacks(
      entry,
      spec.requestBlock.contentPath,
      spec.requestBlock.contentPathFallbacks,
    );
    if (!Array.isArray(blocks)) continue;

    const timestamp = (resolvePath(entry, 'timestamp') as string) || '';

    for (const block of blocks) {
      const b = block as Record<string, unknown>;
      if (b.type === spec.requestBlock.typeValue) {
        const id = resolvePath(b, spec.requestBlock.idPath) as string;
        const name = resolvePath(b, spec.requestBlock.namePath) as string;
        if (!id || !name) continue;

        let preview = '';
        for (const p of spec.requestBlock.inputPreviewPaths) {
          const val = resolvePath(b, p);
          if (val != null) {
            preview = String(val).slice(0, 200);
            break;
          }
        }
        requests.set(id, { name, timestamp, inputPreview: preview });
      } else if (b.type === spec.resultBlock.typeValue) {
        const id = resolvePath(b, spec.resultBlock.idPath) as string;
        if (!id) continue;
        const isError = resolvePath(b, spec.resultBlock.errorPath) === true;
        const errorContent = isError
          ? String(resolvePath(b, spec.resultBlock.errorContentPath) || '').slice(0, 200)
          : null;
        results.set(id, { timestamp, isError, errorPreview: errorContent });
      }
    }
  }

  const calls: ExtractedToolCall[] = [];
  for (const [id, req] of requests) {
    const res = results.get(id);
    const requestedAt = req.timestamp ? new Date(req.timestamp).getTime() : 0;
    const completedAt = res?.timestamp ? new Date(res.timestamp).getTime() : 0;
    const durationMs = requestedAt > 0 && completedAt > 0 ? completedAt - requestedAt : undefined;

    calls.push({
      tool: req.name,
      at: requestedAt || Date.now(),
      is_error: res?.isError || false,
      error_preview: res?.errorPreview || undefined,
      input_preview: req.inputPreview || undefined,
      duration_ms: durationMs && durationMs >= 0 ? durationMs : undefined,
    });
  }

  return calls;
}

// ── Main extraction function ──────────────────────

function isMarkdownSpec(
  spec: ConversationExtractionSpec | MarkdownExtractionSpec,
): spec is MarkdownExtractionSpec {
  return 'userMarker' in spec;
}

export async function extract(
  spec: ParserSpec,
  cwd: string,
  startedAt: number,
): Promise<ExtractionResult> {
  const file = await discoverFile(spec.discovery, cwd, startedAt);
  if (!file) return { conversations: [], tokens: null, toolCalls: [] };

  const content = await readFile(file, 'utf-8');

  if (spec.format === 'markdown') {
    const convSpec = spec.extractions.conversation;
    const conversations =
      convSpec && isMarkdownSpec(convSpec) ? extractMarkdownConversations(content, convSpec) : [];
    return { conversations, tokens: null, toolCalls: [] };
  }

  // JSONL or JSON: parse entries
  let entries: unknown[];
  let parseHealth: ExtractionResult['parseHealth'];
  if (spec.format === 'jsonl') {
    entries = [];
    let totalLines = 0;
    let malformedLines = 0;
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      totalLines++;
      try {
        entries.push(JSON.parse(line));
      } catch {
        malformedLines++;
      }
    }
    parseHealth = {
      totalLines,
      parsedLines: totalLines - malformedLines,
      malformedLines,
    };
    if (
      totalLines >= MALFORMED_WARN_MIN_LINES &&
      malformedLines / totalLines >= MALFORMED_WARN_RATIO
    ) {
      log.warn(
        `JSONL parse health degraded for ${spec.tool}: ${malformedLines}/${totalLines} lines unparseable (${Math.round((malformedLines / totalLines) * 100)}%)`,
        { tool: spec.tool, file, totalLines, malformedLines },
      );
    }
  } else {
    try {
      const parsed = JSON.parse(content);
      entries = Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      log.warn(`JSON parse failed for ${spec.tool}`, {
        tool: spec.tool,
        file,
        error: err instanceof Error ? err.message : String(err),
      });
      return { conversations: [], tokens: null, toolCalls: [] };
    }
  }

  // Conversations
  const conversations: ExtractedConversation[] = [];
  if (spec.extractions.conversation && !isMarkdownSpec(spec.extractions.conversation)) {
    const convSpec = spec.extractions.conversation;
    let seq = 0;
    for (const entry of entries) {
      const ev = extractConversationFromEntry(entry, convSpec, seq);
      if (ev) {
        conversations.push(ev);
        seq++;
      }
    }
  }

  // Tokens
  let tokens: NormalizedTokens | null = null;
  if (spec.extractions.tokens) {
    const tokSpec = spec.extractions.tokens;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;

    for (const entry of entries) {
      const raw = extractTokensFromEntry(entry, tokSpec);
      if (raw) {
        totalInput += raw.input;
        totalOutput += raw.output;
        totalCacheRead += raw.cacheRead;
        totalCacheCreation += raw.cacheCreation;
      }
    }

    if (totalInput > 0 || totalOutput > 0 || totalCacheRead > 0 || totalCacheCreation > 0) {
      tokens = normalizeTokens(
        {
          input: totalInput,
          output: totalOutput,
          cacheRead: totalCacheRead,
          cacheCreation: totalCacheCreation,
        },
        tokSpec.normalization,
      );
    }
  }

  // Tool calls
  let toolCalls: ExtractedToolCall[] = [];
  if (spec.extractions.toolCalls) {
    toolCalls = extractToolCallsFromEntries(entries, spec.extractions.toolCalls);
  }

  return parseHealth
    ? { conversations, tokens, toolCalls, parseHealth }
    : { conversations, tokens, toolCalls };
}
