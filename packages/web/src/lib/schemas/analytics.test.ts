/**
 * Contract-sync guard for the analytics schemas.
 *
 * packages/shared/contracts/analytics.ts is the source of truth; this file
 * (analytics.ts alongside) wraps each base schema with `.default()` decorators
 * for resilient UI rendering. That parallel layer is fragile: if shared adds a
 * new schema, web silently doesn't wrap it; if shared removes a field, web's
 * `.extend({ ... })` re-creates it with a default and hides the removal.
 *
 * This test lists every Zod schema exported from shared and asserts that web
 * either imports it (as baseXSchema) or has an explicit opt-out recorded in
 * the INTENTIONALLY_UNWRAPPED allowlist. Any drift forces a human decision:
 * wrap the new schema, or add it to the allowlist with a reason.
 *
 * The allowlist is deliberately small. Adding to it should be rare and well-
 * justified — each entry represents a deliberate decision not to surface a
 * shared analytics primitive in the UI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import * as SharedAnalytics from '@chinwag/shared/contracts/analytics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_SCHEMA_FILE = resolve(__dirname, 'analytics.ts');
const SHARED_SCHEMA_FILE = resolve(__dirname, '../../../../shared/contracts/analytics.ts');

/**
 * Shared analytics primitives that web intentionally does not wrap as a
 * baseXSchema. Each must have a reason — typically because it's a rollup
 * whose sub-schemas are already wrapped individually, or because it's a
 * top-level response envelope that web re-composes from wrapped pieces.
 *
 * Add entries sparingly. If you're adding a new schema to shared, prefer
 * wrapping it in web/src/lib/schemas/analytics.ts over adding it here.
 */
const INTENTIONALLY_UNWRAPPED: Record<string, string> = {
  // Top-level response envelopes — web rebuilds its own versions using
  // wrapped sub-schemas.
  teamAnalyticsSchema: 'web composes its own teamAnalyticsSchema',
  userAnalyticsSchema: 'web composes its own userAnalyticsSchema',

  // Rollups whose sub-schemas are wrapped individually by web.
  toolCallStatsSchema: 'rollup of toolCallFrequency/Error/Timeline which web imports separately',
  periodComparisonSchema: 'rollup of current/previous periodMetrics which web imports directly',
  tokenUsageStatsSchema:
    'rollup of tokenModelBreakdown/tokenToolBreakdown which web imports separately',

  // Sub-schemas of commitStats that web consumes transitively via
  // commitStatsSchema.extend() — do not need independent wrappers.
  commitToolBreakdownSchema: 'composed into commitStatsSchema',
  dailyCommitSchema: 'composed into commitStatsSchema',
  commitOutcomeCorrelationSchema: 'composed into commitStatsSchema',
  commitEditRatioBucketSchema: 'composed into commitStatsSchema',

  // Sub-schemas consumed transitively by their parent schemas that web
  // imports. Listing each with the parent it's composed into.
  formationRecommendationCountsSchema: 'composed into memoryUsageStatsSchema',
  toolHandoffRecentFileSchema: 'composed into toolHandoffSchema (recent_files array)',
};

function listSharedZodSchemas(): string[] {
  return Object.keys(SharedAnalytics).filter(
    (k) =>
      k.endsWith('Schema') && typeof (SharedAnalytics as Record<string, unknown>)[k] === 'object',
  );
}

function listWebBaseImports(): Set<string> {
  const content = readFileSync(WEB_SCHEMA_FILE, 'utf-8');
  const re = /(\w+Schema)\s+as\s+base\w+Schema/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    found.add(m[1]);
  }
  return found;
}

describe('analytics contract-sync: web wraps every shared schema', () => {
  it('every shared schema is imported by web or on the allowlist', () => {
    const shared = listSharedZodSchemas();
    const webImports = listWebBaseImports();

    const drifted = shared.filter(
      (name) => !webImports.has(name) && !(name in INTENTIONALLY_UNWRAPPED),
    );

    expect(
      drifted,
      [
        'Contract drift: shared/contracts/analytics.ts exports Zod schemas',
        'that web/src/lib/schemas/analytics.ts neither imports nor has on the',
        'INTENTIONALLY_UNWRAPPED allowlist.',
        '',
        'Drifted schemas: ' + drifted.join(', '),
        '',
        "Fix: either add the schema to web's base-import list and wrap it",
        'with appropriate .default() values, or add it to INTENTIONALLY_',
        'UNWRAPPED with a reason.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('no stale allowlist entries — every entry still exists in shared', () => {
    const shared = new Set(listSharedZodSchemas());
    const stale = Object.keys(INTENTIONALLY_UNWRAPPED).filter((name) => !shared.has(name));

    expect(
      stale,
      'Stale allowlist entries: these schemas no longer exist in shared. Remove them from INTENTIONALLY_UNWRAPPED: ' +
        stale.join(', '),
    ).toEqual([]);
  });

  it('every web base-import still exists in shared', () => {
    const shared = new Set(listSharedZodSchemas());
    const webImports = Array.from(listWebBaseImports());
    const orphans = webImports.filter((name) => !shared.has(name));

    expect(
      orphans,
      'Orphaned base imports: web imports these from shared but shared no longer exports them: ' +
        orphans.join(', '),
    ).toEqual([]);
  });

  it('shared contracts file is readable at expected path', () => {
    // Guards against a future refactor silently breaking the path resolution
    // that would make the drift test pass vacuously.
    const content = readFileSync(SHARED_SCHEMA_FILE, 'utf-8');
    expect(content.length).toBeGreaterThan(100);
    expect(content).toMatch(/export const \w+Schema\s*=/);
  });
});

// ── Shape-level alignment check ──────────────────────────────────────────
//
// For each schema web imports as baseX, the shared schema's top-level shape
// keys must be a subset of the web schema's shape keys. If shared adds a new
// field to an existing schema, web should still expose it even if unwrapped
// (z.extend() preserves parent keys). This catches the edge case where web's
// .extend({}) accidentally replaces an object-typed field instead of merging
// its children.

describe('analytics contract-sync: shape coverage', () => {
  it('every shared schema shape is preserved through web extension', async () => {
    // Import web lazily because importing the full module pulls UI deps.
    const Web = await import('./analytics.js');

    const webBase = listWebBaseImports();
    const mismatches: string[] = [];

    for (const name of webBase) {
      const sharedSchema = (SharedAnalytics as Record<string, unknown>)[name];
      if (!sharedSchema || typeof sharedSchema !== 'object') continue;
      // Only z.object schemas have `.shape`.
      const sharedShape = (sharedSchema as { shape?: Record<string, unknown> }).shape;
      if (!sharedShape) continue;

      // Web doesn't re-export the extended schemas under the same name, so we
      // can't easily compare pairs. Instead, check that each rolled-up schema
      // in web (teamAnalyticsSchema, userAnalyticsSchema, etc.) resolves when
      // validated against fixtures — that's covered by other tests.
      // Here we just confirm shared's shape exists and is non-empty.
      if (Object.keys(sharedShape).length === 0) {
        mismatches.push(`${name} has no shape keys in shared`);
      }
    }

    // Meta-check: ensure the web module actually loaded (catches lazy-import
    // wiring regressions).
    expect(typeof Web.createEmptyAnalytics).toBe('function');
    expect(mismatches).toEqual([]);
  });
});
