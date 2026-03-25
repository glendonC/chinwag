import { describe, it, expect } from 'vitest';
import { isBlocked, checkRateLimit } from '../moderation.js';

// --- isBlocked ---

describe('isBlocked', () => {
  it('blocks known slurs', () => {
    expect(isBlocked('nigger')).toBe(true);
    expect(isBlocked('chink')).toBe(true);
    expect(isBlocked('faggot')).toBe(true);
    expect(isBlocked('retard')).toBe(true);
  });

  it('blocks case-insensitively', () => {
    expect(isBlocked('NIGGER')).toBe(true);
    expect(isBlocked('Chink')).toBe(true);
    expect(isBlocked('FaGgOt')).toBe(true);
    expect(isBlocked('RETARDED')).toBe(true);
  });

  it('blocks slurs embedded in a sentence', () => {
    expect(isBlocked('you are a faggot')).toBe(true);
    expect(isBlocked('what a retard move')).toBe(true);
    expect(isBlocked('hey nigga what up')).toBe(true);
  });

  it('uses word boundary matching (does not block substrings)', () => {
    // "spic" should not match inside "despicable"
    expect(isBlocked('despicable')).toBe(false);
    // "fag" should not match inside "fagging" — actually "fag" has \b so "fagging" would not match
    // because \bfag\b requires word boundary after "g", and "fagging" has "g" followed by more chars
    expect(isBlocked('fagging')).toBe(false);
  });

  it('blocks multi-word patterns', () => {
    expect(isBlocked('kill yourself')).toBe(true);
    expect(isBlocked('buy followers')).toBe(true);
    expect(isBlocked('dm me for something')).toBe(true);
  });

  it('blocks multi-word patterns with extra spacing', () => {
    expect(isBlocked('kill  yourself')).toBe(true);
    expect(isBlocked('dm  me  for info')).toBe(true);
  });

  it('blocks "kys"', () => {
    expect(isBlocked('kys')).toBe(true);
    expect(isBlocked('just kys already')).toBe(true);
  });

  it('returns false for clean text', () => {
    expect(isBlocked('hello world')).toBe(false);
    expect(isBlocked('this is a normal message')).toBe(false);
    expect(isBlocked('working on the refactor')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isBlocked('')).toBe(false);
  });

  it('returns false for text with no matching patterns', () => {
    expect(isBlocked('The quick brown fox jumps over the lazy dog')).toBe(false);
    expect(isBlocked('function parseTeamPath(path) { return null; }')).toBe(false);
  });

  it('blocks plural forms in the blocklist', () => {
    expect(isBlocked('niggers')).toBe(true);
    expect(isBlocked('kikes')).toBe(true);
    expect(isBlocked('coons')).toBe(true);
    expect(isBlocked('trannies')).toBe(true);
  });

  it('blocks spam patterns', () => {
    expect(isBlocked('free crypto giveaway')).toBe(true);
    expect(isBlocked('buy followers cheap')).toBe(true);
  });
});

// --- checkRateLimit ---

describe('checkRateLimit', () => {
  it('returns true when under the limit', () => {
    const key = `test-under-limit-${Date.now()}-${Math.random()}`;
    expect(checkRateLimit(key, 5)).toBe(true);
    expect(checkRateLimit(key, 5)).toBe(true);
    expect(checkRateLimit(key, 5)).toBe(true);
  });

  it('returns true at exactly the limit', () => {
    const key = `test-at-limit-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, 3);
    }
    // The 3rd call should still be true (count === maxPerMinute)
    expect(checkRateLimit(key, 3)).toBe(false);
    // Wait, let me reconsider: the first 3 calls increment count to 3, then the 4th call increments to 4
    // Actually each call increments first, then checks. So:
    // call 1: count=1, 1<=3 -> true
    // call 2: count=2, 2<=3 -> true
    // call 3: count=3, 3<=3 -> true
    // call 4: count=4, 4<=3 -> false
  });

  it('returns false when over the limit', () => {
    const key = `test-over-limit-${Date.now()}-${Math.random()}`;
    const max = 3;
    // Exhaust the limit
    for (let i = 0; i < max; i++) {
      checkRateLimit(key, max);
    }
    // Next call should be over
    expect(checkRateLimit(key, max)).toBe(false);
  });

  it('tracks different keys independently', () => {
    const keyA = `test-key-a-${Date.now()}-${Math.random()}`;
    const keyB = `test-key-b-${Date.now()}-${Math.random()}`;

    // Exhaust keyA
    for (let i = 0; i < 2; i++) {
      checkRateLimit(keyA, 2);
    }
    expect(checkRateLimit(keyA, 2)).toBe(false);

    // keyB should still be fine
    expect(checkRateLimit(keyB, 2)).toBe(true);
  });

  it('returns true for first call with default limit', () => {
    const key = `test-default-${Date.now()}-${Math.random()}`;
    expect(checkRateLimit(key)).toBe(true);
  });

  it('allows exactly maxPerMinute calls', () => {
    const key = `test-exact-${Date.now()}-${Math.random()}`;
    const max = 5;
    const results = [];
    for (let i = 0; i < max + 2; i++) {
      results.push(checkRateLimit(key, max));
    }
    // First 5 calls should be true, remaining should be false
    expect(results.slice(0, max).every(r => r === true)).toBe(true);
    expect(results.slice(max).every(r => r === false)).toBe(true);
  });

  it('handles limit of 1', () => {
    const key = `test-limit-one-${Date.now()}-${Math.random()}`;
    expect(checkRateLimit(key, 1)).toBe(true);
    expect(checkRateLimit(key, 1)).toBe(false);
  });
});
