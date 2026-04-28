import { describe, it, expect, vi } from 'vitest';
import { safeParse } from '../lib/safe-parse.js';

describe('safeParse', () => {
  it('parses valid JSON and returns the value', () => {
    expect(safeParse('{"a":1}', 'test')).toEqual({ a: 1 });
  });

  it('parses a JSON array', () => {
    expect(safeParse('["a","b"]', 'test')).toEqual(['a', 'b']);
  });

  it('parses a JSON string', () => {
    expect(safeParse('"hello"', 'test')).toBe('hello');
  });

  it('parses a JSON number', () => {
    expect(safeParse('42', 'test')).toBe(42);
  });

  it('parses JSON null', () => {
    expect(safeParse('null', 'test', 'fallback')).toBeNull();
  });

  it('parses JSON boolean', () => {
    expect(safeParse('true', 'test')).toBe(true);
    expect(safeParse('false', 'test')).toBe(false);
  });

  it('returns defaultValue (null) for invalid JSON', () => {
    expect(safeParse('{bad json', 'test')).toBeNull();
  });

  it('returns custom defaultValue for invalid JSON', () => {
    expect(safeParse('{bad', 'test', [])).toEqual([]);
    expect(safeParse('{bad', 'test', {})).toEqual({});
    expect(safeParse('{bad', 'test', 'fallback')).toBe('fallback');
  });

  it('logs a warning with context on parse failure', () => {
    const mockLog = { warn: vi.fn() };
    safeParse('{invalid}', 'member.files', [], mockLog);

    expect(mockLog.warn).toHaveBeenCalledTimes(1);
    const [message, extra] = mockLog.warn.mock.calls[0];
    expect(message).toContain('[safeParse]');
    expect(message).toContain('member.files');
    expect(extra).toHaveProperty('preview');
    expect(extra.preview).toBe('{invalid}');
  });

  it('does not log on successful parse', () => {
    const mockLog = { warn: vi.fn() };
    safeParse('{"valid":true}', 'test', null, mockLog);

    expect(mockLog.warn).not.toHaveBeenCalled();
  });

  it('truncates preview to 100 characters', () => {
    const mockLog = { warn: vi.fn() };
    const longInvalid = 'x'.repeat(200);
    safeParse(longInvalid, 'test', null, mockLog);

    const [, extra] = mockLog.warn.mock.calls[0];
    expect(extra.preview).toHaveLength(100);
  });

  it('uses console as default logger', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    safeParse('{bad}', 'default-logger-test', null);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('[safeParse]');
    expect(spy.mock.calls[0][0]).toContain('default-logger-test');
    spy.mockRestore();
  });

  it('handles undefined input gracefully', () => {
    const mockLog = { warn: vi.fn() };
    expect(safeParse(undefined, 'test', 'default', mockLog)).toBe('default');
    expect(mockLog.warn).toHaveBeenCalledTimes(1);
  });

  it('handles empty string input', () => {
    const mockLog = { warn: vi.fn() };
    expect(safeParse('', 'test', [], mockLog)).toEqual([]);
    expect(mockLog.warn).toHaveBeenCalledTimes(1);
  });

  it('handles numeric input (non-string)', () => {
    // JSON.parse(123) returns 123 - this is valid
    expect(safeParse(123, 'test')).toBe(123);
  });

  it('includes error message in log output', () => {
    const mockLog = { warn: vi.fn() };
    safeParse('not json at all', 'context-desc', null, mockLog);

    const [message] = mockLog.warn.mock.calls[0];
    // Should contain the SyntaxError message from JSON.parse
    expect(message).toContain('[safeParse]');
    expect(message).toContain('context-desc');
    // The error message varies by engine, but it should be present
    expect(message.length).toBeGreaterThan('[safeParse] context-desc: '.length);
  });

  it('preview shows stringified non-string values', () => {
    const mockLog = { warn: vi.fn() };
    // An object will cause JSON.parse to call toString() → "[object Object]"
    // which is not valid JSON
    safeParse({ broken: true }, 'test', null, mockLog);

    const [, extra] = mockLog.warn.mock.calls[0];
    expect(extra.preview).toBe('[object Object]');
  });
});
