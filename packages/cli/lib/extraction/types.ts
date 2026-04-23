/**
 * Declarative parser spec types.
 *
 * A ParserSpec describes WHAT to extract from a tool's log files.
 * The generic extraction engine handles HOW. Adding a new tool means
 * writing a JSON spec file, not TypeScript parser code.
 */

// ── File discovery ────────────────────────────────

export interface ProjectHashDiscovery {
  strategy: 'project-hash';
  /** Base directory containing per-project subdirectories, e.g. ~/.claude/projects/ */
  baseDir: string;
  /** File extension filter, e.g. '.jsonl' */
  ext: string;
}

export interface GlobDiscovery {
  strategy: 'glob';
  /** Glob pattern with {YYYY}, {MM}, {DD} date placeholders, e.g. ~/.codex/sessions/{YYYY}/{MM}/{DD}/rollout-*.jsonl */
  pattern: string;
}

export interface FixedPathDiscovery {
  strategy: 'fixed-path';
  /** Relative to CWD, e.g. .aider.chat.history.md */
  relativePath: string;
}

export interface PerOsPathDiscovery {
  strategy: 'per-os-path';
  /** Absolute path per platform; `~` expanded to homedir at discovery time. */
  paths: {
    darwin: string;
    linux: string;
    win32: string;
  };
}

/**
 * Tools that shard sessions into `{baseDir}/{sessionId}/{filename}` (e.g.
 * Copilot's `~/.copilot/session-state/<id>/events.jsonl`). The discoverer
 * walks every subdir of `baseDir`, checks whether `filename` exists inside,
 * and returns the newest such file that has been touched since `startedAt`.
 *
 * Projection by cwd is intentionally NOT done here — Copilot's session-ids
 * are opaque UUIDs with no project-linking naming convention, so the
 * mtime-after-startedAt gate is what identifies the active session.
 */
export interface PerSessionSubdirDiscovery {
  strategy: 'per-session-subdir';
  /** e.g. `~/.copilot/session-state/` */
  baseDir: string;
  /** e.g. `events.jsonl` */
  filename: string;
}

export type FileDiscovery =
  | ProjectHashDiscovery
  | GlobDiscovery
  | FixedPathDiscovery
  | PerOsPathDiscovery
  | PerSessionSubdirDiscovery;

// ── Token extraction ──────────────────────────────

export type TokenNormalization = 'anthropic' | 'openai';

export interface TokenExtractionSpec {
  /** Dot-notation path to the usage object within a log entry. */
  usagePath: string;
  /** Fallback paths tried in order if usagePath resolves to null. */
  usagePathFallbacks?: string[];
  /** Maps chinmeister canonical field names to tool-specific field names. */
  fieldMapping: {
    input_tokens: string;
    output_tokens: string;
    cache_read_tokens?: string;
    cache_creation_tokens?: string;
  };
  /** Determines how token fields compose. */
  normalization: TokenNormalization;
}

// ── Conversation extraction ───────────────────────

export interface ConversationExtractionSpec {
  /** For JSONL/JSON: how to identify user vs assistant entries. */
  roleDetection: {
    /** Dot-notation path to the role/type field. */
    field: string;
    /** Additional fields to check if the primary field doesn't match (OR logic). */
    fieldFallbacks?: string[];
    /** Values that map to 'user'. */
    userValues: string[];
    /** Values that map to 'assistant'. */
    assistantValues: string[];
  };
  /** Dot-notation path(s) to message content (first non-null wins). */
  contentPaths: string[];
  /** Dot-notation path to timestamp (optional). */
  timestampPath?: string;
  /** Dot-notation paths to per-message token fields (optional, assistant entries only). */
  tokenPaths?: {
    input_tokens: string;
    output_tokens: string;
    cache_read_tokens?: string;
    cache_creation_tokens?: string;
  };
  /** Dot-notation path to model name (optional, assistant entries only). */
  modelPath?: string;
  /** Dot-notation path to stop reason (optional, assistant entries only). */
  stopReasonPath?: string;
}

// ── Tool call extraction ──────────────────────────

export interface ToolCallExtractionSpec {
  /** How tool_use and tool_result blocks are structured. */
  requestBlock: {
    /** Dot-notation path to the content blocks array. */
    contentPath: string;
    /** Fallback paths for content blocks. */
    contentPathFallbacks?: string[];
    /** Value of `type` field that identifies a tool_use block. */
    typeValue: string;
    /** Dot-notation path to tool name within the block. */
    namePath: string;
    /** Dot-notation path to tool use ID for request/result pairing. */
    idPath: string;
    /** Dot-notation paths to extract as input preview (first non-null wins). */
    inputPreviewPaths: string[];
  };
  resultBlock: {
    /** Value of `type` field that identifies a tool_result block. */
    typeValue: string;
    /** Dot-notation path to the tool_use_id for pairing. */
    idPath: string;
    /** Dot-notation path to the is_error flag. */
    errorPath: string;
    /** Dot-notation path to error content for preview. */
    errorContentPath: string;
  };
}

// ── Markdown extraction (Aider-style) ─────────────

export interface MarkdownExtractionSpec {
  /** Regex or prefix that starts a user message block. */
  userMarker: string;
  /** Regex or prefix that starts an assistant message block. */
  assistantMarker: string;
}

// ── SQLite source ─────────────────────────────────
//
// SQLite is a *source*, not a separate extraction paradigm. The engine opens
// the DB, runs the query, and each row becomes an entry object (column name →
// value). From there, the existing conversation / tokens / toolCalls specs
// extract fields via dot-notation paths against those entries, identical to
// JSONL flow. If a tool's log lives in a table with nested JSON, lift the
// nested fields into flat result columns via `json_extract()` in the SQL.

export interface SqliteSource {
  /**
   * Expected table name. The engine does not use it for extraction — the
   * `query` is the source of truth — but it is kept as a documented field so
   * the validator (and future healer) can detect when a tool renames or drops
   * the table before wasting a query round-trip.
   */
  table: string;
  /**
   * Full SELECT statement. Must be a single statement (no `;` terminators, no
   * DDL, no DML). May use `json_extract()` and other scalar functions. Each
   * result row becomes an entry; column names become keys on that entry.
   *
   * Specs are shipped with chinmeister and validated before execution, so raw SQL
   * is acceptable here. Do NOT interpolate user input into the query; if
   * parameterisation is ever needed, extend this shape with a typed params
   * array rather than string concatenation.
   */
  query: string;
}

// ── Conversation pre-pass hints ───────────────────

/**
 * Narrow, Option-A hint for tools whose per-message `model` field lives on a
 * different prior line (e.g. Copilot emits `session.model_change` events
 * once, and every subsequent `user.message`/`assistant.message` inherits
 * that model implicitly). The engine runs a pre-pass that walks entries in
 * order, tracks the carried value, and attaches it to subsequent entries at
 * `carryTargetPath` before normal extraction runs.
 *
 * If a second tool ships a similar stateful pattern (e.g. Cline or Amp
 * carrying a session-wide field) this narrow hint should be generalised to
 * a multi-field carry map rather than copy-pasted.
 */
export interface ModelStateCarry {
  /** Value on the source entry's role/type field that marks a carry event. */
  carryFromEvent: string;
  /** Dot-notation path on the source entry for the value to carry. */
  carryFromPath: string;
  /**
   * Dot-notation path at which to *inject* the carried value on subsequent
   * entries before extraction runs. Defaults to `model` — matching the flat
   * conversation entry shape used by simpler tools like Copilot.
   */
  carryTargetPath?: string;
}

// ── Top-level spec ────────────────────────────────

export interface ParserSpec {
  version: 1;
  tool: string;
  format: 'jsonl' | 'json' | 'markdown' | 'sqlite';
  discovery: FileDiscovery;
  /**
   * Required when `format === 'sqlite'`. Describes how to obtain entries from
   * the DB file located by `discovery`.
   */
  sqlite?: SqliteSource;
  /**
   * Optional pre-pass hint that rewrites entries before extraction. Currently
   * supports one carry (see `ModelStateCarry`). Applies only to JSONL-shaped
   * sources (JSONL and SQLite); ignored for markdown.
   */
  prepass?: {
    modelState?: ModelStateCarry;
  };
  extractions: {
    conversation?: ConversationExtractionSpec | MarkdownExtractionSpec;
    tokens?: TokenExtractionSpec;
    toolCalls?: ToolCallExtractionSpec;
  };
  generatedAt: string;
  source: 'manual' | 'ai-generated' | 'ai-healed';
}

// ── Extraction outputs ────────────────────────────

export interface ExtractedConversation {
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

export interface NormalizedTokens {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

export interface ExtractedToolCall {
  tool: string;
  at: number;
  is_error: boolean;
  error_preview?: string | undefined;
  input_preview?: string | undefined;
  duration_ms?: number | undefined;
}

export interface ExtractionResult {
  conversations: ExtractedConversation[];
  tokens: NormalizedTokens | null;
  toolCalls: ExtractedToolCall[];
  /**
   * Parse-level health for JSONL inputs. Present only when the spec's format is
   * 'jsonl' and the discovered file was non-empty. Lets the collector record
   * malformed-line rate alongside semantic success so a tool shipping a format
   * change surfaces as a parse-health regression, not a silent zero-output.
   */
  parseHealth?: {
    totalLines: number;
    parsedLines: number;
    malformedLines: number;
  };
}
