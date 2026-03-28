import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateAgentId, generateSessionAgentId, detectToolName, getConfiguredAgentId } from '../identity.js';

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

describe('generateSessionAgentId', () => {
  it('keeps the deterministic base id as a prefix', () => {
    const base = generateAgentId('tok_abc123', 'cursor');
    const sessionId = generateSessionAgentId('tok_abc123', 'cursor');
    expect(sessionId.startsWith(`${base}:`)).toBe(true);
  });

  it('adds an 8-hex random suffix', () => {
    const sessionId = generateSessionAgentId('tok_abc123', 'claude-code');
    expect(sessionId).toMatch(/^claude-code:[0-9a-f]{12}:[0-9a-f]{8}$/);
  });

  it('returns different ids for separate sessions', () => {
    const a = generateSessionAgentId('same-token', 'cursor');
    const b = generateSessionAgentId('same-token', 'cursor');
    expect(a).not.toBe(b);
  });
});

describe('detectToolName', () => {
  let savedArgv;
  let savedEnv;
  let savedAgentId;

  beforeEach(() => {
    savedArgv = [...process.argv];
    savedEnv = process.env.CHINWAG_TOOL;
    savedAgentId = process.env.CHINWAG_AGENT_ID;
    // Clean slate: remove --tool from argv and env var
    process.argv = process.argv.filter((_, i, arr) => {
      if (arr[i] === '--tool') return false;
      if (i > 0 && arr[i - 1] === '--tool') return false;
      return true;
    });
    delete process.env.CHINWAG_TOOL;
    delete process.env.CHINWAG_AGENT_ID;
  });

  afterEach(() => {
    process.argv = savedArgv;
    if (savedEnv !== undefined) {
      process.env.CHINWAG_TOOL = savedEnv;
    } else {
      delete process.env.CHINWAG_TOOL;
    }
    if (savedAgentId !== undefined) {
      process.env.CHINWAG_AGENT_ID = savedAgentId;
    } else {
      delete process.env.CHINWAG_AGENT_ID;
    }
  });

  it('returns the provided default when no argv/env is set', () => {
    expect(detectToolName('claude-code', { readProcessInfoFn: () => null })).toBe('claude-code');
  });

  it('returns "unknown" when called with no arguments', () => {
    expect(detectToolName('unknown', { readProcessInfoFn: () => null })).toBe('unknown');
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

  it('infers the tool from parent process commands', () => {
    const readProcessInfoFn = vi.fn((pid) => {
      if (pid === 10) return { ppid: 20, command: 'npm exec chinwag-mcp' };
      if (pid === 20) return { ppid: 1, command: 'claude' };
      return null;
    });

    expect(detectToolName('fallback', { parentPid: 10, readProcessInfoFn })).toBe('claude-code');
  });

  it('infers tools from registry-backed executable names', () => {
    const readProcessInfoFn = vi.fn((pid) => {
      if (pid === 50) return { ppid: 1, command: '/Applications/PyCharm.app/Contents/MacOS/pycharm project' };
      return null;
    });

    expect(detectToolName('fallback', { parentPid: 50, readProcessInfoFn })).toBe('jetbrains');
  });

  it('infers tools from registry-backed command aliases', () => {
    const readProcessInfoFn = vi.fn((pid) => {
      if (pid === 80) return { ppid: 1, command: 'Code Helper (Plugin) --inspect' };
      return null;
    });

    expect(detectToolName('fallback', { parentPid: 80, readProcessInfoFn })).toBe('vscode');
  });

  it('falls back when parent process inspection finds nothing', () => {
    const readProcessInfoFn = vi.fn(() => null);
    expect(detectToolName('fallback', { parentPid: 10, readProcessInfoFn })).toBe('fallback');
  });
});

describe('getConfiguredAgentId', () => {
  afterEach(() => {
    delete process.env.CHINWAG_AGENT_ID;
  });

  it('returns a configured session id when the prefix matches the tool', () => {
    process.env.CHINWAG_AGENT_ID = 'claude-code:abc123:def45678';
    expect(getConfiguredAgentId('claude-code')).toBe('claude-code:abc123:def45678');
  });

  it('ignores configured ids for the wrong tool', () => {
    process.env.CHINWAG_AGENT_ID = 'cursor:abc123:def45678';
    expect(getConfiguredAgentId('claude-code')).toBeNull();
  });
});
