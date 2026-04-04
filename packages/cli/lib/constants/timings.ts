// Centralized timing constants for the CLI package.
// All timing-related magic numbers live here so they're discoverable
// in one place and easily adjustable.

// ── Polling intervals ────────────────────────────────
export const POLL_FAST_MS = 5_000;
export const POLL_MEDIUM_MS = 15_000;
export const POLL_SLOW_MS = 30_000;
export const POLL_IDLE_MS = 60_000;
export const BACKOFF_MAX_MS = 60_000;

// ── Idle tier thresholds (unchanged poll counts) ─────
export const IDLE_TIER_1 = 6; // 30s idle -> medium poll
export const IDLE_TIER_2 = 12; // 1min idle -> slow poll
export const IDLE_TIER_3 = 60; // 5min idle -> idle poll

// ── Connection ───────────────────────────────────────
export const OFFLINE_THRESHOLD = 6; // consecutive failures before going offline
export const RECONCILE_INTERVAL_MS = 60_000;
export const WS_CONNECT_TIMEOUT_MS = 10_000;

// ── Agent lifecycle ──────────────────────────────────
export const DURATION_TICK_MS = 10_000;
export const EXTERNAL_AGENT_POLL_MS = 3_000;
export const EARLY_EXIT_THRESHOLD_MS = 15_000;

// ── WebSocket (chat) ─────────────────────────────────
export const RECONNECT_BASE_MS = 1_000;
export const MAX_RECONNECT_DELAY_MS = 15_000;
export const ERROR_DISPLAY_MS = 3_000;

// ── Process management ───────────────────────────────
export const KILL_GRACE_MS = 5_000;
export const MAX_OUTPUT_LINES = 200;
export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 30;

// ── UI flash / display ──────────────────────────────
export const FLASH_MIN_DURATION_MS = 3_000;
export const FLASH_MS_PER_CHAR = 40;

// ── External commands ────────────────────────────────
export const EXEC_TIMEOUT_MS = 10_000;
export const LOADING_TIMEOUT_MS = 15_000;
