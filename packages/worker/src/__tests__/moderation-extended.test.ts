import { describe, it, expect, vi } from 'vitest';

// Mock cloudflare:workers so moderation.js can be imported outside the Workers runtime
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

import { isBlocked, checkContent } from '../moderation.js';

// --- Layer 1: Blocklist (sync) ---

describe('isBlocked - edge cases', () => {
  it('blocks mixed case slurs', () => {
    expect(isBlocked('NiGgEr')).toBe(true);
    expect(isBlocked('FAGGOT')).toBe(true);
    expect(isBlocked('ReTaRdEd')).toBe(true);
  });

  it('blocks slurs at start of string', () => {
    expect(isBlocked('nigger is a slur')).toBe(true);
  });

  it('blocks slurs at end of string', () => {
    expect(isBlocked('you are a retard')).toBe(true);
  });

  it('does not block partial word matches', () => {
    // "coon" should not match "raccoon" because of word boundary
    expect(isBlocked('raccoon')).toBe(false);
    // "fag" should not match "fagging" because of word boundary
    expect(isBlocked('fagging')).toBe(false);
    // "spic" should not match in "despicable"
    expect(isBlocked('despicable')).toBe(false);
  });

  it('blocks multi-word patterns with varied spacing', () => {
    expect(isBlocked('kill   yourself')).toBe(true);
    expect(isBlocked('dm   me   for something')).toBe(true);
  });

  it('passes clean technical text', () => {
    expect(isBlocked('function handleRetry() { return null; }')).toBe(false);
    expect(isBlocked('import { spawn } from "child_process"')).toBe(false);
    expect(isBlocked('git rebase --continue')).toBe(false);
    expect(isBlocked('SELECT * FROM users WHERE id = ?')).toBe(false);
  });

  it('passes empty and whitespace-only strings', () => {
    expect(isBlocked('')).toBe(false);
    expect(isBlocked('   ')).toBe(false);
    expect(isBlocked('\n\t')).toBe(false);
  });
});

// --- Layer 2: AI moderation ---

describe('checkContent - AI moderation layer', () => {
  it('returns blocked when blocklist catches (AI not called)', async () => {
    const mockAI = { run: vi.fn() };
    const env = { AI: mockAI };

    const result = await checkContent('kill yourself', env);
    expect(result).toEqual({ blocked: true, reason: 'blocked_term' });
    // AI should NOT have been called - blocklist caught it first
    expect(mockAI.run).not.toHaveBeenCalled();
  });

  it('calls AI when blocklist passes and AI flags content', async () => {
    const mockAI = {
      run: vi.fn().mockResolvedValue({
        response: 'unsafe\nS10',
      }),
    };
    const env = { AI: mockAI };

    const result = await checkContent('some subtle hate speech', env);
    expect(result).toEqual({
      blocked: true,
      reason: 'ai_flagged',
      categories: ['S10'],
    });
    expect(mockAI.run).toHaveBeenCalledOnce();
    expect(mockAI.run).toHaveBeenCalledWith('@cf/meta/llama-guard-3-8b', {
      messages: [{ role: 'user', content: 'some subtle hate speech' }],
      max_tokens: 64,
    });
  });

  it('returns not blocked when AI says safe', async () => {
    const mockAI = {
      run: vi.fn().mockResolvedValue({
        response: 'safe',
      }),
    };
    const env = { AI: mockAI };

    const result = await checkContent('normal message about code', env);
    expect(result).toEqual({ blocked: false });
    expect(mockAI.run).toHaveBeenCalledOnce();
  });

  it('parses multiple AI categories', async () => {
    const mockAI = {
      run: vi.fn().mockResolvedValue({
        response: 'unsafe\nS10,S11',
      }),
    };
    const env = { AI: mockAI };

    const result = await checkContent('dangerous content', env);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('ai_flagged');
    expect(result.categories).toContain('S10');
    expect(result.categories).toContain('S11');
  });

  it('blocks as fail-safe when AI binding is unavailable', async () => {
    const env = {}; // no AI binding

    const result = await checkContent('some text that is actually fine', env);
    expect(result).toEqual({ blocked: true, reason: 'moderation_unavailable', degraded: true });
  });

  it('blocks as fail-safe when AI throws an error', async () => {
    const mockAI = {
      run: vi.fn().mockRejectedValue(new Error('AI service down')),
    };
    const env = { AI: mockAI };

    const result = await checkContent('some text', env);
    // AI failure means fail-safe: block the content
    expect(result).toEqual({ blocked: true, reason: 'moderation_unavailable', degraded: true });
  });

  it('handles AI returning empty response', async () => {
    const mockAI = {
      run: vi.fn().mockResolvedValue({
        response: '',
      }),
    };
    const env = { AI: mockAI };

    const result = await checkContent('some text', env);
    // Empty response is not "safe" explicitly, but also not "unsafe\n..."
    // The code checks output.startsWith('safe'), so empty won't match, and
    // categories will be empty, so flagged:true with empty categories
    expect(result.blocked).toBe(true);
    expect(result.categories).toEqual([]);
  });

  it('handles AI returning null response', async () => {
    const mockAI = {
      run: vi.fn().mockResolvedValue({
        response: null,
      }),
    };
    const env = { AI: mockAI };

    // (response || '').trim() → ''.trim() → '' → startsWith('safe') is false
    // categories will be empty
    const result = await checkContent('some text', env);
    expect(result.blocked).toBe(true);
    expect(result.categories).toEqual([]);
  });

  it('two-layer interaction: blocklist blocks before AI runs', async () => {
    const mockAI = { run: vi.fn() };
    const env = { AI: mockAI };

    // Blocklist catches "nigger"
    const result = await checkContent('you are a nigger', env);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('blocked_term');
    // AI was never consulted
    expect(mockAI.run).not.toHaveBeenCalled();
  });

  it('two-layer interaction: clean text that AI also says safe', async () => {
    const mockAI = {
      run: vi.fn().mockResolvedValue({ response: 'safe' }),
    };
    const env = { AI: mockAI };

    const result = await checkContent('refactoring the team module', env);
    expect(result.blocked).toBe(false);
    expect(mockAI.run).toHaveBeenCalledOnce();
  });
});
