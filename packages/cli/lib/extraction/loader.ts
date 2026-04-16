/**
 * Spec loader. Reads JSON spec files from the specs/ directory.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ParserSpec } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = join(__dirname, 'specs');

const cache = new Map<string, ParserSpec>();

export async function loadSpec(toolId: string): Promise<ParserSpec | null> {
  const cached = cache.get(toolId);
  if (cached) return cached;

  try {
    const content = await readFile(join(SPECS_DIR, `${toolId}.json`), 'utf-8');
    const spec = JSON.parse(content) as ParserSpec;
    cache.set(toolId, spec);
    return spec;
  } catch {
    return null;
  }
}
