import { describe, expect, it } from 'vitest';
import { shellQuote, escapeAppleScriptString } from '../utils/shell.js';

describe('shellQuote', () => {
  it('quotes simple strings', () => {
    expect(shellQuote('hello')).toBe('"hello"');
  });

  it('escapes double quotes', () => {
    expect(shellQuote('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('handles backslashes', () => {
    expect(shellQuote('path\\to\\file')).toBe('"path\\\\to\\\\file"');
  });

  it('handles empty string', () => {
    expect(shellQuote('')).toBe('""');
  });

  it('coerces non-string values', () => {
    expect(shellQuote(123)).toBe('"123"');
    expect(shellQuote(null)).toBe('"null"');
    expect(shellQuote(undefined)).toBe('"undefined"');
  });

  it('handles strings with special characters', () => {
    expect(shellQuote('hello world')).toBe('"hello world"');
    expect(shellQuote('$HOME')).toBe('"$HOME"');
  });
});

describe('escapeAppleScriptString', () => {
  it('escapes backslashes', () => {
    expect(escapeAppleScriptString('path\\file')).toBe('path\\\\file');
  });

  it('escapes double quotes', () => {
    expect(escapeAppleScriptString('say "hi"')).toBe('say \\"hi\\"');
  });

  it('handles strings with both', () => {
    expect(escapeAppleScriptString('a\\b"c')).toBe('a\\\\b\\"c');
  });

  it('leaves clean strings unchanged', () => {
    expect(escapeAppleScriptString('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeAppleScriptString('')).toBe('');
  });

  it('coerces non-string values', () => {
    expect(escapeAppleScriptString(42)).toBe('42');
  });
});
