import { describe, it, expect } from 'vitest';
import { classifyError, friendlyErrorMessage } from '../utils/errors.js';

describe('classifyError', () => {
  it('classifies 401 as offline with session expired message', () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    const result = classifyError(err);
    expect(result).toEqual({
      state: 'offline',
      detail: 'Session expired. Re-run chinmeister init.',
      fatal: true,
    });
  });

  it('classifies 403 as offline with access denied', () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    const result = classifyError(err);
    expect(result.state).toBe('offline');
    expect(result.detail).toContain('Access denied');
  });

  it('classifies 404 as offline with stale file message', () => {
    const err = Object.assign(new Error('Not Found'), { status: 404 });
    const result = classifyError(err);
    expect(result.state).toBe('offline');
    expect(result.detail).toContain('Team not found');
  });

  it('classifies 409 as error with conflict message', () => {
    const err = Object.assign(new Error('Conflict'), { status: 409 });
    const result = classifyError(err);
    expect(result.state).toBe('error');
    expect(result.detail).toContain('Conflict');
  });

  it('classifies 429 as reconnecting with rate limit message', () => {
    const err = Object.assign(new Error('Too Many Requests'), { status: 429 });
    const result = classifyError(err);
    expect(result.state).toBe('reconnecting');
    expect(result.detail).toContain('Rate limited');
  });

  it('classifies 500+ as reconnecting with server error', () => {
    for (const status of [500, 502, 503]) {
      const err = Object.assign(new Error('Server Error'), { status });
      const result = classifyError(err);
      expect(result.state).toBe('reconnecting');
      expect(result.detail).toContain('Server error');
    }
  });

  it('classifies 408 as reconnecting with timeout message', () => {
    const err = Object.assign(new Error('Request Timeout'), { status: 408 });
    const result = classifyError(err);
    expect(result.state).toBe('reconnecting');
    expect(result.detail).toContain('timed out');
  });

  it('classifies "timed out" in message as reconnecting', () => {
    const err = new Error('Request timed out');
    const result = classifyError(err);
    expect(result.state).toBe('reconnecting');
    expect(result.detail).toContain('timed out');
  });

  it('classifies ECONNREFUSED as offline', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8787');
    const result = classifyError(err);
    expect(result.state).toBe('offline');
    expect(result.detail).toContain('Cannot reach server');
  });

  it('classifies ECONNRESET as offline', () => {
    const err = new Error('read ECONNRESET');
    const result = classifyError(err);
    expect(result.state).toBe('offline');
  });

  it('classifies ENOTFOUND as offline', () => {
    const err = new Error('getaddrinfo ENOTFOUND example.com');
    const result = classifyError(err);
    expect(result.state).toBe('offline');
  });

  it('classifies EAI_AGAIN as offline', () => {
    const err = new Error('getaddrinfo EAI_AGAIN example.com');
    const result = classifyError(err);
    expect(result.state).toBe('offline');
  });

  it('falls back to reconnecting with message for unknown errors', () => {
    const err = new Error('Something unexpected');
    const result = classifyError(err);
    expect(result.state).toBe('reconnecting');
    expect(result.detail).toBe('Something unexpected');
  });

  it('uses fallback detail when error has no message', () => {
    const err = new Error('');
    const result = classifyError(err);
    expect(result.state).toBe('reconnecting');
    expect(result.detail).toBe('Connection issue. Retrying...');
  });
});

describe('friendlyErrorMessage', () => {
  it('returns invalid input message for 400', () => {
    const err = Object.assign(new Error('Bad Request'), { status: 400 });
    expect(friendlyErrorMessage(err)).toBe('Invalid input. Check the format and try again.');
  });

  it('returns conflict message for 409', () => {
    const err = Object.assign(new Error('Conflict'), { status: 409 });
    expect(friendlyErrorMessage(err)).toContain('already exists');
  });

  it('delegates to classifyError for 500 errors', () => {
    const err = Object.assign(new Error('Internal Server Error'), { status: 500 });
    expect(friendlyErrorMessage(err)).toContain('Server error');
  });

  it('returns the classified detail for network errors', () => {
    const err = new Error('connect ECONNREFUSED');
    expect(friendlyErrorMessage(err)).toContain('Cannot reach server');
  });

  it('uses fallback message when no detail available', () => {
    const err = new Error('');
    expect(friendlyErrorMessage(err, 'Custom fallback')).toBe('Connection issue. Retrying...');
  });

  it('uses custom fallback when nothing matches', () => {
    // Force a path where classifyError returns a detail
    const err = new Error('random error');
    const result = friendlyErrorMessage(err);
    expect(result).toBe('random error');
  });
});
