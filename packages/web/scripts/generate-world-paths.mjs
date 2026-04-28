#!/usr/bin/env node
/**
 * Generate SVG path data from Natural Earth TopoJSON land boundaries.
 * Uses equirectangular projection mapped to a 1000x500 viewBox.
 *
 * Run: node packages/web/scripts/generate-world-paths.mjs
 * Output: packages/web/src/components/GlobalMap/worldPaths.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import * as topojson from 'topojson-client';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use 110m resolution: light file size, looks great at dashboard scale
const topoPath = resolve(__dirname, '../../../node_modules/world-atlas/countries-110m.json');
const topo = JSON.parse(readFileSync(topoPath, 'utf-8'));

// Convert to GeoJSON
const geo = topojson.feature(topo, topo.objects.countries);

// Equirectangular projection: lng [-180,180] -> x [0,1000], lat [90,-90] -> y [0,500]
function projectX(lng) {
  return ((lng + 180) / 360) * 1000;
}
function projectY(lat) {
  return ((90 - lat) / 180) * 500;
}

function ringToPath(ring) {
  return (
    ring
      .map((coord, i) => {
        const x = projectX(coord[0]).toFixed(1);
        const y = projectY(coord[1]).toFixed(1);
        return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
      })
      .join(' ') + 'Z'
  );
}

function geometryToPath(geometry) {
  const paths = [];
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) {
      paths.push(ringToPath(ring));
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        paths.push(ringToPath(ring));
      }
    }
  }
  return paths.join(' ');
}

// Build one combined path per country
const countryPaths = [];
for (const feature of geo.features) {
  const d = geometryToPath(feature.geometry);
  if (d) {
    countryPaths.push(d);
  }
}

// Also generate a single combined land mass path for efficiency
const landTopo = JSON.parse(
  readFileSync(resolve(__dirname, '../../../node_modules/world-atlas/land-110m.json'), 'utf-8'),
);
const landGeo = topojson.feature(landTopo, landTopo.objects.land);
const landPaths = [];
for (const feature of landGeo.features) {
  const d = geometryToPath(feature.geometry);
  if (d) landPaths.push(d);
}
const combinedLandPath = landPaths.join(' ');

const output = `// Auto-generated from Natural Earth 50m data via generate-world-paths.mjs
// Do not edit by hand; regenerate with: node scripts/generate-world-paths.mjs

/**
 * Combined land mass outline: all continents and islands as a single SVG path.
 * Equirectangular projection, viewBox 0 0 1000 500.
 */
export const LAND_PATH = ${JSON.stringify(combinedLandPath)};
`;

const outPath = resolve(__dirname, '../src/components/GlobalMap/worldPaths.ts');
writeFileSync(outPath, output, 'utf-8');

// Report file size
const sizeKB = (Buffer.byteLength(output, 'utf-8') / 1024).toFixed(1);
console.log(
  `Generated worldPaths.ts (${sizeKB} KB) with ${geo.features.length} countries merged into land path`,
);
