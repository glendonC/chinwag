import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        dashboard: resolve(import.meta.dirname, 'dashboard.html'),
      },
    },
  },
  server: {
    port: 56790,
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      exclude: ['src/**/*.test.*'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      // Thresholds enforce current coverage floor (~5% margin below actual).
      // Actuals as of 2026-04-03: stmts 49.2, branches 32.5, funcs 42, lines 50.8.
      // Raise these as more view-level and component tests are added.
      thresholds: {
        statements: 45,
        branches: 28,
        functions: 38,
        lines: 46,
      },
    },
  },
});
