import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.js', 'lib/**/*.ts'],
      exclude: [
        'lib/__tests__/**',
        // Pure type definitions, no runtime branches to cover.
        'lib/tools/types.ts',
        // Trivial re-exports from @chinmeister/shared. The exported
        // functions are tested in the shared package and via importers,
        // but the v8 reporter does not credit re-export lines.
        'lib/utils/logger.ts',
        'lib/identity.ts',
        'lib/config.ts',
        // Bootstrap is a thin orchestration shim over already-tested
        // pieces (api, team, lifecycle, profile, identity). Its end-to-end
        // contract is exercised by stdio.integration.test.js, which spawns
        // a subprocess that v8 coverage cannot trace. Test the constituent
        // pieces, not the wiring.
        'lib/bootstrap.ts',
      ],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 77,
        branches: 73,
        functions: 74,
        lines: 77,
      },
    },
  },
});
