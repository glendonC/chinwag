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

export type FileDiscovery = ProjectHashDiscovery | GlobDiscovery | FixedPathDiscovery;

// ── Token extraction ──────────────────────────────

export type TokenNormalization = 'anthropic' | 'openai';

export interface TokenExtractionSpec {
  /** Dot-notation path to the usage object within a log entry. */
  usagePath: string;
  /** Fallback paths tried in order if usagePath resolves to null. */
  usagePathFallbacks?: string[];
  /** Maps chinwag canonical field names to tool-specific field names. */
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

// ── Top-level spec ────────────────────────────────

export interface ParserSpec {
  version: 1;
  tool: string;
  format: 'jsonl' | 'json' | 'markdown';
  discovery: FileDiscovery;
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
}
