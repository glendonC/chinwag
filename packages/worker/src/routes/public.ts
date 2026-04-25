import type { Env } from '../types.js';
import type { RouteDefinition } from '../lib/router.js';
import { resolveRuntimeTargets } from '@chinmeister/shared/runtime-profile.js';
import { TOOL_CATALOG } from '../catalog.js';
import { getCategoryNames } from '../lib/categories.js';
import { getDB, getLobby, rpc } from '../lib/env.js';
import { json } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { auditLog } from '../lib/audit.js';
import { safeParse } from '../lib/safe-parse.js';
import { hashIp, withIpRateLimit } from '../lib/validation.js';
import { publicRoute, authedRoute } from '../lib/middleware.js';
import {
  RATE_LIMIT_ACCOUNTS_PER_IP,
  RATE_LIMIT_STATS_PER_IP,
  RATE_LIMIT_CATALOG_PER_IP,
} from '../lib/constants.js';
import { handleRefreshToken } from './user/auth.js';
import {
  handleListDirectory,
  handleDirectoryStats,
  handleGetDirectoryEntry,
  handleAdminImport,
  handleAdminDelete,
  handleGetCategories,
  handlePromoteCategory,
  handleGetIcon,
  handleBatchResolveIcons,
  handleBatchExtractColors,
  handleListSuggestions,
  handleReviewSuggestion,
  handleReportStale,
} from './directory.js';

const log = createLogger('routes.public');

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

function getDashboardUrl(env: Env): string {
  return resolveRuntimeTargets({
    profile: env.ENVIRONMENT,
    dashboardUrl: env.DASHBOARD_URL,
  }).dashboardUrl;
}

interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  website: string | null;
  installCmd: string | null;
  mcpCompatible: boolean;
  featured: boolean;
}

function evaluationToCatalogEntry(e: Record<string, unknown>): CatalogEntry {
  let metadata = e.metadata || {};
  if (typeof metadata === 'string') {
    metadata = safeParse(metadata, `evaluationToCatalogEntry tool=${e.tool_id} metadata`, {});
  }
  const meta = metadata as Record<string, unknown>;
  return {
    id: e.tool_id as string,
    name: e.name as string,
    description: (e.tagline as string) || '',
    category: (e.category as string) || 'uncategorized',
    website: (meta.website as string) || null,
    installCmd: (meta.installCmd as string) || null,
    mcpCompatible: !!e.mcp_support,
    featured: !!meta.featured,
  };
}

export const handleInit = publicRoute(async ({ request, env }) => {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return json({ error: 'Unable to identify client' }, 400);
  const hashedIp = await hashIp(ip);
  const db = getDB(env);

  // Atomic check-and-consume eliminates the race window between check and consume
  const limit = rpc(await db.checkAndConsume(hashedIp, RATE_LIMIT_ACCOUNTS_PER_IP));
  if (!limit.allowed) {
    return json({ error: 'Too many accounts created recently. Try again later.' }, 429);
  }

  const result = rpc(await db.createUser());
  if ('error' in result) {
    log.warn(`createUser failed: ${result.error}`);
    return json({ error: result.error }, 400);
  }

  // Store auth and refresh tokens in KV — if this fails the user would
  // receive tokens that cannot authenticate, so we treat it as fatal.
  // Every token entry carries `issued_at` metadata so a future
  // revokeTokens stamp can invalidate it without a per-key index.
  const refreshToken = `rt_${crypto.randomUUID().replace(/-/g, '')}`;
  const issuedAt = new Date().toISOString();
  try {
    await env.AUTH_KV.put(`token:${result.token}`, result.id, {
      metadata: { issued_at: issuedAt },
    });
    await env.AUTH_KV.put(`refresh:${refreshToken}`, result.id, {
      expirationTtl: 30 * 24 * 60 * 60,
      metadata: { issued_at: issuedAt },
    });
  } catch (err) {
    log.error('KV put failed during init', {
      error: err instanceof Error ? err.message : String(err),
    });
    return json({ error: 'Account created but token storage failed. Please retry.' }, 503);
  }

  auditLog('auth.account_created', {
    actor: result.handle,
    outcome: 'success',
    meta: { method: 'init' },
  });
  return json(
    {
      ok: true,
      handle: result.handle,
      color: result.color,
      token: result.token,
      refresh_token: refreshToken,
    },
    201,
  );
});

export const handleStats = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(request, env, 'stats', RATE_LIMIT_STATS_PER_IP, async () => {
    const [lobbyStats, dbStatsRaw] = await Promise.all([
      getLobby(env).getStats().then(rpc),
      getDB(env).getStats() as Promise<Record<string, unknown>>,
    ]);
    const { ok: _ok1, ...lobby } = lobbyStats;
    const dbStats = rpc(dbStatsRaw);
    const { ok: _ok2, ...dbData } = dbStats;
    return json({ ok: true, ...dbData, ...lobby });
  });
});

/**
 * Public pricing-health endpoint. Returns the freshness of the LiteLLM
 * snapshot chinmeister uses to compute costs, plus any recent failure reason.
 * Operators curl this to see if the 6h refresh cron is alive without
 * SSHing into DatabaseDO. Data is not sensitive — it's all about
 * publicly-sourced LiteLLM pricing, not user data.
 */
export const handlePricingHealth = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(request, env, 'pricing-health', RATE_LIMIT_STATS_PER_IP, async () => {
    const result = rpc(await getDB(env).getPricingMetadata());
    const metadata = result.metadata;

    if (!metadata) {
      return json({
        ok: true,
        has_data: false,
        fetched_at: null,
        source_sha: null,
        models_count: 0,
        last_attempt_at: null,
        last_failure_at: null,
        last_failure_reason: null,
        age_hours: null,
        is_stale: true,
      });
    }

    const fetchedAtMs = metadata.fetched_at ? Date.parse(metadata.fetched_at) : NaN;
    const ageMs = Number.isFinite(fetchedAtMs) ? Date.now() - fetchedAtMs : null;
    const ageHours = ageMs != null ? Math.round(ageMs / 3600000) : null;
    // 7-day staleness mirrors the PricingSnapshot.isStale semantics in
    // lib/pricing-cache.ts. Beyond that, the read path returns null costs
    // and the UI shows "Pricing data unavailable".
    const isStale = ageHours == null || ageHours > 24 * 7;

    return json({
      ok: true,
      has_data: true,
      fetched_at: metadata.fetched_at,
      source_sha: metadata.source_sha,
      models_count: metadata.models_count,
      last_attempt_at: metadata.last_attempt_at,
      last_failure_at: metadata.last_failure_at,
      last_failure_reason: metadata.last_failure_reason,
      age_hours: ageHours,
      is_stale: isStale,
    });
  });
});

export const handleToolCatalog = publicRoute(async ({ request, env }) => {
  return withIpRateLimit(request, env, 'catalog', RATE_LIMIT_CATALOG_PER_IP, async () => {
    const result = rpc(await getDB(env).listEvaluations({}));

    let tools;
    if (result.evaluations && result.evaluations.length > 0) {
      tools = (result.evaluations as unknown as Record<string, unknown>[]).map(
        evaluationToCatalogEntry,
      );
    } else {
      tools = TOOL_CATALOG;
    }

    const categories = await getCategoryNames(env);
    return json({ tools, categories }, 200, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
  });
});

// --- GitHub OAuth ---

export const handleGithubAuth = publicRoute(async ({ request, env }) => {
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) return json({ error: 'GitHub OAuth not configured' }, 500);

  const state = crypto.randomUUID();
  try {
    await env.AUTH_KV.put(`oauth_state:${state}`, '1', { expirationTtl: 600 });
  } catch (err) {
    log.error('KV put failed for OAuth state', {
      error: err instanceof Error ? err.message : String(err),
    });
    return json({ error: 'Failed to initiate OAuth flow. Please retry.' }, 503);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${new URL(request.url).origin}/auth/github/callback`,
    scope: 'read:user',
    state,
  });

  return Response.redirect(`${GITHUB_AUTHORIZE_URL}?${params}`, 302);
});

export const handleGithubCallback = publicRoute(async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    return Response.redirect(`${getDashboardUrl(env)}#error=github_denied`, 302);
  }
  if (!code || !state) {
    return Response.redirect(`${getDashboardUrl(env)}#error=github_invalid`, 302);
  }

  // Validate state to prevent CSRF
  const storedState = await env.AUTH_KV.get(`oauth_state:${state}`);
  if (!storedState) {
    return Response.redirect(`${getDashboardUrl(env)}#error=github_expired`, 302);
  }
  await env.AUTH_KV.delete(`oauth_state:${state}`);

  // Exchange code for GitHub access token
  const tokenRes = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${new URL(request.url).origin}/auth/github/callback`,
    }),
  });

  const tokenData: Record<string, unknown> = await tokenRes.json();
  if (tokenData.error || !tokenData.access_token) {
    return Response.redirect(`${getDashboardUrl(env)}#error=github_token_failed`, 302);
  }

  // Fetch GitHub user profile
  const userRes = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/json',
      'User-Agent': 'chinmeister',
    },
  });

  if (!userRes.ok) {
    return Response.redirect(`${getDashboardUrl(env)}#error=github_profile_failed`, 302);
  }

  const ghUser: Record<string, unknown> = await userRes.json();
  const githubId = String(ghUser.id);
  const githubLogin = (ghUser.login as string) || '';
  const avatarUrl = (ghUser.avatar_url as string) || null;

  const db = getDB(env);

  // Look up existing account by GitHub ID, or create new one
  const ghLookup = rpc(await db.getUserByGithubId(githubId));
  let userId: string;
  if ('error' in ghLookup) {
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) {
      return Response.redirect(`${getDashboardUrl(env)}#error=rate_limited`, 302);
    }
    const hashedCallbackIp = await hashIp(ip);
    const limit = rpc(await db.checkAndConsume(hashedCallbackIp, RATE_LIMIT_ACCOUNTS_PER_IP));
    if (!limit.allowed) {
      return Response.redirect(`${getDashboardUrl(env)}#error=rate_limited`, 302);
    }

    const created = rpc(await db.createUserFromGithub(githubId, githubLogin, avatarUrl));
    if ('error' in created) {
      return Response.redirect(`${getDashboardUrl(env)}#error=account_failed`, 302);
    }
    // Store the CLI token in KV (so the user could use it from CLI later)
    try {
      await env.AUTH_KV.put(`token:${created.token}`, created.id, {
        metadata: { issued_at: new Date().toISOString() },
      });
    } catch (err) {
      log.error('KV put failed for GitHub CLI token', {
        error: err instanceof Error ? err.message : String(err),
      });
      return Response.redirect(`${getDashboardUrl(env)}#error=account_failed`, 302);
    }
    userId = created.id;
    auditLog('auth.account_created', {
      actor: githubLogin,
      outcome: 'success',
      meta: { method: 'github' },
    });
  } else {
    userId = ghLookup.user.id;
    auditLog('auth.github_login', { actor: githubLogin, outcome: 'success' });
  }

  // Create a web session token
  const userAgent = request.headers.get('User-Agent') || null;
  const session = rpc(await db.createWebSession(userId, userAgent));

  // Store session token in KV with 30-day TTL
  try {
    await env.AUTH_KV.put(`token:${session.token}`, userId, {
      expirationTtl: 30 * 24 * 60 * 60,
      metadata: { issued_at: new Date().toISOString() },
    });
  } catch (err) {
    log.error('KV put failed for web session token', {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.redirect(`${getDashboardUrl(env)}#error=account_failed`, 302);
  }

  return Response.redirect(`${getDashboardUrl(env)}#token=${session.token}`, 302);
});

export const handleGithubLink = authedRoute(async ({ request, user, env }) => {
  // This initiates the link flow — redirects to GitHub with user ID in state
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) return json({ error: 'GitHub OAuth not configured' }, 500);

  const state = `link:${user.id}:${crypto.randomUUID()}`;
  try {
    await env.AUTH_KV.put(`oauth_state:${state}`, user.id, { expirationTtl: 600 });
  } catch (err) {
    log.error('KV put failed for GitHub link state', {
      error: err instanceof Error ? err.message : String(err),
    });
    return json({ error: 'Failed to initiate GitHub link flow. Please retry.' }, 503);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${new URL(request.url).origin}/auth/github/callback/link`,
    scope: 'read:user',
    state,
  });

  return json({ url: `${GITHUB_AUTHORIZE_URL}?${params}` });
});

export const handleGithubLinkCallback = publicRoute(async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return Response.redirect(`${getDashboardUrl(env)}#error=github_invalid`, 302);
  }

  // Validate state and extract user ID
  const storedUserId = await env.AUTH_KV.get(`oauth_state:${state}`);
  if (!storedUserId) {
    return Response.redirect(`${getDashboardUrl(env)}#error=github_expired`, 302);
  }
  await env.AUTH_KV.delete(`oauth_state:${state}`);

  // Exchange code for GitHub access token
  const tokenRes = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${new URL(request.url).origin}/auth/github/callback/link`,
    }),
  });

  const tokenData: Record<string, unknown> = await tokenRes.json();
  if (tokenData.error || !tokenData.access_token) {
    return Response.redirect(`${getDashboardUrl(env)}#error=github_token_failed`, 302);
  }

  // Fetch GitHub profile
  const userRes = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/json',
      'User-Agent': 'chinmeister',
    },
  });

  if (!userRes.ok) {
    return Response.redirect(`${getDashboardUrl(env)}#error=github_profile_failed`, 302);
  }

  const ghUser: Record<string, unknown> = await userRes.json();
  const db = getDB(env);

  const result = rpc(
    await db.linkGithub(
      storedUserId,
      String(ghUser.id),
      (ghUser.login as string) || '',
      (ghUser.avatar_url as string) || null,
    ),
  );
  if ('error' in result) {
    return Response.redirect(`${getDashboardUrl(env)}#error=github_already_linked`, 302);
  }

  return Response.redirect(`${getDashboardUrl(env)}#github_linked=1`, 302);
});

/**
 * All `auth: false` routes. Registration order is preserved so parametric
 * route matching priority does not shift; do not reorder entries without
 * checking the matcher in lib/router.ts.
 */
export function registerPublicRoutes(): RouteDefinition[] {
  return [
    { method: 'POST', path: '/auth/init', handler: handleInit, auth: false },
    { method: 'POST', path: '/auth/refresh', handler: handleRefreshToken, auth: false },
    { method: 'GET', path: '/stats', handler: handleStats, auth: false },
    { method: 'GET', path: '/pricing-health', handler: handlePricingHealth, auth: false },
    { method: 'GET', path: '/tools/catalog', handler: handleToolCatalog, auth: false },
    { method: 'GET', path: '/tools/directory', handler: handleListDirectory, auth: false },
    { method: 'GET', path: '/tools/categories', handler: handleGetCategories, auth: false },
    { method: 'POST', path: '/tools/categories', handler: handlePromoteCategory, auth: false },
    { method: 'GET', path: '/tools/icon/:id', handler: handleGetIcon, auth: false },
    {
      method: 'POST',
      path: '/tools/batch-resolve-icons',
      handler: handleBatchResolveIcons,
      auth: false,
    },
    {
      method: 'POST',
      path: '/tools/batch-extract-colors',
      handler: handleBatchExtractColors,
      auth: false,
    },
    { method: 'POST', path: '/tools/admin-import', handler: handleAdminImport, auth: false },
    { method: 'POST', path: '/tools/admin-delete', handler: handleAdminDelete, auth: false },
    { method: 'GET', path: '/tools/directory/stats', handler: handleDirectoryStats, auth: false },
    { method: 'GET', path: '/tools/directory/:id', handler: handleGetDirectoryEntry, auth: false },
    {
      method: 'POST',
      path: '/tools/directory/:id/report-stale',
      handler: handleReportStale,
      auth: false,
    },
    { method: 'GET', path: '/tools/suggestions', handler: handleListSuggestions, auth: false },
    {
      method: 'POST',
      path: '/tools/suggestions/:id/review',
      handler: handleReviewSuggestion,
      auth: false,
    },
    { method: 'GET', path: '/auth/github', handler: handleGithubAuth, auth: false },
    { method: 'GET', path: '/auth/github/callback', handler: handleGithubCallback, auth: false },
    {
      method: 'GET',
      path: '/auth/github/callback/link',
      handler: handleGithubLinkCallback,
      auth: false,
    },
  ];
}
