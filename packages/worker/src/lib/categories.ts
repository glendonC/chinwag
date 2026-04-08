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
  discoveryQuery: string;
  addedAt: string;
  addedBy: 'seed' | 'admin';
}

// Expanded seed categories — includes original 11 plus common gaps.
const SEED_CATEGORIES: Record<string, CategoryEntry> = {
  ...Object.fromEntries(
    Object.entries(CATEGORY_NAMES).map(([id, label]) => [
      id,
      {
        label,
        description: `${label} for AI-assisted development`,
        discoveryQuery: `best ${label.toLowerCase()} AI developer tools 2024`,
        addedAt: new Date().toISOString(),
        addedBy: 'seed' as const,
      },
    ]),
  ),
  'ai-assistant': {
    label: 'AI Assistants',
    description: 'General-purpose AI assistants used in development workflows',
    discoveryQuery: 'AI assistant developer productivity tool 2024',
    addedAt: new Date().toISOString(),
    addedBy: 'seed',
  },
  'image-gen': {
    label: 'Image Generation',
    description: 'AI image and visual generation tools used in development',
    discoveryQuery: 'AI image generation tool developer creative workflow 2024',
    addedAt: new Date().toISOString(),
    addedBy: 'seed',
  },
  devops: {
    label: 'DevOps & CI/CD',
    description: 'AI-powered DevOps, CI/CD, and deployment tools',
    discoveryQuery: 'AI DevOps CI CD deployment developer tool 2024',
    addedAt: new Date().toISOString(),
    addedBy: 'seed',
  },
  database: {
    label: 'Database Tools',
    description: 'AI tools for database management, queries, and optimization',
    discoveryQuery: 'AI database query optimization developer tool 2024',
    addedAt: new Date().toISOString(),
    addedBy: 'seed',
  },
  monitoring: {
    label: 'Monitoring',
    description: 'AI-powered monitoring, observability, and alerting tools',
    discoveryQuery: 'AI monitoring observability developer tool 2024',
    addedAt: new Date().toISOString(),
    addedBy: 'seed',
  },
  infrastructure: {
    label: 'Infrastructure',
    description: 'AI infrastructure and cloud management tools',
    discoveryQuery: 'AI infrastructure cloud management developer tool 2024',
    addedAt: new Date().toISOString(),
    addedBy: 'seed',
  },
};

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
    return cached as Record<string, CategoryEntry>;
  }

  // First access — seed from defaults
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
 * Get the list of valid category IDs (including 'other' fallback).
 */
export async function getValidCategories(env: Env): Promise<string[]> {
  const registry = await getCategories(env);
  return [...Object.keys(registry), 'other'];
}

/**
 * Log a suggested category from Exa for admin review.
 */
export async function logSuggestedCategory(
  env: Env,
  slug: string,
  label: string,
  suggestedBy: string,
): Promise<void> {
  const raw = await env.AUTH_KV.get(KV_KEY_PENDING, { type: 'json' });
  const pending = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    { label: string; suggestedBy: string; suggestedAt: string; count: number }
  >;

  if (pending[slug]) {
    pending[slug].count++;
  } else {
    pending[slug] = {
      label,
      suggestedBy,
      suggestedAt: new Date().toISOString(),
      count: 1,
    };
  }

  await env.AUTH_KV.put(KV_KEY_PENDING, JSON.stringify(pending));
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
