import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';

/** Vite plugin: rewrite dashboard routes to dashboard.html in dev. */
function dashboardFallback() {
  const DASHBOARD_ROUTES = /^\/(dashboard|project|tools|settings)(\/|$)/;
  return {
    name: 'dashboard-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && DASHBOARD_ROUTES.test(req.url)) {
          req.url = '/dashboard.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), dashboardFallback()],
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
    strictPort: true,
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
      // Actuals as of 2026-04-04: stmts 69.2, branches 60.8, funcs 62.6, lines 70.9.
      thresholds: {
        statements: 66,
        branches: 57,
        functions: 59,
        lines: 68,
      },
    },
  },
});
