// Shared constants for the chinmeister worker.
// All magic numbers live here - import by name, never hardcode.
//
// DO return pattern:
//   Success: { ok: true, ...data }
//   Failure: { error: 'Human-readable message', code: 'ERROR_CODE' }
//
// Error codes -> HTTP status (via teamErrorStatus() in request-utils.ts):
//   NOT_MEMBER, NOT_OWNER, FORBIDDEN -> 403
//   NOT_FOUND                        -> 404
//   CONFLICT                         -> 409
//   VALIDATION                       -> 400
//   INTERNAL                         -> 500
//   (unknown)                        -> 400
//
// Route handlers check `.error` and call `teamErrorStatus(result)` to map.
// DOs never throw for expected failures - throws are for bugs only.

// --- Heartbeat windows ---
// "Active" = recent heartbeat or live WebSocket. Used for conflict detection,
// lock visibility, and getContext member status.
export const HEARTBEAT_ACTIVE_WINDOW_S = 60;
// "Stale" = no heartbeat for this long -> evicted from team, locks released,
// sessions auto-closed. Used in cleanup and orphan detection.
// 15 minutes: long enough that debugging pauses or slow user input don't
// evict agents, short enough that genuinely dead agents get cleaned up.
export const HEARTBEAT_STALE_WINDOW_S = 900;

// --- Retention ---
export const SESSION_RETENTION_DAYS = 30;
export const DAILY_METRICS_RETENTION_DAYS = 90;
export const CONTEXT_CACHE_TTL_MS = 5000;
export const CONTEXT_MEMBERS_LIMIT = 100;
export const CONTEXT_LOCKS_LIMIT = 100;
export const MESSAGE_EXPIRY_HOURS = 1;

// --- Shared constants (re-exported from @chinmeister/shared) ---
export {
  MAX_SUMMARY_LENGTH,
  MAX_MEMORY_TEXT_LENGTH,
  MAX_FILE_PATH_LENGTH,
  MAX_HANDLE_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_MEMORY,
  MAX_MESSAGE_LENGTH,
  MAX_MODEL_LENGTH,
  LOCK_CLAIM_MAX_FILES,
  MEMORY_SEARCH_MAX_LIMIT,
  MEMORY_SEARCH_DEFAULT_LIMIT,
} from '@chinmeister/shared/constants.js';

// --- Capacity caps ---
export const ACTIVITY_MAX_FILES = 50;
export const MEMORY_MAX_COUNT = 2000;
export const MEMORY_CATEGORY_MAX_COUNT = 20;
export const MAX_CATEGORY_NAME_LENGTH = 50;
export const MAX_CATEGORY_DESCRIPTION_LENGTH = 500;
export const TAG_PROMOTION_THRESHOLD = 10;
export const LAST_ACCESSED_THROTTLE_MS = 3600_000; // 1 hour - writes cost 20x reads

// Memory decay halflife (days). Tag-aware: long for project-defining knowledge,
// short for ephemeral notes, medium for everything else. Tunable via tag
// conventions the agent already uses; no manual curation required.
// Reference: Park et al. Generative Agents (~5.75 game-day halflife), Bedrock
// AgentCore (5-11 days). Mem0 v3 ships no decay; we hedge with a moderate
// default plus tag-aware overrides so foundational decisions don't decay out.
export const MEMORY_DECAY_HALFLIFE_DAYS = 14;
export const MEMORY_DECAY_HALFLIFE_LONG_DAYS = 365;
export const MEMORY_DECAY_HALFLIFE_SHORT_DAYS = 7;
export const MEMORY_DECAY_TAGS_LONG = ['decision', 'adr', 'architecture', 'design'];
export const MEMORY_DECAY_TAGS_SHORT = ['scratch', 'debug', 'wip', 'temp', 'todo'];
// Fetch this many candidates from SQL before JS-side decay rerank trims to
// requested limit. 3x gives the rescorer headroom without burdening the row
// reader; recall benefit plateaus by ~3x in spot tests.
export const MEMORY_DECAY_CANDIDATE_MULTIPLIER = 3;

// Hybrid retrieval (vector + FTS) settings.
// RRF k=60 is the industry default (Qdrant, OpenSearch, Graphiti). Lower
// values sharpen top-rank differentiation at the cost of being more sensitive
// to single-source noise. Re-evaluate once we have query-trace data to tune.
export const MEMORY_HYBRID_RRF_K = 60;
// Pull this many vector candidates per query for the RRF merge. Bigger pool
// improves recall on paraphrased queries; bge-small cosine over 2000 rows is
// fast enough that 30 is fine.
export const MEMORY_HYBRID_VECTOR_TOP_N = 30;
// MMR diversification lambda. λ=0.5 (Graphiti default) balances relevance
// and diversity. λ→1 is pure relevance; λ→0 is pure diversity.
export const MEMORY_MMR_LAMBDA = 0.5;

// --- String length limits (worker-specific) ---
export const MAX_STATUS_LENGTH = 280;
export const MAX_FRAMEWORK_LENGTH = 50;
export const MAX_NAME_LENGTH = 100;
export const MAX_COMMAND_PAYLOAD_LENGTH = 2000;

// --- Rate limits (per user per day) ---
export const RATE_LIMIT_JOINS = 100;
export const RATE_LIMIT_MEMORIES = 20;
export const RATE_LIMIT_MEMORY_UPDATES = 50;
export const RATE_LIMIT_MEMORY_DELETES = 50;
export const RATE_LIMIT_MESSAGES = 200;
export const RATE_LIMIT_LOCKS = 100;
export const RATE_LIMIT_FILE_REPORTS = 500;
export const RATE_LIMIT_SESSIONS = 50;
export const RATE_LIMIT_COMMANDS = 50;
export const RATE_LIMIT_EDITS = 1000;
export const RATE_LIMIT_CATEGORIES = 50;
export const RATE_LIMIT_TEAMS = 5;
export const RATE_LIMIT_ACCOUNTS_PER_IP = 3;
export const RATE_LIMIT_EVALUATIONS = 5;
export const RATE_LIMIT_SUGGESTIONS = 5;
export const RATE_LIMIT_WS_TICKETS = 100;

// --- Rate limits (per IP per 24h window, public/unauthenticated endpoints) ---
export const RATE_LIMIT_STATS_PER_IP = 2000;
export const RATE_LIMIT_CATALOG_PER_IP = 200;
export const RATE_LIMIT_ADMIN_BATCH_PER_IP = 20;

// --- Presence ---
export const PRESENCE_TTL_MS = 60_000;

// --- Token lifecycle ---
// Access tokens (CLI/MCP) expire after 90 days of inactivity. Every successful
// authentication re-PUTs the KV entry with a fresh TTL (sliding window), so
// active users never hit expiration. 90 days matches Vercel's token lifetime
// and suits a dev tool where MCP servers reconnect daily - re-auth ~4x/year
// for completely inactive tokens.
export const ACCESS_TOKEN_TTL_S = 90 * 24 * 60 * 60; // 90 days in seconds

// Web session tokens get a shorter 30-day sliding window. The dashboard is
// a secondary surface; re-login via GitHub OAuth is frictionless.
export const WEB_SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days in seconds
export const WEB_SESSION_DURATION_MS = WEB_SESSION_TTL_S * 1000;

// Refresh tokens allow clients to obtain a new access token without
// re-authenticating from scratch. Longer-lived than access tokens so they
// survive token expiry windows. Stored in KV with their own prefix.
export const REFRESH_TOKEN_TTL_S = 180 * 24 * 60 * 60; // 180 days in seconds

// Rate limit for token refresh requests (per user per day).
export const RATE_LIMIT_TOKEN_REFRESH = 50;

// --- Color palette ---
// 12-color palette for user identity. Single source of truth - import these
// instead of defining local copies.
export const VALID_COLORS = [
  'red',
  'cyan',
  'yellow',
  'green',
  'magenta',
  'blue',
  'orange',
  'lime',
  'pink',
  'sky',
  'lavender',
  'white',
] as const;
export const VALID_COLORS_SET = new Set<string>(VALID_COLORS);

// --- Telemetry metric keys ---
// Single source of truth for metric names used in telemetry recording and
// breakdown queries. Prefixed keys are concatenated with a dynamic value
// (e.g., METRIC_KEYS.HOST_PREFIX + 'cursor').
export const METRIC_KEYS = {
  JOINS: 'joins',
  HOST_PREFIX: 'host:',
  SURFACE_PREFIX: 'surface:',
  TRANSPORT_PREFIX: 'transport:',
  MODEL_PREFIX: 'model:',
  MESSAGES_SENT: 'messages_sent',
  MEMORIES_SAVED: 'memories_saved',
  MEMORIES_SEARCHED: 'memories_searched',
  MEMORIES_SEARCH_HITS: 'memories_search_hits',
  // Increments whenever the secret detector refuses a memory write
  // (force: true bypass not counted - those reach the store as documented
  // patterns, not blocked credentials).
  SECRETS_BLOCKED: 'secrets_blocked',
  CONFLICT_CHECKS: 'conflict_checks',
  CONFLICTS_FOUND: 'conflicts_found',
  // Hook-sourced conflict detection that prevented an edit (PreToolUse block).
  // Only recorded when the caller passes source='hook'; MCP-tool advisory
  // checks are not counted here.
  CONFLICTS_BLOCKED: 'conflicts_blocked',
  COMMANDS_SUBMITTED: 'commands_submitted',
} as const;

// --- Misc ---
export const MAX_BODY_SIZE = 50_000;
export const MAX_WS_MESSAGE_SIZE = 50_000;
export const CLEANUP_INTERVAL_MS = 60_000;
export const HEARTBEAT_BROADCAST_DEBOUNCE_MS = 3000;
export const MAX_DASHBOARD_TEAMS = 25;
export const MEMORY_SEARCH_MAX_TAGS = 10;
export const MEMORY_SEARCH_MAX_QUERY_LENGTH = 200;
export const HISTORY_DEFAULT_DAYS = 7;
export const HISTORY_MAX_DAYS = 30;
