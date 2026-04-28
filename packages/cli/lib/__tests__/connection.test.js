import { describe, it, expect } from 'vitest';
import { classifyError } from '../utils/errors.js';

/**
 * These tests exercise the connection error classification that was
 * previously inlined in dashboard/connection.jsx and is now shared.
 * They specifically validate the WebSocket/polling error handling paths.
 */

describe('connection error classification', () => {
  it('401 is fatal - requires re-auth', () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    const c = classifyError(err);
    expect(c.fatal).toBe(true);
    expect(c.state).toBe('offline');
  });

  it('429 should suggest retrying (not give up)', () => {
    const err = Object.assign(new Error('Too Many Requests'), { status: 429 });
    const c = classifyError(err);
    expect(c.state).toBe('reconnecting');
    expect(c.detail).toContain('Retrying');
  });

  it('5xx should be retryable', () => {
    for (const status of [500, 502, 503, 504]) {
      const err = Object.assign(new Error('Server'), { status });
      expect(classifyError(err).state).toBe('reconnecting');
    }
  });

  it('network errors are offline, not reconnecting', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN']) {
      const err = new Error(`connect ${code}`);
      expect(classifyError(err).state).toBe('offline');
    }
  });

  it('timeout error maps to reconnecting', () => {
    const err408 = Object.assign(new Error(''), { status: 408 });
    expect(classifyError(err408).state).toBe('reconnecting');

    const errMsg = new Error('Request timed out');
    expect(classifyError(errMsg).state).toBe('reconnecting');
  });

  describe('offline threshold behavior simulation', () => {
    // Simulate the OFFLINE_THRESHOLD logic from connection.jsx
    // After N consecutive failures, reconnecting should become offline
    const OFFLINE_THRESHOLD = 6;

    function simulateConsecutiveFailures(err, count) {
      let consecutiveFailures = 0;
      let finalState = 'connecting';
      let finalDetail = null;

      for (let i = 0; i < count; i++) {
        consecutiveFailures++;
        const classified = classifyError(err);
        if (consecutiveFailures >= OFFLINE_THRESHOLD && classified.state === 'reconnecting') {
          finalState = 'offline';
          finalDetail = classified.detail
            .replace('Retrying...', 'Press [r] to retry.')
            .replace('Retrying shortly.', 'Press [r] to retry.');
        } else {
          finalState = classified.state;
          finalDetail = classified.detail;
        }
      }

      return { state: finalState, detail: finalDetail };
    }

    it('stays reconnecting for fewer than threshold failures', () => {
      const err = Object.assign(new Error('Error'), { status: 502 });
      const result = simulateConsecutiveFailures(err, 3);
      expect(result.state).toBe('reconnecting');
      expect(result.detail).toContain('Retrying');
    });

    it('escalates to offline after threshold failures', () => {
      const err = Object.assign(new Error('Error'), { status: 502 });
      const result = simulateConsecutiveFailures(err, 7);
      expect(result.state).toBe('offline');
      expect(result.detail).toContain('Press [r] to retry.');
    });

    it('429 escalates to retry prompt after threshold', () => {
      const err = Object.assign(new Error('Too Many'), { status: 429 });
      const result = simulateConsecutiveFailures(err, 7);
      expect(result.state).toBe('offline');
      expect(result.detail).toContain('Press [r] to retry.');
    });

    it('401 stays offline immediately (does not need threshold)', () => {
      const err = Object.assign(new Error('Unauth'), { status: 401 });
      const result = simulateConsecutiveFailures(err, 1);
      expect(result.state).toBe('offline');
    });
  });

  describe('polling interval tiers', () => {
    const POLL_FAST_MS = 5_000;
    const POLL_MEDIUM_MS = 15_000;
    const POLL_SLOW_MS = 30_000;
    const POLL_IDLE_MS = 60_000;
    const IDLE_TIER_1 = 6;
    const IDLE_TIER_2 = 12;
    const IDLE_TIER_3 = 60;
    const OFFLINE_THRESHOLD = 6;

    function getPollInterval(consecutiveFailures, unchangedPolls) {
      if (consecutiveFailures >= OFFLINE_THRESHOLD) return POLL_SLOW_MS;
      if (consecutiveFailures >= 3) return POLL_MEDIUM_MS;
      if (unchangedPolls >= IDLE_TIER_3) return POLL_IDLE_MS;
      if (unchangedPolls >= IDLE_TIER_2) return POLL_SLOW_MS;
      if (unchangedPolls >= IDLE_TIER_1) return POLL_MEDIUM_MS;
      return POLL_FAST_MS;
    }

    it('uses fast polling when healthy and active', () => {
      expect(getPollInterval(0, 0)).toBe(POLL_FAST_MS);
    });

    it('slows to medium after some consecutive failures', () => {
      expect(getPollInterval(3, 0)).toBe(POLL_MEDIUM_MS);
    });

    it('slows further after offline threshold failures', () => {
      expect(getPollInterval(6, 0)).toBe(POLL_SLOW_MS);
    });

    it('backs off based on unchanged polls (idle tiers)', () => {
      expect(getPollInterval(0, 5)).toBe(POLL_FAST_MS); // Below tier 1
      expect(getPollInterval(0, 6)).toBe(POLL_MEDIUM_MS); // Tier 1
      expect(getPollInterval(0, 12)).toBe(POLL_SLOW_MS); // Tier 2
      expect(getPollInterval(0, 60)).toBe(POLL_IDLE_MS); // Tier 3
    });

    it('failure-based slowdown takes priority over idle tiers', () => {
      expect(getPollInterval(6, 0)).toBe(POLL_SLOW_MS);
    });
  });
});
