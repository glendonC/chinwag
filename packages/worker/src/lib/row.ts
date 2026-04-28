// Type-safe reader for SqlStorage rows.
//
// Replaces the repeated `(row.x as string) || ''` peel-by-field pattern
// across DO query functions with one focused helper. Each method takes a
// column name and returns the typed value. Missing columns and wrong
// types fall back to a configurable default (or null for nullable
// methods). JSON columns parse through the shared `safeParse` so a bad
// row logs structured context instead of throwing.
//
// Why hand-rolled, not zod. Durable Object SQLite is trusted internal
// storage - every value lands there through a column-typed INSERT we
// own. Runtime validation here would pay zod's cost (constructor
// overhead, parser allocation per row) for zero security gain. The risk
// the helper guards against is shape drift between SQL and TS, not
// hostile input. A focused mapper catches that drift cheaper than a
// full parser.
//
// Usage:
//
//   import { row, rows } from '../../lib/row.js';
//
//   const r = row(rawRow);
//   return {
//     id: r.string('id'),
//     edit_count: r.number('edit_count'),
//     outcome: r.nullableString('outcome'),
//     tags: r.json<string[]>('tags', { default: [] }),
//   };
//
//   // Or for a SqlStorageCursor result:
//   return rows(sql.exec(...).toArray(), (r) => ({
//     id: r.string('id'),
//     ...
//   }));

import { safeParse } from './safe-parse.js';
import { createLogger } from './logger.js';

const log = createLogger('row');

export interface RowReader {
  /**
   * Read a string column. Returns the empty string when the column is
   * missing or non-string. Pass `{ default: '...' }` to override.
   */
  string(col: string, opts?: { default?: string }): string;

  /**
   * Read a numeric column. Returns 0 when the column is missing or
   * non-numeric. Pass `{ default: n }` to override.
   */
  number(col: string, opts?: { default?: number }): number;

  /**
   * Read a boolean column. SQLite stores booleans as 0/1 integers, but
   * older rows may carry strings. Truthy values: `1`, `'1'`, `true`,
   * `'true'`. Anything else is `false`.
   */
  bool(col: string): boolean;

  /** Read a string column that may be NULL. Returns `null` when missing or non-string. */
  nullableString(col: string): string | null;

  /** Read a numeric column that may be NULL. Returns `null` when missing or non-numeric. */
  nullableNumber(col: string): number | null;

  /**
   * Read a string column that holds JSON. Parses through `safeParse` -
   * a bad row logs context (column name + row id when supplied) and
   * returns the supplied default. Pass `context` to attach extra info
   * to the warning message; useful when the same parse failure could
   * come from multiple call sites.
   */
  json<T>(col: string, opts: { default: T; context?: string }): T;

  /**
   * Escape hatch: return the raw column value as `unknown` so the
   * caller can do their own coercion when the helpers don't fit.
   */
  raw(col: string): unknown;

  /** True when the column exists on the row, regardless of value. */
  has(col: string): boolean;
}

/**
 * Wrap a raw SQL row (or any `Record<string, unknown>`-shaped object) in
 * a typed reader. Accepts `unknown` so callers can pass `cursor.one()` or
 * `arr[0]` directly without first casting to `Record<string, unknown>`.
 */
export function row(input: unknown): RowReader {
  const obj = (input ?? {}) as Record<string, unknown>;
  return {
    string(col, opts = {}) {
      const v = obj[col];
      return typeof v === 'string' ? v : (opts.default ?? '');
    },
    number(col, opts = {}) {
      const v = obj[col];
      return typeof v === 'number' ? v : (opts.default ?? 0);
    },
    bool(col) {
      const v = obj[col];
      return v === 1 || v === '1' || v === true || v === 'true';
    },
    nullableString(col) {
      const v = obj[col];
      return typeof v === 'string' ? v : null;
    },
    nullableNumber(col) {
      const v = obj[col];
      return typeof v === 'number' ? v : null;
    },
    json<T>(col: string, opts: { default: T; context?: string }): T {
      const v = obj[col];
      if (typeof v !== 'string') return opts.default;
      return safeParse(v, opts.context ?? `row.json(${col})`, opts.default, log);
    },
    raw(col) {
      return obj[col];
    },
    has(col) {
      return col in obj;
    },
  };
}

/**
 * Apply `row()` to each item in `input` and run `map`. Common shorthand
 * for the pattern:
 *
 *   sql.exec(...).toArray().map((raw) => map(row(raw)))
 */
export function rows<T>(input: readonly unknown[], map: (r: RowReader) => T): T[] {
  return input.map((raw) => map(row(raw)));
}
