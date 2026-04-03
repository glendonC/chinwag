import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.js', 'lib/**/*.ts', 'index.js', 'hook.js', 'channel.js'],
      exclude: ['lib/__tests__/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
    },
  },
});
