import { describe, it, expect } from 'vitest';
import { normalizePath, toSQLDateTime, safeParseJSON } from '../lib/text-utils.js';

// --- normalizePath ---

describe('normalizePath', () => {
  it('strips leading ./', () => {
    expect(normalizePath('./src/a.js')).toBe('src/a.js');
  });

  it('collapses double slashes', () => {
    expect(normalizePath('src//a.js')).toBe('src/a.js');
  });

  it('collapses triple slashes', () => {
    expect(normalizePath('src///a.js')).toBe('src/a.js');
  });

  it('strips trailing slash', () => {
    expect(normalizePath('src/a.js/')).toBe('src/a.js');
  });

  it('handles combination of all normalizations', () => {
    expect(normalizePath('./src//lib///utils.js/')).toBe('src/lib/utils.js');
  });

  it('leaves already-clean paths unchanged', () => {
    expect(normalizePath('src/index.js')).toBe('src/index.js');
  });

  it('handles simple filename', () => {
    expect(normalizePath('file.txt')).toBe('file.txt');
  });

  it('handles deeply nested paths', () => {
    expect(normalizePath('./a/b/c/d/e.js')).toBe('a/b/c/d/e.js');
  });

  it('strips .. segments to prevent path traversal', () => {
    expect(normalizePath('../src/a.js')).toBe('src/a.js');
    expect(normalizePath('../../etc/passwd')).toBe('etc/passwd');
    expect(normalizePath('src/../lib/a.js')).toBe('src/lib/a.js');
  });

  it('returns empty string for empty input', () => {
    expect(normalizePath('')).toBe('');
  });

  it('handles just a slash', () => {
    expect(normalizePath('/')).toBe('');
  });

  it('handles just ..', () => {
    expect(normalizePath('..')).toBe('');
  });

  it('handles multiple .. segments', () => {
    expect(normalizePath('../../..')).toBe('');
    expect(normalizePath('../../../etc/passwd')).toBe('etc/passwd');
  });

  it('handles paths with only slashes', () => {
    expect(normalizePath('///')).toBe('');
  });

  it('normalizes ./ and ../ combined', () => {
    expect(normalizePath('./../src/file.js')).toBe('src/file.js');
  });

  it('strips leading slash from absolute-style paths', () => {
    expect(normalizePath('/src/a.js')).toBe('src/a.js');
  });

  it('handles whitespace in filenames (does not trim)', () => {
    // normalizePath does not trim whitespace - that is a separate concern
    expect(normalizePath(' src/a.js ')).toBe(' src/a.js ');
  });
});

// --- toSQLDateTime ---

describe('toSQLDateTime', () => {
  it('formats a specific date correctly', () => {
    expect(toSQLDateTime(new Date('2025-06-15T10:30:45.123Z'))).toBe('2025-06-15 10:30:45');
  });

  it('returns current time when no argument provided', () => {
    const result = toSQLDateTime();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('strips milliseconds', () => {
    const result = toSQLDateTime(new Date('2025-01-01T00:00:00.999Z'));
    expect(result).toBe('2025-01-01 00:00:00');
    expect(result).not.toContain('.');
  });

  it('handles epoch zero', () => {
    expect(toSQLDateTime(new Date(0))).toBe('1970-01-01 00:00:00');
  });

  it('handles end of day', () => {
    expect(toSQLDateTime(new Date('2025-12-31T23:59:59.000Z'))).toBe('2025-12-31 23:59:59');
  });
});

// --- safeParseJSON ---

describe('safeParseJSON', () => {
  it('parses valid JSON object', () => {
    expect(safeParseJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses valid JSON array', () => {
    expect(safeParseJSON('["a","b"]')).toEqual(['a', 'b']);
  });

  it('parses valid JSON string', () => {
    expect(safeParseJSON('"hello"')).toBe('hello');
  });

  it('parses valid JSON number', () => {
    expect(safeParseJSON('42')).toBe(42);
  });

  it('parses JSON null', () => {
    expect(safeParseJSON('null')).toBeNull();
  });

  it('parses JSON boolean', () => {
    expect(safeParseJSON('true')).toBe(true);
    expect(safeParseJSON('false')).toBe(false);
  });

  it('returns default (empty array) for invalid JSON', () => {
    const result = safeParseJSON('{bad json');
    expect(result).toEqual([]);
  });

  it('returns custom fallback for invalid JSON', () => {
    expect(safeParseJSON('{bad', {})).toEqual({});
    expect(safeParseJSON('{bad', 'fallback')).toBe('fallback');
    expect(safeParseJSON('{bad', null)).toBeNull();
  });

  it('returns fallback for empty string', () => {
    expect(safeParseJSON('')).toEqual([]);
    expect(safeParseJSON('', 'default')).toBe('default');
  });

  it('returns fallback for undefined-like falsy raw value', () => {
    // The function checks `if (!raw)` so empty string returns fallback
    expect(safeParseJSON('', [])).toEqual([]);
  });

  it('parses nested JSON structures', () => {
    const json = '{"users":[{"name":"alice"},{"name":"bob"}]}';
    const result = safeParseJSON(json);
    expect(result).toEqual({ users: [{ name: 'alice' }, { name: 'bob' }] });
  });

  it('handles deeply nested invalid JSON gracefully', () => {
    expect(safeParseJSON('{{{', 'nope')).toBe('nope');
  });
});
