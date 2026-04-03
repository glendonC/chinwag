/** Polling & WebSocket timing constants (milliseconds). */

/** Default interval between HTTP poll cycles. */
export const POLL_MS = 5_000;

/** Slow-mode poll interval after repeated failures. */
export const SLOW_POLL_MS = 30_000;

/** Initial delay before the first WebSocket reconciliation poll. */
export const RECONCILE_INITIAL_MS = 30_000;

/** Maximum reconciliation poll interval (5 minutes). */
export const RECONCILE_MAX_MS = 300_000;
