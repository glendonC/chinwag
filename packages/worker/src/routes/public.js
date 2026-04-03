import { TOOL_CATALOG, CATEGORY_NAMES } from '../catalog.js';
import { getDB, getLobby } from '../lib/env.js';
import { json } from '../lib/http.js';
import { auditLog } from '../lib/audit.js';
import { safeParse } from '../lib/safe-parse.js';
import { hashIp, withIpRateLimit } from '../lib/validation.js';
import {
  RATE_LIMIT_ACCOUNTS_PER_IP,
  RATE_LIMIT_STATS_PER_IP,
  RATE_LIMIT_CATALOG_PER_IP,
} from '../lib/constants.js';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

function getDashboardUrl(env) {
  return (env.DASHBOARD_URL || 'https://chinwag.dev') + '/dashboard';
}

function evaluationToCatalogEntry(e) {
  let metadata = e.metadata || {};
  if (typeof metadata === 'string') {
    metadata = safeParse(metadata, `evaluationToCatalogEntry tool=${e.tool_id} metadata`, {});
  }
  return {
    id: e.tool_id,
    name: e.name,
    description: e.tagline || '',
    category: e.category || 'uncategorized',
    website: metadata.website || null,
    installCmd: metadata.installCmd || null,
    mcpCompatible: !!e.mcp_support,
    featured: !!metadata.featured,
  };
}

export async function handleInit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return json({ error: 'Unable to identify client' }, 400);
  const hashedIp = await hashIp(ip);
  const db = getDB(env);

  // Atomic check-and-consume eliminates the race window between check and consume
  const limit = await db.checkAndConsume(hashedIp, RATE_LIMIT_ACCOUNTS_PER_IP);
  if (!limit.allowed) {
    return json({ error: 'Too many accounts created recently. Try again later.' }, 429);
  }

  const result = await db.createUser();
  if (result.error) {
    return json({ error: result.error }, 400);
  }
  await env.AUTH_KV.put(`token:${result.token}`, result.id);

  // Issue a refresh token alongside the access token
  const refreshToken = `rt_${crypto.randomUUID().replace(/-/g, '')}`;
  await env.AUTH_KV.put(`refresh:${refreshToken}`, result.id, { expirationTtl: 30 * 24 * 60 * 60 });

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
}

export async function handleStats(request, env) {
  return withIpRateLimit(request, env, 'stats', RATE_LIMIT_STATS_PER_IP, async () => {
    const [lobbyStats, dbStats] = await Promise.all([
      getLobby(env).getStats(),
      getDB(env).getStats(),
    ]);
    const { ok: _ok1, ...lobby } = lobbyStats;
    const { ok: _ok2, ...dbData } = dbStats;
    return json({ ok: true, ...dbData, ...lobby });
  });
}

export async function handleToolCatalog(request, env) {
  return withIpRateLimit(request, env, 'catalog', RATE_LIMIT_CATALOG_PER_IP, async () => {
    const result = await getDB(env).listEvaluations({});

    let tools;
    if (result.evaluations && result.evaluations.length > 0) {
      tools = result.evaluations.map(evaluationToCatalogEntry);
    } else {
      tools = TOOL_CATALOG;
    }

    return json({ tools, categories: CATEGORY_NAMES }, 200, {
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    });
  });
}

// --- GitHub OAuth ---

export async function handleGithubAuth(request, env) {
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) return json({ error: 'GitHub OAuth not configured' }, 500);

  const state = crypto.randomUUID();
  await env.AUTH_KV.put(`oauth_state:${state}`, '1', { expirationTtl: 600 });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${new URL(request.url).origin}/auth/github/callback`,
    scope: 'read:user',
    state,
  });

  return Response.redirect(`${GITHUB_AUTHORIZE_URL}?${params}`, 302);
}

export async function handleGithubCallback(request, env) {
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

  const tokenData = await tokenRes.json();
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

  const ghUser = await userRes.json();
  const githubId = String(ghUser.id);
  const githubLogin = ghUser.login || '';
  const avatarUrl = ghUser.avatar_url || null;

  const db = getDB(env);

  // Look up existing account by GitHub ID, or create new one
  const ghLookup = await db.getUserByGithubId(githubId);
  let userId;
  if (!ghLookup.ok) {
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) {
      return Response.redirect(`${getDashboardUrl(env)}#error=rate_limited`, 302);
    }
    const hashedCallbackIp = await hashIp(ip);
    const limit = await db.checkAndConsume(hashedCallbackIp, RATE_LIMIT_ACCOUNTS_PER_IP);
    if (!limit.allowed) {
      return Response.redirect(`${getDashboardUrl(env)}#error=rate_limited`, 302);
    }

    const created = await db.createUserFromGithub(githubId, githubLogin, avatarUrl);
    if (created.error) {
      return Response.redirect(`${getDashboardUrl(env)}#error=account_failed`, 302);
    }
    // Store the CLI token in KV (so the user could use it from CLI later)
    await env.AUTH_KV.put(`token:${created.token}`, created.id);
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
  const session = await db.createWebSession(userId, userAgent);

  if (session.error) {
    return Response.redirect(`${getDashboardUrl(env)}#error=session_failed`, 302);
  }

  // Store session token in KV with 30-day TTL
  await env.AUTH_KV.put(`token:${session.token}`, userId, {
    expirationTtl: 30 * 24 * 60 * 60,
  });

  return Response.redirect(`${getDashboardUrl(env)}#token=${session.token}`, 302);
}

export async function handleGithubLink(request, user, env) {
  // This initiates the link flow — redirects to GitHub with user ID in state
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) return json({ error: 'GitHub OAuth not configured' }, 500);

  const state = `link:${user.id}:${crypto.randomUUID()}`;
  await env.AUTH_KV.put(`oauth_state:${state}`, user.id, { expirationTtl: 600 });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${new URL(request.url).origin}/auth/github/callback/link`,
    scope: 'read:user',
    state,
  });

  return json({ url: `${GITHUB_AUTHORIZE_URL}?${params}` });
}

export async function handleGithubLinkCallback(request, env) {
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

  const tokenData = await tokenRes.json();
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

  const ghUser = await userRes.json();
  const db = getDB(env);

  const result = await db.linkGithub(
    storedUserId,
    String(ghUser.id),
    ghUser.login,
    ghUser.avatar_url,
  );
  if (result.error) {
    return Response.redirect(`${getDashboardUrl(env)}#error=github_already_linked`, 302);
  }

  return Response.redirect(`${getDashboardUrl(env)}#github_linked=1`, 302);
}
