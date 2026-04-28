// Build script: compile .ts files from lib/ to dist/.
// Entry points (index.js, hook.js, channel.js) import from ./dist/ at runtime.
// All source in lib/ is TypeScript, no hand-written .js files remain.

import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { build } from 'esbuild';

const ROOT = new URL('.', import.meta.url).pathname;

function findTsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
    if (statSync(full).isDirectory()) {
      files.push(...findTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

const tsFiles = findTsFiles(join(ROOT, 'lib'));

if (tsFiles.length === 0) {
  console.error('[build] No .ts files found');
  process.exit(0);
}

await build({
  entryPoints: tsFiles,
  outdir: join(ROOT, 'dist'),
  outbase: join(ROOT, 'lib'),
  format: 'esm',
  platform: 'node',
  target: 'node22',
  bundle: false,
});

console.error(`[build] Compiled ${tsFiles.length} TypeScript files to dist/`);
