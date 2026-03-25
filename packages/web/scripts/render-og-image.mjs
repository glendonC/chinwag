#!/usr/bin/env node
/**
 * Rasterizes assets/og-image.svg to assets/og-image.png (1200×630) for social previews.
 * Run from repo root: npm run og-image  (uses npm exec @resvg/resvg-js)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = join(root, 'assets', 'og-image.svg');
const outPath = join(root, 'assets', 'og-image.png');

const svg = readFileSync(svgPath);
const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
const img = resvg.render();
writeFileSync(outPath, img.asPng());
console.log('Wrote', outPath, `${img.width}×${img.height}`);
