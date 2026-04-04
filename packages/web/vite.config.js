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
      // Thresholds enforce current coverage floor (~3% margin below actual).
      // Actuals as of 2026-04-04: stmts 50.7, branches 34.3, funcs 42, lines 52.4.
      thresholds: {
        statements: 48,
        branches: 31,
        functions: 39,
        lines: 49,
      },
    },
  },
});
