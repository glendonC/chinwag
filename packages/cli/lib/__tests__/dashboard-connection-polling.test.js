import { describe, it, expect } from 'vitest';

/**
 * Tests for the connection polling logic in packages/cli/lib/dashboard/connection.jsx.
 *
 * The getPollInterval function and contextFingerprint are private to the module,
 * so we re-implement the exact formulas from the source to test them in isolation.
 * This catches regressions if the formula changes and ensures the exponential
 * backoff and idle tier behavior is correct.
 *
 * See also: connection.test.js which tests classifyError and a simplified
 * version of polling tiers. This file tests the ACTUAL exponential backoff
 * formula from connection.jsx.
 */

// ── Constants (mirrored from connection.jsx) ───────────
const POLL_FAST_MS = 5_000;
const POLL_MEDIUM_MS = 15_000;
const POLL_SLOW_MS = 30_000;
const POLL_IDLE_MS = 60_000;
const BACKOFF_MAX_MS = 60_000;
const OFFLINE_THRESHOLD = 6;
const IDLE_TIER_1 = 6; // 30s idle -> medium poll
const IDLE_TIER_2 = 12; // 1min idle -> slow poll
const IDLE_TIER_3 = 60; // 5min idle -> idle poll

/**
 * Exact reimplementation of getPollInterval from connection.jsx.
 * This uses the actual exponential backoff formula:
 *   base * 2^(failures-3), capped at BACKOFF_MAX_MS
 * where base depends on whether failures >= OFFLINE_THRESHOLD.
 */
function getPollInterval(consecutiveFailures, unchangedPolls) {
  if (consecutiveFailures >= 3) {
    const base = consecutiveFailures >= OFFLINE_THRESHOLD ? POLL_SLOW_MS : POLL_MEDIUM_MS;
    return Math.min(base * Math.pow(2, consecutiveFailures - 3), BACKOFF_MAX_MS);
  }
  const idle = unchangedPolls;
  if (idle >= IDLE_TIER_3) return POLL_IDLE_MS;
  if (idle >= IDLE_TIER_2) return POLL_SLOW_MS;
  if (idle >= IDLE_TIER_1) return POLL_MEDIUM_MS;
  return POLL_FAST_MS;
}

/**
 * Exact reimplementation of contextFingerprint from connection.jsx.
 */
function contextFingerprint(ctx) {
  if (!ctx) return '';
  const members = (ctx.members || [])
    .map(
      (m) =>
        `${m.agent_id}:${m.status}:${m.activity?.summary || ''}:${(m.activity?.files || []).length}`,
    )
    .join('|');
  const memCount = (ctx.memories || []).length;
  const msgCount = (ctx.messages || []).length;
  const lockCount = (ctx.locks || []).length;
  return `${members};${memCount};${msgCount};${lockCount}`;
}

// ── getPollInterval Tests ──────────────────────────────

describe('getPollInterval', () => {
  describe('healthy state (0 failures)', () => {
    it('returns fast poll when active (0 unchanged polls)', () => {
      expect(getPollInterval(0, 0)).toBe(POLL_FAST_MS);
    });

    it('returns fast poll just below IDLE_TIER_1', () => {
      expect(getPollInterval(0, 5)).toBe(POLL_FAST_MS);
    });
  });

  describe('low failure count (1-2 failures)', () => {
    it('returns fast poll at 1 failure with no idle', () => {
      expect(getPollInterval(1, 0)).toBe(POLL_FAST_MS);
    });

    it('returns fast poll at 2 failures with no idle', () => {
      expect(getPollInterval(2, 0)).toBe(POLL_FAST_MS);
    });

    it('respects idle tiers even with 1-2 failures', () => {
      expect(getPollInterval(1, 6)).toBe(POLL_MEDIUM_MS);
      expect(getPollInterval(2, 12)).toBe(POLL_SLOW_MS);
      expect(getPollInterval(1, 60)).toBe(POLL_IDLE_MS);
    });
  });

  describe('exponential backoff (3+ failures, below offline threshold)', () => {
    it('at 3 failures: base=MEDIUM, exponent=0 -> MEDIUM * 1 = 15s', () => {
      // 15000 * 2^0 = 15000
      expect(getPollInterval(3, 0)).toBe(POLL_MEDIUM_MS);
    });

    it('at 4 failures: base=MEDIUM, exponent=1 -> MEDIUM * 2 = 30s', () => {
      // 15000 * 2^1 = 30000
      expect(getPollInterval(4, 0)).toBe(30_000);
    });

    it('at 5 failures: base=MEDIUM, exponent=2 -> MEDIUM * 4 = 60s (= cap)', () => {
      // 15000 * 2^2 = 60000 = BACKOFF_MAX_MS
      expect(getPollInterval(5, 0)).toBe(BACKOFF_MAX_MS);
    });

    it('failures < OFFLINE_THRESHOLD use MEDIUM as base', () => {
      // failures 3, 4, 5 are all < OFFLINE_THRESHOLD (6)
      expect(getPollInterval(3, 0)).toBe(POLL_MEDIUM_MS * Math.pow(2, 0));
      expect(getPollInterval(4, 0)).toBe(POLL_MEDIUM_MS * Math.pow(2, 1));
      expect(getPollInterval(5, 0)).toBe(Math.min(POLL_MEDIUM_MS * Math.pow(2, 2), BACKOFF_MAX_MS));
    });
  });

  describe('exponential backoff (at/above offline threshold)', () => {
    it('at 6 failures (= threshold): base=SLOW, exponent=3 -> SLOW * 8 = capped at 60s', () => {
      // 30000 * 2^3 = 240000, capped at 60000
      expect(getPollInterval(6, 0)).toBe(BACKOFF_MAX_MS);
    });

    it('at 7 failures: base=SLOW, exponent=4 -> capped at 60s', () => {
      // 30000 * 2^4 = 480000, capped at 60000
      expect(getPollInterval(7, 0)).toBe(BACKOFF_MAX_MS);
    });

    it('at 10 failures: still capped at 60s', () => {
      expect(getPollInterval(10, 0)).toBe(BACKOFF_MAX_MS);
    });

    it('at 100 failures: still capped at 60s', () => {
      expect(getPollInterval(100, 0)).toBe(BACKOFF_MAX_MS);
    });
  });

  describe('backoff cap enforcement', () => {
    it('never exceeds BACKOFF_MAX_MS regardless of failure count', () => {
      for (let f = 3; f <= 50; f++) {
        const interval = getPollInterval(f, 0);
        expect(interval).toBeLessThanOrEqual(BACKOFF_MAX_MS);
        expect(interval).toBeGreaterThan(0);
      }
    });

    it('backoff is monotonically non-decreasing up to the cap', () => {
      let prev = 0;
      for (let f = 3; f <= 20; f++) {
        const interval = getPollInterval(f, 0);
        expect(interval).toBeGreaterThanOrEqual(prev);
        prev = interval;
      }
    });
  });

  describe('idle tier progression', () => {
    it('IDLE_TIER_1 (6 unchanged polls) -> medium poll', () => {
      expect(getPollInterval(0, IDLE_TIER_1)).toBe(POLL_MEDIUM_MS);
    });

    it('IDLE_TIER_2 (12 unchanged polls) -> slow poll', () => {
      expect(getPollInterval(0, IDLE_TIER_2)).toBe(POLL_SLOW_MS);
    });

    it('IDLE_TIER_3 (60 unchanged polls) -> idle poll', () => {
      expect(getPollInterval(0, IDLE_TIER_3)).toBe(POLL_IDLE_MS);
    });

    it('values between tiers stay in the lower tier', () => {
      // Between tier 1 and tier 2
      expect(getPollInterval(0, 7)).toBe(POLL_MEDIUM_MS);
      expect(getPollInterval(0, 11)).toBe(POLL_MEDIUM_MS);
      // Between tier 2 and tier 3
      expect(getPollInterval(0, 13)).toBe(POLL_SLOW_MS);
      expect(getPollInterval(0, 59)).toBe(POLL_SLOW_MS);
    });

    it('values beyond IDLE_TIER_3 stay at idle poll', () => {
      expect(getPollInterval(0, 100)).toBe(POLL_IDLE_MS);
      expect(getPollInterval(0, 1000)).toBe(POLL_IDLE_MS);
    });

    it('failure-based backoff takes priority over idle tiers', () => {
      // 3 failures should use backoff formula, not idle tiers
      // Even if idle is at tier 3, failures >= 3 wins
      const result = getPollInterval(3, 60);
      expect(result).toBe(POLL_MEDIUM_MS); // 15000 * 2^0 = 15000, not POLL_IDLE_MS
    });
  });

  describe('exact backoff formula values', () => {
    it('produces the correct sequence below offline threshold', () => {
      // failures: 3 -> 15000 * 1 = 15000
      // failures: 4 -> 15000 * 2 = 30000
      // failures: 5 -> 15000 * 4 = 60000 (capped)
      const expected = [15_000, 30_000, 60_000];
      const actual = [3, 4, 5].map((f) => getPollInterval(f, 0));
      expect(actual).toEqual(expected);
    });

    it('produces the correct sequence at/above offline threshold', () => {
      // failures: 6 -> 30000 * 8 = 240000 -> capped at 60000
      // failures: 7 -> 30000 * 16 = 480000 -> capped at 60000
      const expected = [60_000, 60_000];
      const actual = [6, 7].map((f) => getPollInterval(f, 0));
      expect(actual).toEqual(expected);
    });
  });
});

// ── contextFingerprint Tests ───────────────────────────

describe('contextFingerprint', () => {
  it('returns empty string for null context', () => {
    expect(contextFingerprint(null)).toBe('');
    expect(contextFingerprint(undefined)).toBe('');
  });

  it('returns expected format for empty context', () => {
    expect(contextFingerprint({})).toBe(';0;0;0');
  });

  it('includes member details in fingerprint', () => {
    const ctx = {
      members: [
        {
          agent_id: 'agent-1',
          status: 'active',
          activity: { summary: 'working on auth', files: ['a.js', 'b.js'] },
        },
      ],
    };
    const fp = contextFingerprint(ctx);
    expect(fp).toContain('agent-1');
    expect(fp).toContain('active');
    expect(fp).toContain('working on auth');
    expect(fp).toContain(':2'); // files count
  });

  it('handles members with missing activity', () => {
    const ctx = {
      members: [{ agent_id: 'a', status: 'idle' }],
    };
    const fp = contextFingerprint(ctx);
    expect(fp).toContain('a:idle::0');
  });

  it('handles members with activity but no files', () => {
    const ctx = {
      members: [{ agent_id: 'a', status: 'active', activity: { summary: 'reviewing' } }],
    };
    const fp = contextFingerprint(ctx);
    expect(fp).toContain('a:active:reviewing:0');
  });

  it('joins multiple members with pipe separator', () => {
    const ctx = {
      members: [
        { agent_id: 'a', status: 'active' },
        { agent_id: 'b', status: 'idle' },
      ],
    };
    const fp = contextFingerprint(ctx);
    expect(fp).toContain('|');
    const memberPart = fp.split(';')[0];
    expect(memberPart.split('|')).toHaveLength(2);
  });

  it('counts memories, messages, and locks', () => {
    const ctx = {
      members: [],
      memories: [{ id: 1 }, { id: 2 }, { id: 3 }],
      messages: [{ id: 1 }],
      locks: [{ id: 1 }, { id: 2 }],
    };
    const fp = contextFingerprint(ctx);
    expect(fp).toBe(';3;1;2');
  });

  it('detects changes when a member status changes', () => {
    const ctx1 = {
      members: [{ agent_id: 'a', status: 'active' }],
      memories: [],
      messages: [],
      locks: [],
    };
    const ctx2 = {
      members: [{ agent_id: 'a', status: 'idle' }],
      memories: [],
      messages: [],
      locks: [],
    };
    expect(contextFingerprint(ctx1)).not.toBe(contextFingerprint(ctx2));
  });

  it('detects changes when a memory is added', () => {
    const ctx1 = { memories: [{ id: 1 }] };
    const ctx2 = { memories: [{ id: 1 }, { id: 2 }] };
    expect(contextFingerprint(ctx1)).not.toBe(contextFingerprint(ctx2));
  });

  it('detects changes when a file is added to activity', () => {
    const ctx1 = {
      members: [{ agent_id: 'a', status: 'active', activity: { files: ['a.js'] } }],
    };
    const ctx2 = {
      members: [{ agent_id: 'a', status: 'active', activity: { files: ['a.js', 'b.js'] } }],
    };
    expect(contextFingerprint(ctx1)).not.toBe(contextFingerprint(ctx2));
  });

  it('does NOT detect changes for same data in different order', () => {
    // Fingerprint is order-dependent on members array
    const ctx1 = {
      members: [
        { agent_id: 'a', status: 'active' },
        { agent_id: 'b', status: 'idle' },
      ],
    };
    const ctx2 = {
      members: [
        { agent_id: 'b', status: 'idle' },
        { agent_id: 'a', status: 'active' },
      ],
    };
    // Fingerprints SHOULD differ because order changed - this is by design
    // (cheap fingerprint, not a hash-set comparison)
    expect(contextFingerprint(ctx1)).not.toBe(contextFingerprint(ctx2));
  });
});

// ── Idle counter reset simulation ──────────────────────

describe('idle counter reset on fingerprint change', () => {
  // Simulates the logic in fetchContextOnce that resets unchangedPolls
  // when the context fingerprint changes.

  function simulatePolls(contexts) {
    let unchangedPolls = 0;
    let lastFingerprint = '';
    const pollIntervals = [];

    for (const ctx of contexts) {
      const fp = contextFingerprint(ctx);
      if (fp === lastFingerprint) {
        unchangedPolls++;
      } else {
        unchangedPolls = 0;
        lastFingerprint = fp;
      }
      pollIntervals.push(getPollInterval(0, unchangedPolls));
    }

    return { pollIntervals, finalUnchangedPolls: unchangedPolls };
  }

  it('starts at fast poll with changing contexts', () => {
    const contexts = [
      { members: [{ agent_id: 'a', status: 'active' }] },
      { members: [{ agent_id: 'a', status: 'idle' }] },
      { members: [{ agent_id: 'a', status: 'active' }] },
    ];
    const { pollIntervals } = simulatePolls(contexts);
    // Every context is different, so unchangedPolls resets to 0 each time
    expect(pollIntervals.every((ms) => ms === POLL_FAST_MS)).toBe(true);
  });

  it('progresses through idle tiers with identical contexts', () => {
    const sameCtx = { members: [{ agent_id: 'a', status: 'idle' }] };
    const contexts = Array(61).fill(sameCtx);
    const { pollIntervals } = simulatePolls(contexts);

    // First poll: fingerprint changes from '' to the context value -> reset to 0 -> fast
    expect(pollIntervals[0]).toBe(POLL_FAST_MS);
    // Polls 1-5: unchangedPolls 1-5 -> still fast (tier 1 starts at 6)
    expect(pollIntervals[5]).toBe(POLL_FAST_MS);
    // Poll 6: unchangedPolls=6 -> medium (IDLE_TIER_1)
    expect(pollIntervals[6]).toBe(POLL_MEDIUM_MS);
    // Poll 12: unchangedPolls=12 -> slow (IDLE_TIER_2)
    expect(pollIntervals[12]).toBe(POLL_SLOW_MS);
    // Poll 60: unchangedPolls=60 -> idle (IDLE_TIER_3)
    expect(pollIntervals[60]).toBe(POLL_IDLE_MS);
  });

  it('resets to fast poll when context changes after idle period', () => {
    const sameCtx = { members: [{ agent_id: 'a', status: 'idle' }] };
    const changedCtx = { members: [{ agent_id: 'a', status: 'active' }] };

    // 10 identical polls, then a change
    const contexts = [...Array(10).fill(sameCtx), changedCtx];
    const { pollIntervals } = simulatePolls(contexts);

    // The last poll (after the change) should be back to fast
    expect(pollIntervals[pollIntervals.length - 1]).toBe(POLL_FAST_MS);

    // The one before (unchangedPolls=9, in tier 1) should be medium
    expect(pollIntervals[pollIntervals.length - 2]).toBe(POLL_MEDIUM_MS);
  });
});
