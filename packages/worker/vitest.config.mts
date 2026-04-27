import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.js',
      // Use test-specific config: local KV, mock AI binding.
      wrangler: { configPath: './wrangler.test.toml' },
      // Force fully-local execution. The pool defaults remoteBindings to
      // true in 0.13.x, which spins up a wrangler remote proxy session
      // for any binding that has a remote counterpart (AI, R2, etc.).
      // That session requires Cloudflare login and breaks CI without CF
      // credentials. Workers AI is mocked locally in tests anyway, so we
      // never want the remote path.
      remoteBindings: false,
    }),
  ],
  test: {
    // scripts/ holds standalone Node build scripts (fetch-pricing-seed,
    // resolver coverage harness). They're invoked directly via
    // `node --experimental-strip-types` and must not be picked up by vitest.
    exclude: ['**/node_modules/**', 'scripts/**'],
  },
  // Note: V8 coverage is not supported with @cloudflare/vitest-pool-workers
  // because tests run in the workerd runtime, not Node.js. The workerd runtime
  // does not expose node:inspector/promises needed for V8 coverage collection.
  // Coverage for worker code requires a different approach (e.g., integration
  // tests running against the worker from Node.js).
});
