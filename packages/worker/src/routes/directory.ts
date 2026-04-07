import { getDB, rpc } from '../lib/env.js';
import { json, parseBody } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { requireJson, withRateLimit, withIpRateLimit } from '../lib/validation.js';
import { evaluateTool, enrichExistingTool, enrichCredibility } from '../lib/evaluate.js';
import { discoverTools } from '../lib/discover.js';
import { findDemoVideo } from '../lib/search.js';
import { CATEGORY_NAMES } from '../catalog.js';
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

  return json(
    { evaluations: result.evaluations || [], categories: CATEGORY_NAMES },
    200,
    CACHE_HEADERS,
  );
});

export const handleGetDirectoryEntry = publicRoute(async ({ env, params }) => {
  const toolId = params[0];
  const db = getDB(env);
  const result = rpc(await db.getEvaluation(toolId));
  if (!result.evaluation) return json({ error: 'Tool not found' }, 404);
  return json({ evaluation: result.evaluation }, 200, CACHE_HEADERS);
});

// Admin-only delete — remove duplicate/stale evaluations.
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

// Admin-only discovery — find new tools we don't know about yet.
// Runs 18 Exa queries, deduplicates against existing evaluations,
// returns net-new tool names ready for batch-evaluate.
export const handleDiscover = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(request, env, 'discover', RATE_LIMIT_BATCH_EVALUATE_PER_IP, async () => {
    const body = await parseBody(request);
    const parseErr = requireJson(body);
    if (parseErr) return parseErr;

    const b = body as Record<string, unknown>;
    const { admin_key } = b;
    if (!env.EXA_API_KEY || !timingSafeEqual(admin_key, env.EXA_API_KEY))
      return json({ error: 'Forbidden' }, 403);

    // Get existing evaluation IDs for dedup
    const db = getDB(env);
    const existing = rpc(await db.listEvaluations({ limit: 500, offset: 0 }));
    const existingIds = (existing.evaluations || []).map((e: any) => e.id as string);

    const result = await discoverTools(existingIds, env);

    log.info(
      `Discovery complete: ${result.new_tools.length} new tools from ${result.queries_run} queries (${result.total_results} total results)`,
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

      // Find tools missing enrichment data (no ai_summary in metadata)
      const needsEnrichment = evaluations
        .filter((ev: any) => {
          const md = ev.metadata;
          if (!md || typeof md !== 'object') return true;
          return !(md as Record<string, unknown>).ai_summary;
        })
        .slice(0, batchLimit);

      log.info(`Enriching ${needsEnrichment.length} tools (of ${evaluations.length} total)`);

      const results: Array<Record<string, unknown>> = [];
      for (const ev of needsEnrichment) {
        const evObj = ev as Record<string, unknown>;
        const name = evObj.name as string;
        const existingMd = (evObj.metadata || {}) as Record<string, unknown>;

        const result = await enrichExistingTool(name, existingMd, env);
        if ('error' in result) {
          results.push({ name, error: result.error });
        } else {
          // Save back with merged metadata
          await db.saveEvaluation({ ...evObj, metadata: result.metadata });
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

    // Find tools missing credibility data (no founded_year in metadata)
    const needsCredibility = evaluations
      .filter((ev: any) => {
        const md = ev.metadata;
        if (!md || typeof md !== 'object') return true;
        const m = md as Record<string, unknown>;
        return !m.founded_year && !m.team_size && !m.funding_status;
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
      if ('error' in result) {
        results.push({ name, error: result.error });
      } else {
        await db.saveEvaluation({ ...evObj, metadata: result.metadata });
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
