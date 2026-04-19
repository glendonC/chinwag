import { describe, it, expect } from 'vitest';
import {
  BUDGET_DEFAULTS,
  parseBudgetConfig,
  resolveBudgets,
  truncateMemoryText,
} from '../budget-config.ts';
import { MEMORY_SEARCH_MAX_LIMIT } from '../constants.ts';

describe('parseBudgetConfig', () => {
  it('returns null for non-objects', () => {
    expect(parseBudgetConfig(null)).toBeNull();
    expect(parseBudgetConfig(undefined)).toBeNull();
    expect(parseBudgetConfig(42)).toBeNull();
    expect(parseBudgetConfig('budgets')).toBeNull();
    expect(parseBudgetConfig([])).toBeNull();
  });

  it('returns an empty object for an empty input', () => {
    expect(parseBudgetConfig({})).toEqual({});
  });

  it('extracts valid fields', () => {
    expect(
      parseBudgetConfig({
        memoryResultCap: 5,
        memoryContentTruncation: 200,
        coordinationBroadcast: 'silent',
      }),
    ).toEqual({
      memoryResultCap: 5,
      memoryContentTruncation: 200,
      coordinationBroadcast: 'silent',
    });
  });

  it('drops invalid field values silently', () => {
    expect(
      parseBudgetConfig({
        memoryResultCap: 'ten',
        memoryContentTruncation: -1,
        coordinationBroadcast: 'whisper',
        unknownField: 'ignored',
      }),
    ).toEqual({});
  });

  it('floors floating point numbers', () => {
    expect(parseBudgetConfig({ memoryResultCap: 7.9, memoryContentTruncation: 250.4 })).toEqual({
      memoryResultCap: 7,
      memoryContentTruncation: 250,
    });
  });

  it('clamps memoryResultCap at the hard maximum', () => {
    expect(parseBudgetConfig({ memoryResultCap: 10_000 })).toEqual({
      memoryResultCap: MEMORY_SEARCH_MAX_LIMIT,
    });
  });

  it('accepts zero for truncation (unlimited)', () => {
    expect(parseBudgetConfig({ memoryContentTruncation: 0 })).toEqual({
      memoryContentTruncation: 0,
    });
  });
});

describe('resolveBudgets', () => {
  it('returns defaults when no layers are provided', () => {
    expect(resolveBudgets({})).toEqual(BUDGET_DEFAULTS);
  });

  it('team overrides defaults', () => {
    const result = resolveBudgets({ team: { memoryResultCap: 8 } });
    expect(result.memoryResultCap).toBe(8);
    expect(result.memoryContentTruncation).toBe(BUDGET_DEFAULTS.memoryContentTruncation);
  });

  it('user overrides team', () => {
    const result = resolveBudgets({
      team: { memoryResultCap: 8, memoryContentTruncation: 100 },
      user: { memoryResultCap: 3 },
    });
    expect(result.memoryResultCap).toBe(3);
    expect(result.memoryContentTruncation).toBe(100);
  });

  it('runtime overrides user', () => {
    const result = resolveBudgets({
      team: { coordinationBroadcast: 'full' },
      user: { coordinationBroadcast: 'silent' },
      runtime: { coordinationBroadcast: 'full' },
    });
    expect(result.coordinationBroadcast).toBe('full');
  });

  it('null layers are treated as empty', () => {
    expect(resolveBudgets({ team: null, user: null, runtime: null })).toEqual(BUDGET_DEFAULTS);
  });

  it('does not mutate defaults', () => {
    const before = { ...BUDGET_DEFAULTS };
    resolveBudgets({ runtime: { memoryResultCap: 1 } });
    expect({ ...BUDGET_DEFAULTS }).toEqual(before);
  });
});

describe('truncateMemoryText', () => {
  it('returns text unchanged when truncation is 0 (unlimited)', () => {
    const long = 'x'.repeat(10_000);
    expect(truncateMemoryText(long, 0)).toBe(long);
  });

  it('returns text unchanged when it already fits', () => {
    expect(truncateMemoryText('hello', 100)).toBe('hello');
  });

  it('slices and appends ellipsis when over budget', () => {
    expect(truncateMemoryText('abcdefghij', 5)).toBe('abcde\u2026');
  });

  it('handles exact-length input without truncation', () => {
    expect(truncateMemoryText('abcde', 5)).toBe('abcde');
  });
});
