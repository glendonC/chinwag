import { describe, it, expect } from 'vitest';
import { isBlocked, checkContent } from '../moderation.js';

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
    // "fag" should not match inside "fagging" - actually "fag" has \b so "fagging" would not match
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

// --- isBlocked: Unicode & evasion edge cases ---

describe('isBlocked - Unicode evasion', () => {
  it('does not catch zero-width joiner inserted into slurs (known limitation)', () => {
    // Zero-width joiners break word boundaries - this is a known gap
    // that the AI layer (Layer 2) is supposed to catch.
    const zwj = '\u200D'; // zero-width joiner
    expect(isBlocked(`n${zwj}igger`)).toBe(false);
  });

  it('does not catch Cyrillic lookalike substitution (known limitation for AI layer)', () => {
    // "niggеr" with Cyrillic е (U+0435) instead of Latin e (U+0065)
    expect(isBlocked('nigg\u0435r')).toBe(false);
  });

  it('does not catch zero-width space evasion (known limitation for AI layer)', () => {
    const zws = '\u200B'; // zero-width space
    expect(isBlocked(`f${zws}aggot`)).toBe(false);
  });

  it('blocks slurs on separate lines in multi-line input', () => {
    expect(isBlocked('first line\nsecond line nigger third')).toBe(true);
    expect(isBlocked('line one\nkill yourself\nline three')).toBe(true);
  });

  it('returns false for multi-line clean text', () => {
    expect(isBlocked('line one\nline two\nline three')).toBe(false);
    expect(isBlocked('function foo() {\n  return bar;\n}')).toBe(false);
  });

  it('handles input at boundary lengths', () => {
    // Very long clean string
    const longClean = 'a'.repeat(10000);
    expect(isBlocked(longClean)).toBe(false);

    // Very long string with a slur buried in the middle
    const longWithSlur = 'a'.repeat(5000) + ' nigger ' + 'b'.repeat(5000);
    expect(isBlocked(longWithSlur)).toBe(true);
  });

  it('handles strings that are only whitespace', () => {
    expect(isBlocked('   ')).toBe(false);
    expect(isBlocked('\t\t\t')).toBe(false);
    expect(isBlocked('\n\n\n')).toBe(false);
  });

  it('blocks slurs surrounded by punctuation', () => {
    expect(isBlocked('...nigger...')).toBe(true);
    expect(isBlocked('(faggot)')).toBe(true);
    expect(isBlocked('"retard"')).toBe(true);
    expect(isBlocked('-kys-')).toBe(true);
  });

  it('blocks slurs at start and end of input', () => {
    expect(isBlocked('nigger')).toBe(true);
    expect(isBlocked('some text retard')).toBe(true);
    expect(isBlocked('faggot is at the start')).toBe(true);
  });
});

// --- checkContent (AI moderation integration) ---

describe('checkContent', () => {
  it('returns blocked for blocklist match (no AI needed)', async () => {
    const result = await checkContent('you are a faggot', {});
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('blocked_term');
  });

  it('returns blocked as fail-safe when AI binding is unavailable', async () => {
    const result = await checkContent('hello world', {});
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('moderation_unavailable');
    expect(result.degraded).toBe(true);
  });

  it('allows content through blocklist fallback in local_safe mode when AI is unavailable', async () => {
    const result = await checkContent('hello world', {
      ENVIRONMENT: 'local',
      MODERATION_MODE: 'local_safe',
    });
    expect(result).toEqual({ blocked: false, degraded: true });
  });

  it('returns not blocked when AI returns safe', async () => {
    const mockEnv = {
      AI: {
        run: async () => ({ response: 'safe' }),
      },
    };
    const result = await checkContent('some borderline text', mockEnv);
    expect(result.blocked).toBe(false);
  });

  it('returns blocked with categories when AI returns unsafe', async () => {
    const mockEnv = {
      AI: {
        run: async () => ({ response: 'unsafe\nS10' }),
      },
    };
    const result = await checkContent('some hateful text that passes blocklist', mockEnv);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('ai_flagged');
    expect(result.categories).toContain('S10');
  });

  it('parses multiple AI categories', async () => {
    const mockEnv = {
      AI: {
        run: async () => ({ response: 'unsafe\ns10,s11' }),
      },
    };
    const result = await checkContent('complex harmful content', mockEnv);
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain('S10');
    expect(result.categories).toContain('S11');
  });

  it('blocks as fail-safe when AI binding throws', async () => {
    const mockEnv = {
      AI: {
        run: async () => {
          throw new Error('AI service unavailable');
        },
      },
    };
    // Clean text + AI throws = fail-safe blocks content
    const result = await checkContent('normal text here', mockEnv);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('moderation_unavailable');
    expect(result.degraded).toBe(true);
  });

  it('allows content in local_safe mode when AI throws', async () => {
    const mockEnv = {
      ENVIRONMENT: 'local',
      MODERATION_MODE: 'local_safe',
      AI: {
        run: async () => {
          throw new Error('AI service unavailable');
        },
      },
    };
    const result = await checkContent('normal text here', mockEnv);
    expect(result).toEqual({ blocked: false, degraded: true });
  });

  it('blocks as fail-safe when AI binding is undefined', async () => {
    const result = await checkContent('normal text here', {});
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('moderation_unavailable');
    expect(result.degraded).toBe(true);
  });

  it('blocks as fail-safe when AI binding is null', async () => {
    const result = await checkContent('normal text here', { AI: null });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('moderation_unavailable');
    expect(result.degraded).toBe(true);
  });

  it('blocklist takes priority over AI (short-circuits)', async () => {
    let aiCalled = false;
    const mockEnv = {
      AI: {
        run: async () => {
          aiCalled = true;
          return { response: 'safe' };
        },
      },
    };
    const result = await checkContent('nigger', mockEnv);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('blocked_term');
    // AI should NOT have been called - blocklist short-circuits
    expect(aiCalled).toBe(false);
  });

  it('handles AI returning empty response', async () => {
    const mockEnv = {
      AI: {
        run: async () => ({ response: '' }),
      },
    };
    // Empty response doesn't start with 'safe', so we need to check behavior
    const result = await checkContent('test input', mockEnv);
    // Empty response doesn't start with 'safe' and doesn't match 'unsafe'
    // It will fall through to flagged=true with empty categories
    expect(result.blocked).toBe(true);
    expect(result.categories).toEqual([]);
  });

  it('handles AI returning null response', async () => {
    const mockEnv = {
      AI: {
        run: async () => ({ response: null }),
      },
    };
    // null.trim() would throw, caught by try/catch → returns null → not blocked
    const result = await checkContent('test input', mockEnv);
    // The (response.response || '') handles null, so it becomes ''
    // '' doesn't start with 'safe' → flagged with no categories
    expect(result.blocked).toBe(true);
  });
});
