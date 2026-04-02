import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.js', 'index.js', 'hook.js', 'channel.js'],
      exclude: ['lib/__tests__/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      // Thresholds enforce current coverage floor (~5% margin below actual).
      // Target: raise to 70/60/55 as hook and channel tests are added.
      thresholds: {
        lines: 40,
        functions: 36,
        branches: 47,
      },
    },
  },
});
