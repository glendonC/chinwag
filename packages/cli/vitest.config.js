import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.js', 'lib/**/*.jsx', 'lib/**/*.ts', 'lib/**/*.tsx', 'cli.jsx'],
      exclude: ['lib/__tests__/**', 'dist/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 45,
        branches: 42,
        functions: 39,
        lines: 45,
      },
    },
  },
});
