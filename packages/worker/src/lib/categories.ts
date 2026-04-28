// KV-backed dynamic category registry.
// Categories are seeded from the hardcoded CATEGORY_NAMES on first access,
// then served from KV with edge caching. New categories can be added via
// admin endpoints without a code deploy.

import type { Env } from '../types.js';
import { CATEGORY_NAMES } from '../catalog.js';

const KV_KEY_REGISTRY = 'categories:registry';
const KV_KEY_PENDING = 'categories:pending';
const CACHE_TTL = 300; // 5 minutes edge cache

export interface CategoryEntry {
  label: string;
  description: string;
  /** Search query for finding tools in this category (used by admin scripts). */
  discoveryQuery: string;
  addedAt: string;
  addedBy: 'seed' | 'admin';
}

// Seed categories - auto-built from CATEGORY_NAMES in catalog.ts.
// New categories added to CATEGORY_NAMES are auto-merged into KV on next access.
const SEED_CATEGORIES: Record<string, CategoryEntry> = Object.fromEntries(
  Object.entries(CATEGORY_NAMES).map(([id, label]) => [
    id,
    {
      label,
      description: `${label} for AI-assisted development`,
      discoveryQuery: `best ${label.toLowerCase()} developer tools 2025`,
      addedAt: new Date().toISOString(),
      addedBy: 'seed' as const,
    },
  ]),
);

/**
 * Get the full category registry from KV. Seeds on first access.
 * Edge-cached for 5 minutes via KV cacheTtl.
 */
export async function getCategories(env: Env): Promise<Record<string, CategoryEntry>> {
  const cached = await env.AUTH_KV.get(KV_KEY_REGISTRY, {
    type: 'json',
    cacheTtl: CACHE_TTL,
  });

  if (cached && typeof cached === 'object') {
    const existing = cached as Record<string, CategoryEntry>;
    // Merge any new seed categories added in code since last KV write
    const seedKeys = Object.keys(SEED_CATEGORIES);
    const missing = seedKeys.filter((k) => !existing[k]);
    if (missing.length > 0) {
      for (const k of missing) {
        // k came from Object.keys(SEED_CATEGORIES) so the lookup is always defined.
        const seed = SEED_CATEGORIES[k];
        if (seed) existing[k] = seed;
      }
      await env.AUTH_KV.put(KV_KEY_REGISTRY, JSON.stringify(existing));
    }
    return existing;
  }

  // First access - seed from defaults
  await env.AUTH_KV.put(KV_KEY_REGISTRY, JSON.stringify(SEED_CATEGORIES));
  return SEED_CATEGORIES;
}

/**
 * Get simplified category names for API responses.
 * Returns Record<string, string> matching the shape CATEGORY_NAMES used to provide.
 */
export async function getCategoryNames(env: Env): Promise<Record<string, string>> {
  const registry = await getCategories(env);
  const names: Record<string, string> = {};
  for (const [id, entry] of Object.entries(registry)) {
    names[id] = entry.label;
  }
  return names;
}

/**
 * Get pending category suggestions for admin review.
 */
export async function getPendingCategories(
  env: Env,
): Promise<
  Record<string, { label: string; suggestedBy: string; suggestedAt: string; count: number }>
> {
  const raw = await env.AUTH_KV.get(KV_KEY_PENDING, { type: 'json' });
  return (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    { label: string; suggestedBy: string; suggestedAt: string; count: number }
  >;
}

/**
 * Promote a pending category to the live registry.
 */
export async function promoteCategory(env: Env, slug: string, entry: CategoryEntry): Promise<void> {
  const registry = await getCategories(env);
  registry[slug] = entry;
  await env.AUTH_KV.put(KV_KEY_REGISTRY, JSON.stringify(registry));

  // Remove from pending
  const pending = await getPendingCategories(env);
  delete pending[slug];
  await env.AUTH_KV.put(KV_KEY_PENDING, JSON.stringify(pending));
}
