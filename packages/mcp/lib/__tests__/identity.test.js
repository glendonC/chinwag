import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateAgentId, detectToolName } from '../identity.js';

describe('generateAgentId', () => {
  it('is deterministic — same input produces same output', () => {
    const a = generateAgentId('tok_abc123', 'cursor');
    const b = generateAgentId('tok_abc123', 'cursor');
    expect(a).toBe(b);
  });

  it('returns format "tool:12hexchars"', () => {
    const id = generateAgentId('tok_abc123', 'claude-code');
    expect(id).toMatch(/^claude-code:[0-9a-f]{12}$/);
  });

  it('different tokens produce different hashes', () => {
    const a = generateAgentId('token-one', 'cursor');
    const b = generateAgentId('token-two', 'cursor');
    expect(a).not.toBe(b);
  });

  it('different tools produce different prefixes but same hash', () => {
    const a = generateAgentId('same-token', 'cursor');
    const b = generateAgentId('same-token', 'aider');
    // Same token → same hash portion
    const hashA = a.split(':')[1];
    const hashB = b.split(':')[1];
    expect(hashA).toBe(hashB);
    // Different tool prefix
    expect(a.split(':')[0]).toBe('cursor');
    expect(b.split(':')[0]).toBe('aider');
  });
});

describe('detectToolName', () => {
  let savedArgv;
  let savedEnv;

  beforeEach(() => {
    savedArgv = [...process.argv];
    savedEnv = process.env.CHINWAG_TOOL;
    // Clean slate: remove --tool from argv and env var
    process.argv = process.argv.filter((_, i, arr) => {
      if (arr[i] === '--tool') return false;
      if (i > 0 && arr[i - 1] === '--tool') return false;
      return true;
    });
    delete process.env.CHINWAG_TOOL;
  });

  afterEach(() => {
    process.argv = savedArgv;
    if (savedEnv !== undefined) {
      process.env.CHINWAG_TOOL = savedEnv;
    } else {
      delete process.env.CHINWAG_TOOL;
    }
  });

  it('returns the provided default when no argv/env is set', () => {
    expect(detectToolName('claude-code')).toBe('claude-code');
  });

  it('returns "unknown" when called with no arguments', () => {
    expect(detectToolName()).toBe('unknown');
  });

  it('reads --tool from process.argv', () => {
    process.argv.push('--tool', 'cursor');
    expect(detectToolName('fallback')).toBe('cursor');
  });

  it('reads CHINWAG_TOOL from process.env', () => {
    process.env.CHINWAG_TOOL = 'windsurf';
    expect(detectToolName('fallback')).toBe('windsurf');
  });

  it('argv --tool takes priority over env var', () => {
    process.argv.push('--tool', 'cursor');
    process.env.CHINWAG_TOOL = 'windsurf';
    expect(detectToolName('fallback')).toBe('cursor');
  });
});
