import { describe, it, expect, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

import {
  buildScopeFilter,
  buildScopeWhere,
  withScope,
  withScopeWhere,
  isScoped,
} from '../dos/team/analytics/scope.js';

describe('buildScopeFilter', () => {
  it('returns an empty fragment for an empty scope', () => {
    const f = buildScopeFilter({});
    expect(f.sql).toBe('');
    expect(f.params).toEqual([]);
  });

  it('emits an AND fragment with the bound handle', () => {
    const f = buildScopeFilter({ handle: 'alice' });
    expect(f.sql).toBe(' AND handle = ?');
    expect(f.params).toEqual(['alice']);
  });

  it('honors a custom handle column for joined queries', () => {
    const f = buildScopeFilter({ handle: 'alice' }, { handleColumn: 's.handle' });
    expect(f.sql).toBe(' AND s.handle = ?');
    expect(f.params).toEqual(['alice']);
  });
});

describe('buildScopeWhere', () => {
  it('returns an empty fragment for an empty scope', () => {
    const f = buildScopeWhere({});
    expect(f.sql).toBe('');
    expect(f.params).toEqual([]);
  });

  it('emits a WHERE fragment for a scoped query', () => {
    const f = buildScopeWhere({ handle: 'alice' });
    expect(f.sql).toBe(' WHERE handle = ?');
    expect(f.params).toEqual(['alice']);
  });
});

describe('withScope', () => {
  const baseQuery = `SELECT COUNT(*) AS cnt FROM sessions WHERE ended_at > ?`;
  const baseParams = ['2026-01-01'];

  it('returns the base query untouched when scope is empty', () => {
    const out = withScope(baseQuery, baseParams, {});
    expect(out.sql).toBe(baseQuery);
    expect(out.params).toEqual(['2026-01-01']);
  });

  it('appends the scope fragment and merges params in order', () => {
    const out = withScope(baseQuery, baseParams, { handle: 'alice' });
    expect(out.sql).toBe(`${baseQuery} AND handle = ?`);
    expect(out.params).toEqual(['2026-01-01', 'alice']);
  });

  it('does not mutate the caller params array', () => {
    const params = ['2026-01-01'];
    withScope(baseQuery, params, { handle: 'alice' });
    expect(params).toEqual(['2026-01-01']);
  });

  it('honors a custom handle column', () => {
    const out = withScope(baseQuery, baseParams, { handle: 'alice' }, { handleColumn: 's.handle' });
    expect(out.sql).toBe(`${baseQuery} AND s.handle = ?`);
    expect(out.params).toEqual(['2026-01-01', 'alice']);
  });

  it('accepts a readonly base params array', () => {
    const params: readonly unknown[] = ['x', 1];
    const out = withScope('SELECT 1 WHERE a = ? AND b = ?', params, { handle: 'alice' });
    expect(out.sql).toBe('SELECT 1 WHERE a = ? AND b = ? AND handle = ?');
    expect(out.params).toEqual(['x', 1, 'alice']);
  });
});

describe('withScopeWhere', () => {
  it('returns the base query untouched when scope is empty', () => {
    const out = withScopeWhere('SELECT * FROM memories', [], {});
    expect(out.sql).toBe('SELECT * FROM memories');
    expect(out.params).toEqual([]);
  });

  it('appends a WHERE clause when scope is non-empty', () => {
    const out = withScopeWhere('SELECT * FROM memories', [], { handle: 'alice' });
    expect(out.sql).toBe('SELECT * FROM memories WHERE handle = ?');
    expect(out.params).toEqual(['alice']);
  });
});

describe('isScoped', () => {
  it('returns false for an empty scope', () => {
    expect(isScoped({})).toBe(false);
  });

  it('returns true when handle is set', () => {
    expect(isScoped({ handle: 'alice' })).toBe(true);
  });
});
