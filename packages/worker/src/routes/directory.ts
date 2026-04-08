import { getDB, rpc } from '../lib/env.js';
import { json, parseBody } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { requireJson, withRateLimit, withIpRateLimit } from '../lib/validation.js';
import { evaluateTool, enrichExistingTool, enrichCredibility } from '../lib/evaluate.js';
import { discoverTools, type Strategy } from '../lib/discover.js';
import { findDemoVideo } from '../lib/search.js';
import { CATEGORY_NAMES } from '../catalog.js';
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
import { publicRoute, authedJsonRoute } from '../lib/middleware.js';
import { RATE_LIMIT_EVALUATIONS, RATE_LIMIT_BATCH_EVALUATE_PER_IP } from '../lib/constants.js';

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
          limit,
          offset,
        }),
      );

  let evaluations = result.evaluations || [];

  // Filter by data completeness — tools without sufficient evaluation data are hidden
  if (completeness === 'listing') {
    evaluations = evaluations.filter((ev: any) => {
      const dp = ev.data_passes || {};
      return dp.core?.success;
    });
  } else if (completeness === 'full') {
    evaluations = evaluations.filter((ev: any) => {
      const dp = ev.data_passes || {};
      return dp.core?.success && dp.enrichment?.success;
    });
  }

  const categories = await getCategoryNames(env);
  return json({ evaluations, categories }, 200, CACHE_HEADERS);
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
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const b = body as Record<string, unknown>;
  const { evaluations, admin_key } = b;
  if (!env.EXA_API_KEY || !timingSafeEqual(admin_key, env.EXA_API_KEY))
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

export const handleAdminDelete = publicRoute(async ({ request, env }) => {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const b = body as Record<string, unknown>;
  const { ids, admin_key } = b;
  if (!env.EXA_API_KEY || !timingSafeEqual(admin_key, env.EXA_API_KEY))
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

// Admin-only batch evaluation — no auth, secured by secret key in body.
// Used for seed scans and monthly re-evaluations.
// IP rate limited to prevent brute-force key guessing.
export const handleBatchEvaluate = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(request, env, 'batch-eval', RATE_LIMIT_BATCH_EVALUATE_PER_IP, async () => {
    const body = await parseBody(request);
    const parseErr = requireJson(body);
    if (parseErr) return parseErr;

    const b = body as Record<string, unknown>;
    const { tools, admin_key } = b;
    if (!env.EXA_API_KEY || !timingSafeEqual(admin_key, env.EXA_API_KEY))
      return json({ error: 'Forbidden' }, 403);
    if (!Array.isArray(tools) || tools.length === 0)
      return json({ error: 'tools array required' }, 400);
    if (tools.length > 50) return json({ error: 'max 50 tools per batch' }, 400);

    const db = getDB(env);
    const results: Array<Record<string, unknown>> = [];
    for (const toolName of tools) {
      if (typeof toolName !== 'string' || !toolName.trim()) {
        results.push({ name: toolName, error: 'invalid name' });
        continue;
      }
      const result = await evaluateTool(toolName.trim(), env);
      if ('error' in result) {
        results.push({ name: toolName, error: result.error });
      } else {
        await db.saveEvaluation(result.evaluation as unknown as Record<string, unknown>);
        results.push({
          name: result.evaluation.name,
          verdict: result.evaluation.verdict,
          confidence: result.evaluation.confidence,
        });
      }
    }
    return json(
      {
        results,
        evaluated: results.filter((r) => !r.error).length,
        errors: results.filter((r) => r.error).length,
      },
      200,
    );
  });
});

// Admin-only discovery — find new tools via multiple sources.
// Sources: awesome (curated lists), producthunt, github (topics), hn (Show HN), exa (web crawl).
// Optional: strategies[] in body to run specific ones, default all.
export const handleDiscover = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(request, env, 'discover', RATE_LIMIT_BATCH_EVALUATE_PER_IP, async () => {
    const body = await parseBody(request);
    const parseErr = requireJson(body);
    if (parseErr) return parseErr;

    const b = body as Record<string, unknown>;
    const { admin_key, strategies: rawStrategies } = b;
    if (!env.EXA_API_KEY || !timingSafeEqual(admin_key, env.EXA_API_KEY))
      return json({ error: 'Forbidden' }, 403);

    const db = getDB(env);
    const existing = rpc(await db.listEvaluations({ limit: 500, offset: 0 }));
    const existingIds = (existing.evaluations || []).map((e: any) => e.id as string);

    const validStrategies: Strategy[] = ['awesome', 'producthunt', 'github', 'hn', 'exa'];
    const strategies = Array.isArray(rawStrategies)
      ? (rawStrategies as string[]).filter((s): s is Strategy =>
          validStrategies.includes(s as Strategy),
        )
      : undefined;

    const result = await discoverTools(existingIds, env, { strategies });

    log.info(
      `Discovery: ${result.new_tools.length} new tools via [${result.strategies_run.join(', ')}] (${result.total_candidates} candidates)`,
    );

    return json(result, 200);
  });
});

// Admin-only batch enrichment — backfill existing evaluations with product details.
// Runs the enrichment pass (second Exa call) on tools that are missing enrichment data.
export const handleBatchEnrich = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(
    request,
    env,
    'batch-enrich',
    RATE_LIMIT_BATCH_EVALUATE_PER_IP,
    async () => {
      const body = await parseBody(request);
      const parseErr = requireJson(body);
      if (parseErr) return parseErr;

      const b = body as Record<string, unknown>;
      const { admin_key, limit: rawLimit } = b;
      if (!env.EXA_API_KEY || !timingSafeEqual(admin_key, env.EXA_API_KEY))
        return json({ error: 'Forbidden' }, 403);

      const batchLimit = Math.min(typeof rawLimit === 'number' ? rawLimit : 50, 50);

      const db = getDB(env);
      const existing = rpc(await db.listEvaluations({ limit: 500, offset: 0 }));
      const evaluations = existing.evaluations || [];

      // Find tools that need enrichment — use data_passes tracking when available,
      // fall back to heuristic (missing ai_summary) for legacy data.
      const needsEnrichment = evaluations
        .filter((ev: any) => {
          const dp = ev.data_passes || {};
          // If data_passes exists, use it as source of truth
          if (dp.core) return !dp.enrichment || !dp.enrichment.success;
          // Legacy fallback: check if enrichment data is present
          const md = ev.metadata;
          if (!md || typeof md !== 'object') return true;
          return !(md as Record<string, unknown>).ai_summary;
        })
        .sort((a: any, b: any) => {
          // Priority: never-ran before failed-and-retrying, then older first
          const aRan = !!a.data_passes?.enrichment;
          const bRan = !!b.data_passes?.enrichment;
          if (aRan !== bRan) return aRan ? 1 : -1;
          return ((a as any).evaluated_at || '').localeCompare((b as any).evaluated_at || '');
        })
        .slice(0, batchLimit);

      log.info(`Enriching ${needsEnrichment.length} tools (of ${evaluations.length} total)`);

      const results: Array<Record<string, unknown>> = [];
      for (const ev of needsEnrichment) {
        const evObj = ev as Record<string, unknown>;
        const name = evObj.name as string;
        const existingMd = (evObj.metadata || {}) as Record<string, unknown>;

        const result = await enrichExistingTool(name, existingMd, env);
        const updatedPasses = {
          ...(evObj.data_passes || {}),
          enrichment: {
            completed_at: new Date().toISOString(),
            success: !('error' in result),
          },
        };
        if ('error' in result) {
          await db.saveEvaluation({ ...evObj, data_passes: updatedPasses });
          results.push({ name, error: result.error });
        } else {
          await db.saveEvaluation({
            ...evObj,
            metadata: result.metadata,
            data_passes: updatedPasses,
          });
          results.push({ name, enriched: true });
        }
      }

      return json(
        {
          results,
          enriched: results.filter((r) => r.enriched).length,
          errors: results.filter((r) => r.error).length,
          remaining: evaluations.length - needsEnrichment.length,
        },
        200,
      );
    },
  );
});

// Admin-only batch video search — find demo videos for tools missing them.
export const handleBatchFindVideos = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(
    request,
    env,
    'batch-video',
    RATE_LIMIT_BATCH_EVALUATE_PER_IP,
    async () => {
      const body = await parseBody(request);
      const parseErr = requireJson(body);
      if (parseErr) return parseErr;

      const b = body as Record<string, unknown>;
      const { admin_key, limit: rawLimit } = b;
      if (!env.EXA_API_KEY || !timingSafeEqual(admin_key, env.EXA_API_KEY))
        return json({ error: 'Forbidden' }, 403);

      const batchLimit = Math.min(typeof rawLimit === 'number' ? rawLimit : 50, 50);

      const db = getDB(env);
      const existing = rpc(await db.listEvaluations({ limit: 500, offset: 0 }));
      const evaluations = existing.evaluations || [];

      const needsVideo = evaluations
        .filter((ev: any) => {
          const md = ev.metadata;
          if (!md || typeof md !== 'object') return true;
          return !(md as Record<string, unknown>).demo_url;
        })
        .slice(0, batchLimit);

      log.info(`Finding demo videos for ${needsVideo.length} tools`);

      const results: Array<Record<string, unknown>> = [];
      for (const ev of needsVideo) {
        const evObj = ev as Record<string, unknown>;
        const name = evObj.name as string;
        const existingMd = (evObj.metadata || {}) as Record<string, unknown>;

        const demoUrl = await findDemoVideo(name, env);
        if (demoUrl) {
          const mergedMd = { ...existingMd, demo_url: demoUrl };
          await db.saveEvaluation({ ...evObj, metadata: mergedMd });
          results.push({ name, demo_url: demoUrl });
        } else {
          results.push({ name, demo_url: null });
        }
      }

      return json(
        {
          results,
          found: results.filter((r) => r.demo_url).length,
          not_found: results.filter((r) => !r.demo_url).length,
        },
        200,
      );
    },
  );
});

// Admin-only batch credibility — backfill sustainability/team/funding signals.
export const handleBatchCredibility = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(request, env, 'batch-cred', RATE_LIMIT_BATCH_EVALUATE_PER_IP, async () => {
    const body = await parseBody(request);
    const parseErr = requireJson(body);
    if (parseErr) return parseErr;

    const b = body as Record<string, unknown>;
    const { admin_key, limit: rawLimit } = b;
    if (!env.EXA_API_KEY || !timingSafeEqual(admin_key, env.EXA_API_KEY))
      return json({ error: 'Forbidden' }, 403);

    const batchLimit = Math.min(typeof rawLimit === 'number' ? rawLimit : 50, 50);

    const db = getDB(env);
    const existing = rpc(await db.listEvaluations({ limit: 500, offset: 0 }));
    const evaluations = existing.evaluations || [];

    // Find tools that need credibility data — use data_passes when available.
    const needsCredibility = evaluations
      .filter((ev: any) => {
        const dp = ev.data_passes || {};
        if (dp.core) return !dp.credibility || !dp.credibility.success;
        // Legacy fallback
        const md = ev.metadata;
        if (!md || typeof md !== 'object') return true;
        const m = md as Record<string, unknown>;
        return !m.founded_year && !m.team_size && !m.funding_status;
      })
      .sort((a: any, b: any) => {
        const aRan = !!a.data_passes?.credibility;
        const bRan = !!b.data_passes?.credibility;
        if (aRan !== bRan) return aRan ? 1 : -1;
        return ((a as any).evaluated_at || '').localeCompare((b as any).evaluated_at || '');
      })
      .slice(0, batchLimit);

    log.info(
      `Credibility pass for ${needsCredibility.length} tools (of ${evaluations.length} total)`,
    );

    const results: Array<Record<string, unknown>> = [];
    for (const ev of needsCredibility) {
      const evObj = ev as Record<string, unknown>;
      const name = evObj.name as string;
      const existingMd = (evObj.metadata || {}) as Record<string, unknown>;

      const result = await enrichCredibility(name, existingMd, env);
      const updatedPasses = {
        ...(evObj.data_passes || {}),
        credibility: {
          completed_at: new Date().toISOString(),
          success: !('error' in result),
        },
      };
      if ('error' in result) {
        await db.saveEvaluation({ ...evObj, data_passes: updatedPasses });
        results.push({ name, error: result.error });
      } else {
        await db.saveEvaluation({
          ...evObj,
          metadata: result.metadata,
          data_passes: updatedPasses,
        });
        results.push({ name, enriched: true });
      }
    }

    return json(
      {
        results,
        enriched: results.filter((r) => r.enriched).length,
        errors: results.filter((r) => r.error).length,
        remaining: evaluations.length - needsCredibility.length,
      },
      200,
    );
  });
});

export const handleTriggerEvaluation = authedJsonRoute(async ({ user, env, body }) => {
  const { name, url } = body;
  const hasName = typeof name === 'string' && name.trim().length > 0;
  const hasUrl = typeof url === 'string' && url.trim().length > 0;

  if (!hasName && !hasUrl) {
    return json({ error: 'name or url is required' }, 400);
  }
  if (hasName && (name as string).length > 200) {
    return json({ error: 'name must be 200 characters or less' }, 400);
  }
  if (hasUrl && (url as string).length > 2000) {
    return json({ error: 'url must be 2000 characters or less' }, 400);
  }

  const db = getDB(env);
  const nameOrUrl = hasName ? (name as string).trim() : (url as string).trim();
  const slugified = nameOrUrl
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return withRateLimit(
    db,
    `eval:${user.id}`,
    RATE_LIMIT_EVALUATIONS,
    'Evaluation limit reached (5/day). Try again tomorrow.',
    async () => {
      // Check if evaluation already exists and is recent
      const existing = rpc(await db.getEvaluation(slugified));
      if (existing.evaluation) {
        const evaluatedAt = new Date(
          existing.evaluation.evaluated_at || existing.evaluation.created_at,
        );
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        if (evaluatedAt > sevenDaysAgo) {
          return json({ evaluation: existing.evaluation, cached: true }, 200);
        }
      }

      const result = await evaluateTool(nameOrUrl, env);
      if ('error' in result) {
        log.warn(`triggerEvaluation failed: ${result.error}`);
        return json({ error: result.error }, 500);
      }

      await db.saveEvaluation(result.evaluation as unknown as Record<string, unknown>);

      return json({ evaluation: result.evaluation }, 201);
    },
  );
});

// ── Category management endpoints ──

export const handleGetCategories = publicRoute(async ({ env }) => {
  const registry = await getCategories(env);
  const pending = await getPendingCategories(env);
  return json({ categories: registry, pending }, 200, CACHE_HEADERS);
});

export const handlePromoteCategory = publicRoute(async ({ request, env }) => {
  const body = (await request.json()) as Record<string, unknown>;
  const { admin_key, slug, label, description, discoveryQuery } = body;
  if (!env.EXA_API_KEY || !timingSafeEqual(admin_key, env.EXA_API_KEY))
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
  return withIpRateLimit(
    request,
    env,
    'batch-icons',
    RATE_LIMIT_BATCH_EVALUATE_PER_IP,
    async () => {
      const body = await parseBody(request);
      const parseErr = requireJson(body);
      if (parseErr) return parseErr;

      const b = body as Record<string, unknown>;
      const { admin_key, limit: rawLimit } = b;
      if (!env.EXA_API_KEY || !timingSafeEqual(admin_key, env.EXA_API_KEY))
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
    },
  );
});

// Admin-only batch color extraction — extract brand colors from already-cached icons.
// No external fetches needed — reads PNG data from KV and analyzes pixels.
export const handleBatchExtractColors = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(
    request,
    env,
    'batch-colors',
    RATE_LIMIT_BATCH_EVALUATE_PER_IP,
    async () => {
      const body = await parseBody(request);
      const parseErr = requireJson(body);
      if (parseErr) return parseErr;

      const b = body as Record<string, unknown>;
      const { admin_key, limit: rawLimit } = b;
      if (!env.EXA_API_KEY || !timingSafeEqual(admin_key, env.EXA_API_KEY))
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
    },
  );
});
