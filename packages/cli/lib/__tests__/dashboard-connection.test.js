import { describe, expect, it } from 'vitest';
import { classifyError, contextFingerprint } from '../dashboard/connection.jsx';

describe('classifyError', () => {
  it('classifies 401 as fatal offline with expired session', () => {
    const result = classifyError({ status: 401, message: '' });
    expect(result.state).toBe('offline');
    expect(result.detail).toMatch(/expired/i);
    expect(result.fatal).toBe(true);
  });

  it('classifies 403 as offline with access denied', () => {
    const result = classifyError({ status: 403, message: '' });
    expect(result.state).toBe('offline');
    expect(result.detail).toMatch(/access denied/i);
  });

  it('classifies 404 as offline with team not found', () => {
    const result = classifyError({ status: 404, message: '' });
    expect(result.state).toBe('offline');
    expect(result.detail).toMatch(/not found/i);
  });

  it('classifies 429 as reconnecting with rate limit', () => {
    const result = classifyError({ status: 429, message: '' });
    expect(result.state).toBe('reconnecting');
    expect(result.detail).toMatch(/rate limit/i);
  });

  it('classifies 500+ as reconnecting', () => {
    const result = classifyError({ status: 502, message: '' });
    expect(result.state).toBe('reconnecting');
    expect(result.detail).toMatch(/server error/i);
  });

  it('classifies timeout as reconnecting', () => {
    const result = classifyError({ status: 408, message: '' });
    expect(result.state).toBe('reconnecting');
    expect(result.detail).toMatch(/timed out/i);
  });

  it('classifies timeout message as reconnecting', () => {
    const result = classifyError({ message: 'request timed out' });
    expect(result.state).toBe('reconnecting');
    expect(result.detail).toMatch(/timed out/i);
  });

  it('classifies ECONNREFUSED as offline', () => {
    const result = classifyError({ message: 'ECONNREFUSED' });
    expect(result.state).toBe('offline');
    expect(result.detail).toMatch(/cannot reach/i);
  });

  it('classifies ECONNRESET as offline', () => {
    const result = classifyError({ message: 'ECONNRESET' });
    expect(result.state).toBe('offline');
  });

  it('classifies ENOTFOUND as offline', () => {
    const result = classifyError({ message: 'ENOTFOUND' });
    expect(result.state).toBe('offline');
  });

  it('classifies EAI_AGAIN as offline', () => {
    const result = classifyError({ message: 'EAI_AGAIN' });
    expect(result.state).toBe('offline');
  });

  it('classifies unknown errors as reconnecting', () => {
    const result = classifyError({ message: 'something weird happened' });
    expect(result.state).toBe('reconnecting');
    expect(result.detail).toMatch(/something weird/i);
  });

  it('handles empty error object', () => {
    const result = classifyError({});
    expect(result.state).toBe('reconnecting');
  });
});

describe('contextFingerprint', () => {
  it('returns empty string for null context', () => {
    expect(contextFingerprint(null)).toBe('');
    expect(contextFingerprint(undefined)).toBe('');
  });

  it('returns a fingerprint for an empty context', () => {
    const fp = contextFingerprint({});
    expect(fp).toBe(';0;0;0');
  });

  it('includes member data in fingerprint', () => {
    const ctx = {
      members: [
        {
          agent_id: 'claude-code:abc:123',
          status: 'active',
          activity: { summary: 'Working on auth', files: ['a.js', 'b.js'] },
        },
      ],
      memories: [],
      messages: [],
      locks: [],
    };
    const fp = contextFingerprint(ctx);
    expect(fp).toContain('claude-code:abc:123');
    expect(fp).toContain('active');
    expect(fp).toContain('Working on auth');
    expect(fp).toContain('2'); // files.length
  });

  it('changes when members change', () => {
    const base = {
      members: [{ agent_id: 'a', status: 'active', activity: { summary: 'X', files: [] } }],
      memories: [],
      messages: [],
      locks: [],
    };
    const changed = {
      ...base,
      members: [{ agent_id: 'a', status: 'active', activity: { summary: 'Y', files: ['z.js'] } }],
    };
    expect(contextFingerprint(base)).not.toBe(contextFingerprint(changed));
  });

  it('changes when memory count changes', () => {
    const a = { memories: [{ id: 1 }], members: [], messages: [], locks: [] };
    const b = { memories: [{ id: 1 }, { id: 2 }], members: [], messages: [], locks: [] };
    expect(contextFingerprint(a)).not.toBe(contextFingerprint(b));
  });

  it('changes when message count changes', () => {
    const a = { messages: [], members: [], memories: [], locks: [] };
    const b = { messages: [{ id: 1 }], members: [], memories: [], locks: [] };
    expect(contextFingerprint(a)).not.toBe(contextFingerprint(b));
  });
});
