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
      thresholds: {
        statements: 22,
        branches: 22,
        functions: 15,
        lines: 23,
      },
    },
  },
});
