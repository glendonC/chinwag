import { describe, it, expect } from 'vitest';
import { hasError, mayHaveError } from '../utils/type-guards.js';

describe('hasError', () => {
  it('returns true for object with string error property', () => {
    expect(hasError({ error: 'something went wrong' })).toBe(true);
  });

  it('returns true for object with empty string error', () => {
    expect(hasError({ error: '' })).toBe(true);
  });

  it('returns true when object has other properties alongside error', () => {
    expect(hasError({ error: 'fail', data: 123, ok: false })).toBe(true);
  });

  it('returns false for null', () => {
    expect(hasError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasError(undefined)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(hasError('error')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(hasError(42)).toBe(false);
  });

  it('returns false for a boolean', () => {
    expect(hasError(true)).toBe(false);
  });

  it('returns false for an empty object', () => {
    expect(hasError({})).toBe(false);
  });

  it('returns false when error property is a number', () => {
    expect(hasError({ error: 404 })).toBe(false);
  });

  it('returns false when error property is null', () => {
    expect(hasError({ error: null })).toBe(false);
  });

  it('returns false when error property is undefined', () => {
    expect(hasError({ error: undefined })).toBe(false);
  });

  it('returns false when error property is a boolean', () => {
    expect(hasError({ error: true })).toBe(false);
  });

  it('returns false when error property is an object', () => {
    expect(hasError({ error: { message: 'fail' } })).toBe(false);
  });

  it('returns false for an array', () => {
    expect(hasError([1, 2, 3])).toBe(false);
  });

  it('returns false for an array with error-like element', () => {
    expect(hasError(['error'])).toBe(false);
  });
});

describe('mayHaveError', () => {
  it('returns true for object without error property', () => {
    expect(mayHaveError({ ok: true, data: [] })).toBe(true);
  });

  it('returns true for empty object', () => {
    expect(mayHaveError({})).toBe(true);
  });

  it('returns true for object with string error property', () => {
    expect(mayHaveError({ error: 'something broke' })).toBe(true);
  });

  it('returns true for object with empty string error', () => {
    expect(mayHaveError({ error: '' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(mayHaveError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(mayHaveError(undefined)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(mayHaveError('hello')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(mayHaveError(123)).toBe(false);
  });

  it('returns false for a boolean', () => {
    expect(mayHaveError(false)).toBe(false);
  });

  it('returns false when error property is a number', () => {
    expect(mayHaveError({ error: 404 })).toBe(false);
  });

  it('returns false when error property is null', () => {
    expect(mayHaveError({ error: null })).toBe(false);
  });

  it('returns false when error property is a boolean', () => {
    expect(mayHaveError({ error: true })).toBe(false);
  });

  it('returns false when error property is an object', () => {
    expect(mayHaveError({ error: { msg: 'fail' } })).toBe(false);
  });

  it('returns false when error property is undefined (has "error" in key set)', () => {
    // Object.create trick to explicitly set error as own property with value undefined
    const obj = { error: undefined };
    // 'error' in obj is true, typeof undefined !== 'string', so returns false
    expect(mayHaveError(obj)).toBe(false);
  });
});
