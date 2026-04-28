// Centralized timing constants for the CLI package.
// All timing-related magic numbers live here so they're discoverable
// in one place and easily adjustable.

import {
  RECONCILE_INTERVAL_MS as _RECONCILE_INTERVAL_MS,
  KILL_GRACE_MS as _KILL_GRACE_MS,
  EXEC_TIMEOUT_MS as _EXEC_TIMEOUT_MS,
} from '@chinmeister/shared/constants.js';

// ── Shared constants (re-exported from @chinmeister/shared) ──
export const RECONCILE_INTERVAL_MS = _RECONCILE_INTERVAL_MS;
export const KILL_GRACE_MS = _KILL_GRACE_MS;
export const EXEC_TIMEOUT_MS = _EXEC_TIMEOUT_MS;

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
export const WS_CONNECT_TIMEOUT_MS = 10_000;

// ── Agent lifecycle ──────────────────────────────────
export const DURATION_TICK_MS = 10_000;
export const EXTERNAL_AGENT_POLL_MS = 3_000;
export const EARLY_EXIT_THRESHOLD_MS = 15_000;

// ── UI display ───────────────────────────────────────
export const ERROR_DISPLAY_MS = 3_000;

// ── Process management ───────────────────────────────
export const MAX_OUTPUT_LINES = 200;
export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 30;

// ── UI flash / display ──────────────────────────────
export const FLASH_MIN_DURATION_MS = 3_000;
export const FLASH_MS_PER_CHAR = 40;

// ── External commands ────────────────────────────────
export const LOADING_TIMEOUT_MS = 15_000;
