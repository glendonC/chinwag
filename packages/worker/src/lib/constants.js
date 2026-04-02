// Shared constants for the chinwag worker.
// All magic numbers live here — import by name, never hardcode.
//
// DO return pattern:
//   Success: { ok: true, ...data }
//   Failure: { error: 'message' }
// Route handlers check `.error` and map to the appropriate HTTP status.
// DOs never throw for expected failures — throws are for bugs only.

// --- Heartbeat windows ---
// "Active" = recent heartbeat or live WebSocket. Used for conflict detection,
// lock visibility, and getContext member status.
export const HEARTBEAT_ACTIVE_WINDOW_S = 60;
// "Stale" = no heartbeat for this long → evicted from team, locks released,
// sessions auto-closed. Used in cleanup and orphan detection.
export const HEARTBEAT_STALE_WINDOW_S = 300;

// --- Retention ---
export const SESSION_RETENTION_DAYS = 30;
export const CONTEXT_CACHE_TTL_MS = 2000;
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

// --- Rate limits (per user per day) ---
export const RATE_LIMIT_JOINS = 100;
export const RATE_LIMIT_MEMORIES = 20;
export const RATE_LIMIT_MEMORY_UPDATES = 50;
export const RATE_LIMIT_MEMORY_DELETES = 50;
export const RATE_LIMIT_MESSAGES = 200;
export const RATE_LIMIT_LOCKS = 100;
export const RATE_LIMIT_FILE_REPORTS = 500;
export const RATE_LIMIT_SESSIONS = 50;
export const RATE_LIMIT_EDITS = 1000;
export const RATE_LIMIT_TEAMS = 5;
export const RATE_LIMIT_ACCOUNTS_PER_IP = 3;
export const RATE_LIMIT_EVALUATIONS = 5;
export const RATE_LIMIT_WS_TICKETS = 100;

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

// --- Web sessions ---
export const WEB_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// --- Misc ---
export const CHAT_COOLDOWN_MS = 5 * 60 * 1000;
export const MAX_BODY_SIZE = 50_000;
export const CLEANUP_INTERVAL_MS = 60_000;
export const HEARTBEAT_BROADCAST_DEBOUNCE_MS = 3000;
export const MAX_DASHBOARD_TEAMS = 25;
export const MEMORY_SEARCH_DEFAULT_LIMIT = 20;
export const MEMORY_SEARCH_MAX_LIMIT = 50;
export const HISTORY_DEFAULT_DAYS = 7;
export const HISTORY_MAX_DAYS = 30;
