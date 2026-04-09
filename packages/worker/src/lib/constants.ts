// Shared constants for the chinwag worker.
// All magic numbers live here — import by name, never hardcode.
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
// DOs never throw for expected failures — throws are for bugs only.

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

// --- Capacity caps ---
export const ACTIVITY_MAX_FILES = 50;
export const MEMORY_MAX_COUNT = 500;
export const LOCK_CLAIM_MAX_FILES = 20;

// --- String length limits ---
export const MAX_SUMMARY_LENGTH = 280;
export const MAX_STATUS_LENGTH = 280;
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_MEMORY_TEXT_LENGTH = 2000;
export const MAX_FILE_PATH_LENGTH = 500;
export const MAX_HANDLE_LENGTH = 20;
export const MAX_MODEL_LENGTH = 50;
export const MAX_FRAMEWORK_LENGTH = 50;
export const MAX_TAG_LENGTH = 50;
export const MAX_TAGS_PER_MEMORY = 10;
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
export const RATE_LIMIT_TEAMS = 5;
export const RATE_LIMIT_ACCOUNTS_PER_IP = 3;
export const RATE_LIMIT_EVALUATIONS = 5;
export const RATE_LIMIT_SUGGESTIONS = 5;
export const RATE_LIMIT_WS_TICKETS = 100;

// --- Rate limits (per IP per 24h window, public/unauthenticated endpoints) ---
export const RATE_LIMIT_STATS_PER_IP = 200;
export const RATE_LIMIT_CATALOG_PER_IP = 200;
export const RATE_LIMIT_ADMIN_BATCH_PER_IP = 20;

// --- Chat room tuning ---
export const CHAT_MIN_ROOM_SIZE = 5;
export const CHAT_MAX_ROOM_SIZE = 30;
export const CHAT_TARGET_ROOM_SIZE = 20;
export const CHAT_MAX_HISTORY = 50;
export const CHAT_MAX_MESSAGE_LENGTH = 280;
export const CHAT_MAX_PER_MINUTE = 10;
export const CHAT_RATE_LIMIT_WINDOW_MS = 60_000;
export const CHAT_RATE_LIMIT_PRUNE_AFTER_MS = 120_000;

// --- Presence ---
export const PRESENCE_TTL_MS = 60_000;

// --- Token lifecycle ---
// Access tokens (CLI/MCP) expire after 90 days of inactivity. Every successful
// authentication re-PUTs the KV entry with a fresh TTL (sliding window), so
// active users never hit expiration. 90 days matches Vercel's token lifetime
// and suits a dev tool where MCP servers reconnect daily — re-auth ~4x/year
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
// 12-color palette for user identity. Single source of truth — import these
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
  TOOL_PREFIX: 'tool:',
  MESSAGES_SENT: 'messages_sent',
  MEMORIES_SAVED: 'memories_saved',
  CONFLICT_CHECKS: 'conflict_checks',
  CONFLICTS_FOUND: 'conflicts_found',
  COMMANDS_SUBMITTED: 'commands_submitted',
} as const;

// --- Misc ---
export const CHAT_COOLDOWN_MS = 5 * 60 * 1000;
export const MAX_BODY_SIZE = 50_000;
export const MAX_WS_MESSAGE_SIZE = 50_000;
export const CLEANUP_INTERVAL_MS = 60_000;
export const HEARTBEAT_BROADCAST_DEBOUNCE_MS = 3000;
export const MAX_DASHBOARD_TEAMS = 25;
export const MEMORY_SEARCH_DEFAULT_LIMIT = 20;
export const MEMORY_SEARCH_MAX_LIMIT = 50;
export const MEMORY_SEARCH_MAX_TAGS = 10;
export const MEMORY_SEARCH_MAX_QUERY_LENGTH = 200;
export const HISTORY_DEFAULT_DAYS = 7;
export const HISTORY_MAX_DAYS = 30;
