// Shared constants for the chinmeister platform.
// Single source of truth for values used by multiple packages (MCP, Worker, Web, CLI).
// Package-specific constants (rate limits, heartbeat windows, UI timings) stay local.

// --- String length limits ---
/** Max length for activity summary */
export const MAX_SUMMARY_LENGTH = 280;
/** Max length for memory text */
export const MAX_MEMORY_TEXT_LENGTH = 2000;
/** Max length for a single file path */
export const MAX_FILE_PATH_LENGTH = 500;
/** Max length for user handle */
export const MAX_HANDLE_LENGTH = 20;
/** Max length for a single memory tag */
export const MAX_TAG_LENGTH = 50;
/** Max number of tags per memory */
export const MAX_TAGS_PER_MEMORY = 10;
/** Max length for chat/direct message text */
export const MAX_MESSAGE_LENGTH = 500;
/** Max length for model identifier */
export const MAX_MODEL_LENGTH = 50;

// --- Capacity limits ---
/** Max number of files in activity/conflict checks */
export const FILE_LIST_MAX = 100;
/** Max number of files in lock claim/release */
export const LOCK_CLAIM_MAX_FILES = 20;
/** Max results for memory search */
export const MEMORY_SEARCH_MAX_LIMIT = 50;
/** Default results for memory search */
export const MEMORY_SEARCH_DEFAULT_LIMIT = 20;

// --- Shared timing ---
/** Reconciliation polling interval */
export const RECONCILE_INTERVAL_MS = 60_000;
/** Grace period before force-killing a process */
export const KILL_GRACE_MS = 5_000;
/** Timeout for external command execution (e.g. ps, which) */
export const EXEC_TIMEOUT_MS = 10_000;
