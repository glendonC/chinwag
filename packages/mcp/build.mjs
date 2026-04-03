// Build script: compile .ts files to .js next to source.
// This enables Node.js to resolve `import from './lib/team.js'` at runtime
// when the actual source is team.ts.

import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
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
  outdir: ROOT,
  outbase: ROOT,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // Keep .js imports as-is (they resolve to .ts via esbuild, output as .js)
  bundle: false,
  // Write .js next to .ts
  allowOverwrite: true,
});

console.error(`[build] Compiled ${tsFiles.length} TypeScript files`);
