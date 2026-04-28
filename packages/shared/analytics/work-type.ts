// Canonical work-type classification. Single source of truth for the
// JS classifier and the category list consumed by UI palettes, legend
// ordering, demo data generation, and tests.
//
// The SQL sibling `WORK_TYPE_CASE` lives in the worker
// (packages/worker/src/dos/team/analytics/outcomes.ts) because it has to
// compose into SQLite queries at the DO storage layer. The two must stay
// semantically equivalent - if you change one, change the other. The
// test suite asserts they agree on a fixed set of canonical paths.

/**
 * The seven canonical work-type categories. Ordering here is the
 * UI-legend ordering (broadest first, fallback last). Both the classifier
 * below and `workTypeColor` in the web package rely on this list being
 * the authoritative set of valid keys.
 */
export const WORK_TYPES = [
  'frontend',
  'backend',
  'test',
  'styling',
  'docs',
  'config',
  'other',
] as const;

export type WorkType = (typeof WORK_TYPES)[number];

/**
 * Classify a file path into a canonical work type. Mirror of the SQL
 * `WORK_TYPE_CASE` expression in the worker - keep both in sync.
 *
 * Rule order matters: the first matching rule wins, so the more specific
 * patterns (tests, docs, styling) go before the broader ones (frontend,
 * backend). Everything unclassified collapses to 'other'.
 */
export function classifyWorkType(filePath: string): WorkType {
  const p = filePath.toLowerCase();

  if (p.includes('.test.') || p.includes('.spec.') || p.includes('__tests__')) return 'test';
  if (p.endsWith('.md') || p.includes('/docs/')) return 'docs';
  if (p.endsWith('.css') || p.endsWith('.scss') || p.includes('.module.css')) return 'styling';
  if (
    p.endsWith('.tsx') ||
    p.endsWith('.jsx') ||
    p.includes('/components/') ||
    p.includes('/views/') ||
    p.includes('/hooks/') ||
    p.includes('/pages/')
  ) {
    return 'frontend';
  }
  if (
    p.includes('/routes/') ||
    p.includes('/dos/') ||
    p.includes('/api/') ||
    p.includes('/server/') ||
    p.includes('/workers/')
  ) {
    return 'backend';
  }
  if (
    p.includes('package.json') ||
    p.includes('tsconfig') ||
    p.includes('wrangler') ||
    p.includes('.config.') ||
    p.includes('.eslint') ||
    p.includes('.prettier')
  ) {
    return 'config';
  }
  return 'other';
}

/** Runtime type guard - useful for narrowing server payloads where a
 *  work_type string could be anything. */
export function isWorkType(value: unknown): value is WorkType {
  return typeof value === 'string' && (WORK_TYPES as readonly string[]).includes(value);
}
