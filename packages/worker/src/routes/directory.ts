import { getDB, rpc } from '../lib/env.js';
import { json, parseBody } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { requireJson, withIpRateLimit } from '../lib/validation.js';
import {
  getCategoryNames,
  getCategories,
  getPendingCategories,
  promoteCategory,
  type CategoryEntry,
} from '../lib/categories.js';
import {
  getCachedIcon,
  resolveAndCacheIcon,
  extractBrandColorFromCache,
  extractColorWithAI,
} from '../lib/icons.js';
import { publicRoute } from '../lib/middleware.js';
import { RATE_LIMIT_ADMIN_BATCH_PER_IP } from '../lib/constants.js';

const log = createLogger('routes.directory');

// Constant-time string comparison to prevent timing attacks on admin key checks.
function timingSafeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

// Resolve admin key — production may still use the old EXA_API_KEY secret name.
function getAdminKey(env: { ADMIN_KEY?: string; EXA_API_KEY?: string }): string | undefined {
  return env.ADMIN_KEY || env.EXA_API_KEY;
}

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
};

export const handleListDirectory = publicRoute(async ({ request, env }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || null;
  const verdict = url.searchParams.get('verdict') || null;
  const category = url.searchParams.get('category') || null;
  const limit = Math.max(
    1,
    Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200),
  );
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const mcpRaw = url.searchParams.get('mcp_support');
  const mcp_support = mcpRaw != null ? parseInt(mcpRaw, 10) : null;

  const registryRaw = url.searchParams.get('in_registry');
  const in_registry = registryRaw != null ? parseInt(registryRaw, 10) : null;

  const db = getDB(env);

  // completeness filter: 'any' (default) = all tools, 'listing' = core pass completed,
  // 'full' = core + enrichment completed. Frontend should request 'listing' by default.
  const completeness = url.searchParams.get('completeness') || 'any';

  const result = q
    ? rpc(await db.searchEvaluations(q, limit))
    : rpc(
        await db.listEvaluations({
          verdict,
          category,
          mcp_support,
          in_registry,
          completeness: completeness !== 'any' ? completeness : null,
          limit,
          offset,
        }),
      );

  const evaluations = result.evaluations || [];
  const total = 'total' in result ? (result as any).total : evaluations.length;

  const allCategories = await getCategoryNames(env);

  // Only return categories that have at least one tool in this result set.
  // The frontend paginates and accumulates categories across pages.
  const populated = new Set(evaluations.map((ev: any) => ev.category));
  const categories = Object.fromEntries(
    Object.entries(allCategories).filter(([id]) => populated.has(id)),
  );

  return json({ evaluations, categories, total }, 200, CACHE_HEADERS);
});

export const handleGetDirectoryEntry = publicRoute(async ({ env, params }) => {
  const toolId = params[0];
  const db = getDB(env);
  const result = rpc(await db.getEvaluation(toolId));
  if (!result.evaluation) return json({ error: 'Tool not found' }, 404);
  return json({ evaluation: result.evaluation }, 200, CACHE_HEADERS);
});

// Admin-only delete — remove duplicate/stale evaluations.
// Admin-only import — save pre-evaluated tools directly (no Exa calls).
// Used to mirror data between environments.
export const handleAdminImport = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(request, env, 'admin-import', RATE_LIMIT_ADMIN_BATCH_PER_IP, async () => {
    const body = await parseBody(request);
    const parseErr = requireJson(body);
    if (parseErr) return parseErr;

    const b = body as Record<string, unknown>;
    const { evaluations, admin_key } = b;
    if (!getAdminKey(env) || !timingSafeEqual(admin_key, getAdminKey(env)))
      return json({ error: 'Forbidden' }, 403);
    if (!Array.isArray(evaluations) || evaluations.length === 0)
      return json({ error: 'evaluations array required' }, 400);

    const db = getDB(env);
    let saved = 0;
    for (const ev of evaluations) {
      if (typeof ev !== 'object' || !ev) continue;
      await db.saveEvaluation(ev as Record<string, unknown>);
      saved++;
    }
    return json({ saved }, 200);
  });
});

export const handleAdminDelete = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(request, env, 'admin-delete', RATE_LIMIT_ADMIN_BATCH_PER_IP, async () => {
    const body = await parseBody(request);
    const parseErr = requireJson(body);
    if (parseErr) return parseErr;

    const b = body as Record<string, unknown>;
    const { ids, admin_key } = b;
    if (!getAdminKey(env) || !timingSafeEqual(admin_key, getAdminKey(env)))
      return json({ error: 'Forbidden' }, 403);
    if (!Array.isArray(ids) || ids.length === 0) return json({ error: 'ids array required' }, 400);

    const db = getDB(env);
    const results: Array<{ id: unknown; deleted: unknown }> = [];
    for (const id of ids) {
      const r = rpc(await db.deleteEvaluation(id));
      results.push({ id, deleted: r.deleted });
    }
    return json({ results }, 200);
  });
});

// ── Category management endpoints ──

export const handleGetCategories = publicRoute(async ({ env }) => {
  const registry = await getCategories(env);
  const pending = await getPendingCategories(env);
  return json({ categories: registry, pending }, 200, CACHE_HEADERS);
});

export const handlePromoteCategory = publicRoute(async ({ request, env }) => {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;
  const b = body as Record<string, unknown>;
  const { admin_key, slug, label, description, discoveryQuery } = b;
  if (!getAdminKey(env) || !timingSafeEqual(admin_key, getAdminKey(env)))
    return json({ error: 'Forbidden' }, 403);
  if (typeof slug !== 'string' || typeof label !== 'string')
    return json({ error: 'slug and label required' }, 400);

  const entry: CategoryEntry = {
    label,
    description: typeof description === 'string' ? description : `${label} tools`,
    discoveryQuery:
      typeof discoveryQuery === 'string'
        ? discoveryQuery
        : `best ${label.toLowerCase()} AI developer tools 2024`,
    addedAt: new Date().toISOString(),
    addedBy: 'admin',
  };

  await promoteCategory(env, slug, entry);
  return json({ ok: true, slug, entry }, 200);
});

// ── Icon endpoints ──

export const handleGetIcon = publicRoute(async ({ env, params }) => {
  const toolId = params[0];
  const cached = await getCachedIcon(toolId, env);
  if (cached) {
    // Parse data URI to extract content type and body
    const match = cached.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const contentType = match[1];
      const body = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
      return new Response(body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=604800, immutable',
        },
      });
    }
  }
  // Fallback: redirect to Google Favicon
  const db = getDB(env);
  const result = rpc(await db.getEvaluation(toolId));
  const md = (result.evaluation?.metadata ?? {}) as Record<string, unknown>;
  const website = typeof md.website === 'string' ? md.website : null;
  if (website) {
    try {
      const hostname = new URL(website).hostname;
      return Response.redirect(`https://www.google.com/s2/favicons?domain=${hostname}&sz=128`, 302);
    } catch {
      // Invalid URL
    }
  }
  return json({ error: 'Icon not found' }, 404);
});

export const handleBatchResolveIcons = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(request, env, 'batch-icons', RATE_LIMIT_ADMIN_BATCH_PER_IP, async () => {
    const body = await parseBody(request);
    const parseErr = requireJson(body);
    if (parseErr) return parseErr;

    const b = body as Record<string, unknown>;
    const { admin_key, limit: rawLimit } = b;
    if (!getAdminKey(env) || !timingSafeEqual(admin_key, getAdminKey(env)))
      return json({ error: 'Forbidden' }, 403);

    const batchLimit = Math.min(typeof rawLimit === 'number' ? rawLimit : 50, 50);

    const db = getDB(env);
    const existing = rpc(await db.listEvaluations({ limit: 500, offset: 0 }));
    const evaluations = existing.evaluations || [];

    // Find tools without cached icons
    const needsIcon = evaluations
      .filter((ev: any) => {
        const md = ev.metadata;
        if (!md || typeof md !== 'object') return true;
        return !(md as Record<string, unknown>).icon_cached;
      })
      .slice(0, batchLimit);

    log.info(`Resolving icons for ${needsIcon.length} tools`);

    const results: Array<Record<string, unknown>> = [];
    for (const ev of needsIcon) {
      const evObj = ev as Record<string, unknown>;
      const name = evObj.name as string;
      const id = evObj.id as string;
      const md = { ...(evObj.metadata || {}) } as Record<string, unknown>;

      await resolveAndCacheIcon(id, md, env);

      if (md.icon_cached) {
        await db.saveEvaluation({ ...evObj, metadata: md });
        results.push({ name, icon_url: md.icon_url, icon_source: md.icon_source });
      } else {
        results.push({ name, icon_url: null });
      }
    }

    return json(
      {
        results,
        resolved: results.filter((r) => r.icon_url).length,
        failed: results.filter((r) => !r.icon_url).length,
      },
      200,
    );
  });
});

// Admin-only batch color extraction — extract brand colors from already-cached icons.
// No external fetches needed — reads PNG data from KV and analyzes pixels.
export const handleBatchExtractColors = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(request, env, 'batch-colors', RATE_LIMIT_ADMIN_BATCH_PER_IP, async () => {
    const body = await parseBody(request);
    const parseErr = requireJson(body);
    if (parseErr) return parseErr;

    const b = body as Record<string, unknown>;
    const { admin_key, limit: rawLimit } = b;
    if (!getAdminKey(env) || !timingSafeEqual(admin_key, getAdminKey(env)))
      return json({ error: 'Forbidden' }, 403);

    const batchLimit = Math.min(typeof rawLimit === 'number' ? rawLimit : 50, 50);

    const db = getDB(env);
    const existing = rpc(await db.listEvaluations({ limit: 500, offset: 0 }));
    const evaluations = existing.evaluations || [];

    // Find tools with cached icons but no brand_color
    const needsColor = evaluations
      .filter((ev: any) => {
        const md = ev.metadata;
        if (!md || typeof md !== 'object') return false;
        const m = md as Record<string, unknown>;
        return m.icon_cached && !m.brand_color;
      })
      .slice(0, batchLimit);

    log.info(`Extracting brand colors for ${needsColor.length} tools`);

    const results: Array<Record<string, unknown>> = [];
    for (const ev of needsColor) {
      const evObj = ev as Record<string, unknown>;
      const name = evObj.name as string;
      const id = evObj.id as string;

      // Try PNG pixel extraction first (fast, no AI cost)
      let color = await extractBrandColorFromCache(id, env);

      // If PNG extraction fails, try Workers AI vision (handles any format)
      if (!color) {
        const dataUri = await getCachedIcon(id, env);
        if (dataUri) {
          color = await extractColorWithAI(dataUri, env);
        }
      }

      if (color) {
        const md = { ...(evObj.metadata || {}) } as Record<string, unknown>;
        md.brand_color = color;
        await db.saveEvaluation({ ...evObj, metadata: md });
        results.push({ name, brand_color: color, source: color === null ? 'none' : 'extracted' });
      } else {
        results.push({ name, brand_color: null });
      }
    }

    return json(
      {
        results,
        extracted: results.filter((r) => r.brand_color).length,
        failed: results.filter((r) => !r.brand_color).length,
      },
      200,
    );
  });
});
