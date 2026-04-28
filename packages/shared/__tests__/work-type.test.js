import { describe, it, expect } from 'vitest';
import { classifyWorkType, isWorkType, WORK_TYPES } from '../analytics/work-type.ts';

describe('classifyWorkType', () => {
  const cases = [
    // test - most specific first
    ['packages/web/src/__tests__/foo.test.ts', 'test'],
    ['packages/web/src/lib/toolMeta.test.js', 'test'],
    ['packages/worker/src/__tests__/moderation.spec.ts', 'test'],

    // docs
    ['docs/VISION.md', 'docs'],
    ['README.md', 'docs'],
    ['packages/web/docs/widgets.md', 'docs'],
    ['packages/web/src/components/docs/Layout.tsx', 'docs'], // /docs/ wins over .tsx

    // styling
    ['packages/web/src/app.css', 'styling'],
    ['packages/web/src/components/Button.module.css', 'styling'],
    ['packages/web/src/theme.scss', 'styling'],

    // frontend - tsx/jsx, or in a frontend path
    ['packages/web/src/widgets/ToolWidgets.tsx', 'frontend'],
    ['packages/web/src/views/OverviewView/OverviewView.tsx', 'frontend'],
    ['packages/web/src/components/Header.jsx', 'frontend'],
    ['packages/cli/lib/dashboard/hooks/useCollectorSubscription.ts', 'frontend'],
    ['packages/web/src/pages/Settings.ts', 'frontend'],

    // backend - routes/dos/api/server/workers
    ['packages/worker/src/dos/team/context.ts', 'backend'],
    ['packages/worker/src/routes/team/membership.ts', 'backend'],
    ['packages/worker/src/api/analytics.ts', 'backend'],

    // config
    ['package.json', 'config'],
    ['packages/web/tsconfig.json', 'config'],
    ['packages/worker/wrangler.toml', 'config'],
    ['packages/web/vite.config.ts', 'config'],
    ['.eslintrc.cjs', 'config'],

    // other - fall-through
    ['packages/shared/tool-registry.ts', 'other'],
    ['packages/worker/src/moderation.ts', 'other'],
    ['packages/cli/lib/extraction/engine.ts', 'other'],
  ];

  for (const [path, expected] of cases) {
    it(`"${path}" → ${expected}`, () => {
      expect(classifyWorkType(path)).toBe(expected);
    });
  }

  it('returns a canonical WORK_TYPES member for every input', () => {
    for (const [path] of cases) {
      expect(WORK_TYPES).toContain(classifyWorkType(path));
    }
  });
});

describe('isWorkType', () => {
  it('accepts every canonical work type', () => {
    for (const wt of WORK_TYPES) {
      expect(isWorkType(wt)).toBe(true);
    }
  });

  it('rejects drift labels that used to live in the demo', () => {
    expect(isWorkType('feature')).toBe(false);
    expect(isWorkType('fix')).toBe(false);
    expect(isWorkType('refactor')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isWorkType(null)).toBe(false);
    expect(isWorkType(undefined)).toBe(false);
    expect(isWorkType(42)).toBe(false);
    expect(isWorkType({})).toBe(false);
  });
});
