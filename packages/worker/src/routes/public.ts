import type { Env, User } from '../types.js';
import { resolveRuntimeTargets } from '@chinwag/shared/runtime-profile.js';
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
  const refreshToken = `rt_${crypto.randomUUID().replace(/-/g, '')}`;
  try {
    await env.AUTH_KV.put(`token:${result.token}`, result.id);
    await env.AUTH_KV.put(`refresh:${refreshToken}`, result.id, {
      expirationTtl: 30 * 24 * 60 * 60,
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
    const [lobbyStats, dbStats] = await Promise.all([
      getLobby(env).getStats().then(rpc),
      getDB(env).getStats().then(rpc),
    ]);
    const { ok: _ok1, ...lobby } = lobbyStats;
    const { ok: _ok2, ...dbData } = dbStats;
    return json({ ok: true, ...dbData, ...lobby });
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
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
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
      'User-Agent': 'chinwag',
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
      await env.AUTH_KV.put(`token:${created.token}`, created.id);
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
      'User-Agent': 'chinwag',
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
