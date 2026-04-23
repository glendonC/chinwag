import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { truncateText, getVisibleWindow, formatProjectPath } from '../dashboard/utils.js';
import { stripAnsi } from '../utils/ansi.js';
import { shellQuote, escapeAppleScriptString } from '../utils/shell.js';

describe('truncateText', () => {
  it('returns text unchanged if shorter than max', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('truncates with ellipsis when over max', () => {
    expect(truncateText('hello world this is long', 10)).toBe('hello wor\u2026');
  });

  it('returns falsy values as-is', () => {
    expect(truncateText(null, 10)).toBeNull();
    expect(truncateText('', 10)).toBe('');
    expect(truncateText(undefined, 10)).toBeUndefined();
  });

  it('handles exact length', () => {
    expect(truncateText('12345', 5)).toBe('12345');
  });
});

describe('getVisibleWindow', () => {
  it('returns all items when fewer than max', () => {
    const items = ['a', 'b', 'c'];
    const result = getVisibleWindow(items, 0, 10);
    expect(result.items).toEqual(['a', 'b', 'c']);
    expect(result.start).toBe(0);
  });

  it('returns empty array for null/empty items', () => {
    expect(getVisibleWindow(null, 0, 5)).toEqual({ items: [], start: 0 });
    expect(getVisibleWindow([], 0, 5)).toEqual({ items: [], start: 0 });
  });

  it('centers the window around selected index', () => {
    const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    const result = getVisibleWindow(items, 10, 5);
    expect(result.items).toHaveLength(5);
    expect(result.start).toBe(8); // 10 - Math.floor(5/2) = 8
    expect(result.items[0]).toBe('item-8');
  });

  it('clamps window to end of list', () => {
    const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const result = getVisibleWindow(items, 9, 5);
    expect(result.start).toBe(5);
    expect(result.items).toEqual(['item-5', 'item-6', 'item-7', 'item-8', 'item-9']);
  });

  it('clamps window to start of list', () => {
    const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const result = getVisibleWindow(items, 0, 5);
    expect(result.start).toBe(0);
    expect(result.items).toEqual(['item-0', 'item-1', 'item-2', 'item-3', 'item-4']);
  });

  it('handles negative selectedIdx', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const result = getVisibleWindow(items, -1, 3);
    expect(result.start).toBe(0);
    expect(result.items).toEqual(['a', 'b', 'c']);
  });

  it('handles null selectedIdx', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const result = getVisibleWindow(items, null, 3);
    expect(result.start).toBe(0);
  });
});

describe('formatProjectPath', () => {
  it('replaces home directory with tilde', () => {
    const home = homedir();
    expect(formatProjectPath(`${home}/projects/chinmeister`)).toBe('~/projects/chinmeister');
  });

  it('returns non-home paths unchanged', () => {
    expect(formatProjectPath('/var/data/project')).toBe('/var/data/project');
  });

  it('handles null/undefined', () => {
    expect(formatProjectPath(null)).toBeNull();
    expect(formatProjectPath(undefined)).toBeUndefined();
  });
});

describe('stripAnsi', () => {
  it('removes ANSI color codes', () => {
    expect(stripAnsi('\x1b[31mred text\x1b[0m')).toBe('red text');
  });

  it('removes CSI sequences', () => {
    expect(stripAnsi('\x1b[2Kline cleared')).toBe('line cleared');
  });

  it('removes OSC sequences (title, hyperlinks)', () => {
    expect(stripAnsi('\x1b]0;My Title\x07text')).toBe('text');
    expect(stripAnsi('\x1b]8;;https://example.com\x07link\x1b]8;;\x07')).toBe('link');
  });

  it('removes carriage returns', () => {
    expect(stripAnsi('progress\r100%')).toBe('progress100%');
  });

  it('removes control characters but keeps newlines and tabs', () => {
    expect(stripAnsi('hello\x01world\nnewline\ttab')).toBe('helloworld\nnewline\ttab');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(stripAnsi('no special chars here')).toBe('no special chars here');
  });
});

describe('shellQuote', () => {
  it('quotes simple strings', () => {
    expect(shellQuote('hello')).toBe('"hello"');
  });

  it('escapes embedded quotes', () => {
    expect(shellQuote('say "hello"')).toBe('"say \\"hello\\""');
  });

  it('handles empty string', () => {
    expect(shellQuote('')).toBe('""');
  });

  it('converts non-strings to strings', () => {
    expect(shellQuote(42)).toBe('"42"');
  });
});

describe('escapeAppleScriptString', () => {
  it('escapes backslashes', () => {
    expect(escapeAppleScriptString('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('escapes double quotes', () => {
    expect(escapeAppleScriptString('say "hello"')).toBe('say \\"hello\\"');
  });

  it('handles empty string', () => {
    expect(escapeAppleScriptString('')).toBe('');
  });
});
