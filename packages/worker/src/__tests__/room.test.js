import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

import { checkWindowedRateLimit } from '../room.js';

describe('checkWindowedRateLimit', () => {
  it('allows requests up to the limit within the window', () => {
    const rateLimits = new Map();
    const now = 1_000_000;

    expect(checkWindowedRateLimit(rateLimits, 'chat:alice', 3, now)).toBe(true);
    expect(checkWindowedRateLimit(rateLimits, 'chat:alice', 3, now + 1)).toBe(true);
    expect(checkWindowedRateLimit(rateLimits, 'chat:alice', 3, now + 2)).toBe(true);
  });

  it('blocks requests after the limit is exceeded', () => {
    const rateLimits = new Map();
    const now = 1_000_000;

    checkWindowedRateLimit(rateLimits, 'chat:alice', 2, now);
    checkWindowedRateLimit(rateLimits, 'chat:alice', 2, now + 1);

    expect(checkWindowedRateLimit(rateLimits, 'chat:alice', 2, now + 2)).toBe(false);
  });

  it('tracks each chat handle independently', () => {
    const rateLimits = new Map();
    const now = 1_000_000;

    checkWindowedRateLimit(rateLimits, 'chat:alice', 1, now);

    expect(checkWindowedRateLimit(rateLimits, 'chat:alice', 1, now + 1)).toBe(false);
    expect(checkWindowedRateLimit(rateLimits, 'chat:bob', 1, now + 1)).toBe(true);
  });

  it('resets the count when the window expires', () => {
    const rateLimits = new Map();
    const now = 1_000_000;

    checkWindowedRateLimit(rateLimits, 'chat:alice', 1, now);

    expect(checkWindowedRateLimit(rateLimits, 'chat:alice', 1, now + 60_001)).toBe(true);
  });

  it('prunes old entries when the map grows large', () => {
    const rateLimits = new Map();
    const now = 1_000_000;

    for (let i = 0; i < 501; i++) {
      rateLimits.set(`chat:old-${i}`, { windowStart: now - 200_000, count: 1 });
    }

    checkWindowedRateLimit(rateLimits, 'chat:alice', 1, now);

    expect(rateLimits.size).toBeLessThan(503);
    expect(rateLimits.has('chat:alice')).toBe(true);
  });
});
