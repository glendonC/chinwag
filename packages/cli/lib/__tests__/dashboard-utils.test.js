import { describe, expect, it, vi } from 'vitest';
import { homedir } from 'os';
import {
  truncateText,
  getVisibleWindow,
  formatProjectPath,
  MIN_WIDTH,
  SPINNER,
  DASHBOARD_URL,
} from '../dashboard/utils.js';

describe('truncateText', () => {
  it('returns null/undefined unchanged', () => {
    expect(truncateText(null, 10)).toBeNull();
    expect(truncateText(undefined, 10)).toBeUndefined();
  });

  it('returns empty string unchanged', () => {
    expect(truncateText('', 10)).toBe('');
  });

  it('returns short text unchanged', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('returns text exactly at max unchanged', () => {
    expect(truncateText('hello', 5)).toBe('hello');
  });

  it('truncates long text with ellipsis', () => {
    expect(truncateText('hello world', 5)).toBe('hell\u2026');
  });

  it('truncates at max=1 to just ellipsis', () => {
    expect(truncateText('ab', 1)).toBe('\u2026');
  });
});

describe('getVisibleWindow', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

  it('returns all items when list fits within maxItems', () => {
    const result = getVisibleWindow(['a', 'b', 'c'], 0, 5);
    expect(result).toEqual({ items: ['a', 'b', 'c'], start: 0 });
  });

  it('returns empty array for null/undefined items', () => {
    expect(getVisibleWindow(null, 0, 5)).toEqual({ items: [], start: 0 });
    expect(getVisibleWindow(undefined, 0, 5)).toEqual({ items: [], start: 0 });
  });

  it('returns empty array for empty items', () => {
    expect(getVisibleWindow([], 0, 5)).toEqual({ items: [], start: 0 });
  });

  it('shows first window when selectedIdx is null', () => {
    const result = getVisibleWindow(items, null, 3);
    expect(result).toEqual({ items: ['a', 'b', 'c'], start: 0 });
  });

  it('shows first window when selectedIdx is negative', () => {
    const result = getVisibleWindow(items, -1, 3);
    expect(result).toEqual({ items: ['a', 'b', 'c'], start: 0 });
  });

  it('centers window around selected index', () => {
    const result = getVisibleWindow(items, 5, 3);
    expect(result.items).toHaveLength(3);
    expect(result.items).toContain('f');
  });

  it('clamps window at the end of the list', () => {
    const result = getVisibleWindow(items, 9, 3);
    expect(result).toEqual({ items: ['h', 'i', 'j'], start: 7 });
  });

  it('clamps window at the start of the list', () => {
    const result = getVisibleWindow(items, 0, 3);
    expect(result).toEqual({ items: ['a', 'b', 'c'], start: 0 });
  });

  it('handles selectedIdx at first element', () => {
    const result = getVisibleWindow(items, 0, 4);
    expect(result).toEqual({ items: ['a', 'b', 'c', 'd'], start: 0 });
  });

  it('handles maxItems equal to list length', () => {
    const result = getVisibleWindow(items, 5, 10);
    expect(result).toEqual({ items: items, start: 0 });
  });

  it('handles maxItems larger than list length', () => {
    const result = getVisibleWindow(items, 5, 20);
    expect(result).toEqual({ items: items, start: 0 });
  });

  it('handles single-item list', () => {
    const result = getVisibleWindow(['only'], 0, 5);
    expect(result).toEqual({ items: ['only'], start: 0 });
  });
});

describe('formatProjectPath', () => {
  it('replaces home directory prefix with ~', () => {
    const home = homedir();
    expect(formatProjectPath(`${home}/projects/chinwag`)).toBe('~/projects/chinwag');
  });

  it('returns path unchanged when not under home', () => {
    expect(formatProjectPath('/tmp/project')).toBe('/tmp/project');
  });

  it('returns null/undefined unchanged', () => {
    expect(formatProjectPath(null)).toBeNull();
    expect(formatProjectPath(undefined)).toBeUndefined();
  });

  it('handles home directory itself', () => {
    const home = homedir();
    expect(formatProjectPath(home)).toBe('~');
  });
});

describe('constants', () => {
  it('exports MIN_WIDTH as a reasonable minimum', () => {
    expect(MIN_WIDTH).toBeGreaterThanOrEqual(30);
    expect(MIN_WIDTH).toBeLessThan(100);
  });

  it('exports SPINNER with multiple frames', () => {
    expect(SPINNER).toBeInstanceOf(Array);
    expect(SPINNER.length).toBeGreaterThan(1);
  });

  it('exports DASHBOARD_URL as a valid URL', () => {
    expect(DASHBOARD_URL).toMatch(/^https?:\/\//);
  });
});
