/**
 * Spec loader. Checks user/healed specs first, then bundled specs.
 *
 * Load priority:
 * 1. ~/.chinmeister/specs/{toolId}.json (user-modified or AI-healed)
 * 2. {bundled}/specs/{toolId}.json (shipped with chinmeister)
 *
 * The cache is invalidated for a tool when a healed spec is written,
 * allowing hot-swap without process restart.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import type { ParserSpec } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_SPECS_DIR = join(__dirname, 'specs');
const USER_SPECS_DIR = join(homedir(), '.chinmeister', 'specs');

const cache = new Map<string, ParserSpec>();

export async function loadSpec(toolId: string): Promise<ParserSpec | null> {
  const cached = cache.get(toolId);
  if (cached) return cached;

  // Try user/healed spec first (higher priority)
  const userSpec = await tryLoadFrom(USER_SPECS_DIR, toolId);
  if (userSpec) {
    cache.set(toolId, userSpec);
    return userSpec;
  }

  // Fall back to bundled spec
  const bundledSpec = await tryLoadFrom(BUNDLED_SPECS_DIR, toolId);
  if (bundledSpec) {
    cache.set(toolId, bundledSpec);
    return bundledSpec;
  }

  return null;
}

/** Invalidate the cache for a tool so the next load picks up a healed spec. */
export function invalidateSpec(toolId: string): void {
  cache.delete(toolId);
}

async function tryLoadFrom(dir: string, toolId: string): Promise<ParserSpec | null> {
  try {
    const content = await readFile(join(dir, `${toolId}.json`), 'utf-8');
    return JSON.parse(content) as ParserSpec;
  } catch {
    return null;
  }
}
