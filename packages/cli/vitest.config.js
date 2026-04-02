import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.js', 'lib/**/*.jsx', 'cli.jsx'],
      exclude: ['lib/__tests__/**', 'dist/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      // Thresholds enforce current coverage floor (~5% margin below actual).
      // CLI is mostly UI components (Ink/React) that need render-test infrastructure.
      // Target: raise to 30/25/20 as render tests are added.
      thresholds: {
        lines: 8,
        functions: 7,
        branches: 4,
      },
    },
  },
});
