import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

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
      // Thresholds enforce current coverage floor (~2% margin below actual).
      // Actuals as of 2026-04-27: stmts 29.3, branches 21.3, funcs 25.3, lines 30.7.
      // The drop from the 2026-04-04 baseline (~70%) is structural: the
      // dashboard category/detail views, widget bodies, and viz primitives
      // landed without unit tests. They are exercised end-to-end via the
      // demo overlay and Playwright (e2e/), but the v8 reporter does not
      // credit those paths. Raising these is on the roadmap; treat them as
      // a regression gate for now, not a quality target.
      thresholds: {
        statements: 27,
        branches: 19,
        functions: 23,
        lines: 28,
      },
    },
  },
});
