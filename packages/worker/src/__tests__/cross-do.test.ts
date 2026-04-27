// Unit tests for the cross-DO retry helpers in lib/cross-do.ts.
//
// These tests don't need Durable Objects — they exercise the retry
// behavior against in-memory promises that resolve, reject, or alternate.
// Pure unit coverage of the contract every cross-DO route handler now
// depends on.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withDORetry, tryDORetry } from '../lib/cross-do.js';

describe('withDORetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves on first success without retrying', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    const promise = withDORetry(op, { label: 'test' });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries with exponential backoff and succeeds on the third attempt', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockResolvedValue('ok');
    const promise = withDORetry(op, { label: 'test', initialDelayMs: 10, maxDelayMs: 1000 });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('rethrows after exhausting maxAttempts', async () => {
    // Real timers for the always-rejecting case: with fake timers, the
    // workerd-pool boundary reports the intermediate rejected promises as
    // unhandled even though withDORetry awaits and catches them, because
    // the boundary tracks promise state across the IPC bridge differently
    // than Node's V8 promise hooks. Using real 1 ms backoff is fast enough
    // here (3 attempts ≈ 3 ms) and bypasses the bridge mismatch.
    vi.useRealTimers();
    let calls = 0;
    const op = () => {
      calls += 1;
      return Promise.reject(new Error('persistent'));
    };
    await expect(
      withDORetry(op, { label: 'test', maxAttempts: 3, initialDelayMs: 1 }),
    ).rejects.toThrow('persistent');
    expect(calls).toBe(3);
  });

  it('uses the configured maxAttempts (default is 4)', async () => {
    vi.useRealTimers();
    let calls = 0;
    const op = () => {
      calls += 1;
      return Promise.reject(new Error('boom'));
    };
    await expect(withDORetry(op, { label: 'test', initialDelayMs: 1 })).rejects.toThrow();
    expect(calls).toBe(4);
  });

  it('caps backoff at maxDelayMs', async () => {
    // 6 attempts with initialDelay=10 would compute 10, 20, 40, 80, 160 ms
    // backoffs. Cap at 30 means the last three should all be 30, not 40/80/160.
    const op = vi.fn().mockRejectedValue(new Error('boom'));
    const sleeps: number[] = [];
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms: number,
    ) => {
      sleeps.push(ms);
      fn();
      return 0;
    }) as unknown as typeof setTimeout);

    try {
      await withDORetry(op, {
        label: 'test',
        maxAttempts: 6,
        initialDelayMs: 10,
        maxDelayMs: 30,
      }).catch(() => {});
      // 5 retries between 6 attempts
      expect(sleeps).toEqual([10, 20, 30, 30, 30]);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});

describe('tryDORetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result on success', async () => {
    const op = vi.fn().mockResolvedValue({ ok: true });
    const promise = tryDORetry(op, { label: 'test' });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('returns null on terminal failure instead of throwing', async () => {
    const op = vi.fn().mockRejectedValue(new Error('persistent'));
    const promise = tryDORetry(op, { label: 'test', maxAttempts: 2, initialDelayMs: 1 });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeNull();
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('still retries before giving up', async () => {
    const op = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('recovered');
    const promise = tryDORetry(op, { label: 'test', initialDelayMs: 1 });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('recovered');
    expect(op).toHaveBeenCalledTimes(2);
  });
});
