import { describe, it, expect, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

import { row, rows } from '../lib/row.js';

describe('row reader', () => {
  describe('string', () => {
    it('returns the string value', () => {
      expect(row({ x: 'hello' }).string('x')).toBe('hello');
    });

    it('returns empty string when missing', () => {
      expect(row({}).string('x')).toBe('');
    });

    it('returns empty string when wrong type', () => {
      expect(row({ x: 42 }).string('x')).toBe('');
      expect(row({ x: null }).string('x')).toBe('');
      expect(row({ x: undefined }).string('x')).toBe('');
    });

    it('honors default override', () => {
      expect(row({}).string('x', { default: 'unknown' })).toBe('unknown');
      expect(row({ x: null }).string('x', { default: 'unknown' })).toBe('unknown');
    });

    it('preserves an empty string value over the default', () => {
      expect(row({ x: '' }).string('x', { default: 'fallback' })).toBe('');
    });
  });

  describe('number', () => {
    it('returns the numeric value', () => {
      expect(row({ x: 42 }).number('x')).toBe(42);
    });

    it('returns 0 when missing or non-numeric', () => {
      expect(row({}).number('x')).toBe(0);
      expect(row({ x: '42' }).number('x')).toBe(0);
      expect(row({ x: null }).number('x')).toBe(0);
    });

    it('honors default override', () => {
      expect(row({}).number('x', { default: -1 })).toBe(-1);
    });

    it('preserves a zero value over the default', () => {
      expect(row({ x: 0 }).number('x', { default: 99 })).toBe(0);
    });
  });

  describe('bool', () => {
    it('treats SQLite 0/1 as boolean', () => {
      expect(row({ x: 1 }).bool('x')).toBe(true);
      expect(row({ x: 0 }).bool('x')).toBe(false);
    });

    it('treats string "1"/"true" as truthy', () => {
      expect(row({ x: '1' }).bool('x')).toBe(true);
      expect(row({ x: 'true' }).bool('x')).toBe(true);
    });

    it('treats true literal as truthy', () => {
      expect(row({ x: true }).bool('x')).toBe(true);
    });

    it('returns false for missing or non-truthy', () => {
      expect(row({}).bool('x')).toBe(false);
      expect(row({ x: null }).bool('x')).toBe(false);
      expect(row({ x: 'false' }).bool('x')).toBe(false);
      expect(row({ x: 2 }).bool('x')).toBe(false);
    });
  });

  describe('nullableString', () => {
    it('returns the string value', () => {
      expect(row({ x: 'hi' }).nullableString('x')).toBe('hi');
    });

    it('returns null when missing or non-string', () => {
      expect(row({}).nullableString('x')).toBe(null);
      expect(row({ x: null }).nullableString('x')).toBe(null);
      expect(row({ x: 42 }).nullableString('x')).toBe(null);
    });

    it('preserves an empty string', () => {
      expect(row({ x: '' }).nullableString('x')).toBe('');
    });
  });

  describe('nullableNumber', () => {
    it('returns the numeric value', () => {
      expect(row({ x: 5 }).nullableNumber('x')).toBe(5);
    });

    it('returns null when missing or non-numeric', () => {
      expect(row({}).nullableNumber('x')).toBe(null);
      expect(row({ x: 'no' }).nullableNumber('x')).toBe(null);
      expect(row({ x: null }).nullableNumber('x')).toBe(null);
    });

    it('preserves a zero', () => {
      expect(row({ x: 0 }).nullableNumber('x')).toBe(0);
    });
  });

  describe('json', () => {
    it('parses a JSON string', () => {
      expect(row({ tags: '["a","b"]' }).json<string[]>('tags', { default: [] })).toEqual([
        'a',
        'b',
      ]);
    });

    it('returns the default when the column is missing', () => {
      expect(row({}).json<string[]>('tags', { default: [] })).toEqual([]);
    });

    it('returns the default when the column is non-string', () => {
      expect(row({ tags: 42 }).json<string[]>('tags', { default: [] })).toEqual([]);
      expect(row({ tags: null }).json<string[]>('tags', { default: [] })).toEqual([]);
    });

    it('returns the default when the JSON is invalid (logged via safeParse)', () => {
      expect(row({ tags: 'not-json' }).json<string[]>('tags', { default: ['fallback'] })).toEqual([
        'fallback',
      ]);
    });

    it('parses nested objects', () => {
      const parsed = row({ payload: '{"a":1,"b":[2,3]}' }).json<{ a: number; b: number[] }>(
        'payload',
        { default: { a: 0, b: [] } },
      );
      expect(parsed).toEqual({ a: 1, b: [2, 3] });
    });
  });

  describe('raw / has', () => {
    it('raw returns the underlying value', () => {
      const buf = new ArrayBuffer(4);
      expect(row({ x: buf }).raw('x')).toBe(buf);
    });

    it('has returns true when the column exists, regardless of value', () => {
      expect(row({ x: null }).has('x')).toBe(true);
      expect(row({}).has('x')).toBe(false);
    });
  });

  describe('null / undefined input', () => {
    it('treats null as an empty row', () => {
      const r = row(null);
      expect(r.string('x')).toBe('');
      expect(r.number('x')).toBe(0);
      expect(r.has('x')).toBe(false);
    });

    it('treats undefined as an empty row', () => {
      const r = row(undefined);
      expect(r.nullableString('x')).toBe(null);
    });
  });
});

describe('rows mapper', () => {
  it('applies the mapper to each row', () => {
    const out = rows(
      [
        { id: 'a', n: 1 },
        { id: 'b', n: 2 },
      ],
      (r) => ({
        id: r.string('id'),
        n: r.number('n'),
      }),
    );
    expect(out).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ]);
  });

  it('handles an empty list', () => {
    expect(rows([], (r) => r.string('x'))).toEqual([]);
  });
});
