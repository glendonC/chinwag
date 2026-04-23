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
import { homedir, platform } from 'os';
import { createLogger } from '@chinmeister/shared';
import type {
  ParserSpec,
  FileDiscovery,
  TokenExtractionSpec,
  ConversationExtractionSpec,
  ToolCallExtractionSpec,
  MarkdownExtractionSpec,
  ModelStateCarry,
  SqliteSource,
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
    case 'per-os-path':
      return discoverPerOsPath(discovery.paths, startedAt);
    case 'per-session-subdir':
      return discoverPerSessionSubdir(discovery.baseDir, discovery.filename, startedAt);
  }
}

async function discoverPerSessionSubdir(
  baseDir: string,
  filename: string,
  startedAt: number,
): Promise<string | null> {
  const resolvedBase = baseDir.replace('~', homedir());
  try {
    await stat(resolvedBase);
  } catch {
    return null;
  }

  const dirs = await readdir(resolvedBase).catch(() => []);
  let newestFile: string | null = null;
  let newestMtime = 0;

  for (const dir of dirs) {
    const candidate = join(resolvedBase, dir, filename);
    const s = await stat(candidate).catch(() => null);
    if (!s || !s.isFile()) continue;
    if (s.mtimeMs > startedAt && s.mtimeMs > newestMtime) {
      newestMtime = s.mtimeMs;
      newestFile = candidate;
    }
  }

  return newestFile;
}

async function discoverPerOsPath(
  paths: { darwin: string; linux: string; win32: string },
  startedAt: number,
): Promise<string | null> {
  const os = platform() as 'darwin' | 'linux' | 'win32' | string;
  const raw = os === 'darwin' ? paths.darwin : os === 'win32' ? paths.win32 : paths.linux;
  if (!raw) return null;
  const full = raw.replace('~', homedir());
  try {
    const s = await stat(full);
    // SQLite DBs update the file mtime on every write, so the startedAt gate
    // still filters out stale DBs from before the session began.
    return s.mtimeMs > startedAt ? full : null;
  } catch {
    return null;
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

// ── SQLite source ─────────────────────────────────

/**
 * Guard against queries that could do anything other than SELECT. Specs ship
 * with chinmeister and AI-healed specs must pass the validator, but cheap
 * defense-in-depth is free: reject anything with a statement terminator, any
 * DDL/DML keyword, or PRAGMA/ATTACH/DETACH. Comments are stripped first so a
 * `-- DROP TABLE foo` comment is not flagged.
 */
function isSafeReadOnlyQuery(query: string): boolean {
  const stripped = query
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  if (/;\s*\S/.test(stripped)) return false; // multi-statement
  if (!/^\s*SELECT\b/i.test(stripped)) return false;
  const forbidden =
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|BEGIN|COMMIT|ROLLBACK|TRIGGER)\b/i;
  if (forbidden.test(stripped)) return false;
  return true;
}

/**
 * Open the SQLite DB at `file`, run `source.query`, and return each row as a
 * plain object. Column names become entry keys — downstream extraction uses
 * the same dot-notation path resolver as JSONL, so `json_extract()` in the
 * query is the right place to flatten nested fields before they hit the
 * extraction specs.
 *
 * Module load is dynamic: `better-sqlite3` is an optional runtime dep. If it
 * is missing, we warn once and return an empty array so callers degrade to
 * "no data" gracefully rather than blowing up the whole extraction pipeline.
 *
 * Long-term: when Node 24's stable `node:sqlite` becomes our minimum runtime,
 * swap the dynamic import target and drop the dep. No other call sites.
 */
// Minimal structural type for the subset of the better-sqlite3 surface we use.
// Keeping this inline (rather than depending on `@types/better-sqlite3`) means
// the optional dep can be missing at install time without breaking typecheck.
type SqliteDatabaseLike = {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
};
type SqliteCtor = new (
  path: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabaseLike;

async function runSqliteQuery(file: string, source: SqliteSource): Promise<unknown[]> {
  if (!isSafeReadOnlyQuery(source.query)) {
    log.warn(`rejecting unsafe SQLite query for ${file}`, {
      file,
      table: source.table,
    });
    return [];
  }

  let Database: SqliteCtor;
  try {
    // Dynamic import so builds/tests without the native module still work.
    // When we move to Node 24's stable `node:sqlite` as minimum runtime, swap
    // the specifier here — no other call sites.
    const mod = (await import('better-sqlite3' as string)) as { default: SqliteCtor };
    Database = mod.default;
  } catch (err) {
    log.warn('better-sqlite3 not available; SQLite extraction skipped', {
      file,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  let db: SqliteDatabaseLike | null = null;
  try {
    // readonly + fileMustExist avoids accidentally creating an empty DB if the
    // path resolves to a missing file (e.g. first run on a fresh machine).
    db = new Database(file, { readonly: true, fileMustExist: true });
    return db.prepare(source.query).all();
  } catch (err) {
    log.warn(`SQLite query failed for ${file}`, {
      file,
      table: source.table,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  } finally {
    try {
      db?.close();
    } catch {
      // ignore close errors
    }
  }
}

// ── Pre-pass: carried state across entries ────────

/**
 * Some tools (Copilot today) emit stateful context on their own line — e.g. a
 * `session.model_change` event sets the model for every subsequent message
 * until the next change. The extraction engine is otherwise stateless per
 * entry, so the pre-pass walks entries in order, tracks the carry value, and
 * injects it into later entries at `carryTargetPath` before extraction runs.
 *
 * The carry event is detected on the same field used for role detection
 * (`ConversationExtractionSpec.roleDetection.field`). This is correct for
 * Copilot and keeps the spec surface narrow. If a future tool separates the
 * carry-event field from the role field, add a dedicated `carryFromField` to
 * `ModelStateCarry` rather than repurposing this helper.
 *
 * Entries whose carry target is already populated are left untouched — a
 * tool-emitted value always wins over an inferred carry.
 */
function applyModelStateCarry(
  entries: unknown[],
  carry: ModelStateCarry,
  conversationSpec: ConversationExtractionSpec | undefined,
): unknown[] {
  if (!conversationSpec) return entries;
  const roleField = conversationSpec.roleDetection.field;
  const targetPath = carry.carryTargetPath ?? 'model';
  let current: string | undefined;
  const out: unknown[] = [];

  for (const entry of entries) {
    if (entry == null || typeof entry !== 'object') {
      out.push(entry);
      continue;
    }
    const typeVal = String(resolvePath(entry, roleField) ?? '');
    if (typeVal === carry.carryFromEvent) {
      const val = resolvePath(entry, carry.carryFromPath);
      if (typeof val === 'string' && val.length > 0) current = val;
      out.push(entry);
      continue;
    }
    if (current && resolvePath(entry, targetPath) == null) {
      out.push(injectPath(entry, targetPath, current));
    } else {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Return a shallow-cloned copy of `obj` with `value` set at `dotPath`. Nested
 * objects along the path are created lazily. Does not mutate the input.
 */
function injectPath(obj: object, dotPath: string, value: unknown): object {
  const keys = dotPath.split('.');
  const root: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (k === undefined) continue;
    const next = cursor[k];
    const nextObj: Record<string, unknown> =
      next && typeof next === 'object' ? { ...(next as Record<string, unknown>) } : {};
    cursor[k] = nextObj;
    cursor = nextObj;
  }
  const last = keys[keys.length - 1];
  if (last !== undefined) cursor[last] = value;
  return root;
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
  /**
   * Normalization applied to per-message token fields before they land on
   * the ExtractedConversation. Without this, OpenAI-shaped specs (Codex,
   * Aider) would store raw per-message tokens with cached still nested in
   * input — a different quantity than the session-level aggregate, which
   * is already normalized by the tokens-extraction path. Keeping them in
   * the same domain is what lets downstream per-message aggregation SQL
   * sum values across the conversation_events table without rewriting
   * OpenAI math at query time.
   */
  tokenNormalization: 'anthropic' | 'openai' = 'anthropic',
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

  // Per-message token/model/stop_reason (assistant entries only in practice).
  // Values flow through normalizeTokens so the conversation_events table
  // stays in the same domain as sessions.*_tokens — OpenAI rows subtract
  // cached from input, Anthropic rows pass through additive.
  if (spec.tokenPaths) {
    const rawInput = (resolvePath(entry, spec.tokenPaths.input_tokens) as number | undefined) ?? 0;
    const rawOutput =
      (resolvePath(entry, spec.tokenPaths.output_tokens) as number | undefined) ?? 0;
    const rawCacheRead = spec.tokenPaths.cache_read_tokens
      ? ((resolvePath(entry, spec.tokenPaths.cache_read_tokens) as number | undefined) ?? 0)
      : 0;
    const rawCacheCreation = spec.tokenPaths.cache_creation_tokens
      ? ((resolvePath(entry, spec.tokenPaths.cache_creation_tokens) as number | undefined) ?? 0)
      : 0;
    // Only attach when the source provided at least one token signal — a
    // bare assistant turn with no usage shouldn't pollute the record with
    // zeroes that look like a measured zero.
    const anyToken =
      resolvePath(entry, spec.tokenPaths.input_tokens) != null ||
      resolvePath(entry, spec.tokenPaths.output_tokens) != null;
    if (anyToken) {
      const normalized = normalizeTokens(
        {
          input: rawInput,
          output: rawOutput,
          cacheRead: rawCacheRead,
          cacheCreation: rawCacheCreation,
        },
        tokenNormalization,
      );
      result.input_tokens = normalized.input_tokens;
      result.output_tokens = normalized.output_tokens;
      if (spec.tokenPaths.cache_read_tokens) {
        result.cache_read_tokens = normalized.cache_read_tokens;
      }
      if (spec.tokenPaths.cache_creation_tokens) {
        result.cache_creation_tokens = normalized.cache_creation_tokens;
      }
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

  // Markdown and SQLite follow distinct content paths; JSONL/JSON share the
  // "read text, parse, then extract" flow so they're handled together below.
  if (spec.format === 'markdown') {
    const content = await readFile(file, 'utf-8');
    const convSpec = spec.extractions.conversation;
    const conversations =
      convSpec && isMarkdownSpec(convSpec) ? extractMarkdownConversations(content, convSpec) : [];
    return { conversations, tokens: null, toolCalls: [] };
  }

  // Collect entries from whichever source the spec declares. Downstream
  // extraction is source-agnostic — each entry is just a plain object.
  let entries: unknown[];
  let parseHealth: ExtractionResult['parseHealth'];
  if (spec.format === 'sqlite') {
    if (!spec.sqlite) {
      log.warn(`sqlite spec missing 'sqlite' source config for ${spec.tool}`, {
        tool: spec.tool,
      });
      return { conversations: [], tokens: null, toolCalls: [] };
    }
    entries = await runSqliteQuery(file, spec.sqlite);
  } else if (spec.format === 'jsonl') {
    const content = await readFile(file, 'utf-8');
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
    const content = await readFile(file, 'utf-8');
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

  // Pre-pass: apply any declared carry-forward state (e.g. Copilot's
  // session.model_change). Must run before extraction so conversation, token,
  // and tool-call specs see rewritten entries consistently.
  const convSpecForPrepass = spec.extractions.conversation;
  if (spec.prepass?.modelState && convSpecForPrepass && !isMarkdownSpec(convSpecForPrepass)) {
    entries = applyModelStateCarry(entries, spec.prepass.modelState, convSpecForPrepass);
  }

  // Conversations. The tokens-extraction spec (when present) carries the
  // normalization semantics for this tool; passing it here keeps per-message
  // tokens on conversation_events in the same domain as sessions.*_tokens.
  const conversations: ExtractedConversation[] = [];
  if (spec.extractions.conversation && !isMarkdownSpec(spec.extractions.conversation)) {
    const convSpec = spec.extractions.conversation;
    const tokenNormalization = spec.extractions.tokens?.normalization ?? 'anthropic';
    let seq = 0;
    for (const entry of entries) {
      const ev = extractConversationFromEntry(entry, convSpec, seq, tokenNormalization);
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
