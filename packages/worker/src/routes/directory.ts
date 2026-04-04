import type { Env, User } from '../types.js';
import { getDB, rpc } from '../lib/env.js';
import { json, parseBody } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { requireJson, withRateLimit, withIpRateLimit } from '../lib/validation.js';
import { evaluateTool } from '../lib/evaluate.js';
import { CATEGORY_NAMES } from '../catalog.js';
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

export async function handleListDirectory(request: Request, env: Env): Promise<Response> {
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
}

export async function handleGetDirectoryEntry(
  request: Request,
  env: Env,
  toolId: string,
): Promise<Response> {
  const db = getDB(env);
  const result = rpc(await db.getEvaluation(toolId));
  if (!result.evaluation) return json({ error: 'Tool not found' }, 404);
  return json({ evaluation: result.evaluation }, 200, CACHE_HEADERS);
}

// Admin-only delete — remove duplicate/stale evaluations.
export async function handleAdminDelete(request: Request, env: Env): Promise<Response> {
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
}

// Admin-only batch evaluation — no auth, secured by secret key in body.
// Used for seed scans and monthly re-evaluations.
// IP rate limited to prevent brute-force key guessing.
export async function handleBatchEvaluate(request: Request, env: Env): Promise<Response> {
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
}

export async function handleTriggerEvaluation(
  request: Request,
  user: User,
  env: Env,
): Promise<Response> {
  const body = await parseBody(request);
  const parseErr = requireJson(body);
  if (parseErr) return parseErr;

  const b = body as Record<string, unknown>;
  const { name, url } = b;
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
}
