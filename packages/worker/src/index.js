// Worker entry point — HTTP routing, auth, and request handling.
// Uses DO RPC for all Durable Object communication.
// Auth flow: Bearer token → KV lookup → user_id → DO.getUser(id)

import { checkContent, isBlocked } from './moderation.js';
import { VALID_CATEGORIES } from './team.js';
import { TOOL_CATALOG, CATEGORY_NAMES } from './catalog.js';

export { DatabaseDO } from './db.js';
export { LobbyDO } from './lobby.js';
export { RoomDO } from './room.js';
export { TeamDO } from './team.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    const PROD_ORIGINS = ['https://chinwag.dev', 'https://www.chinwag.dev'];
    const DEV_ORIGINS = ['http://localhost:8788', 'http://localhost:3000', 'http://127.0.0.1:8788'];
    // Local static dashboard (dev-server.mjs / serve.py default PORT) may call the deployed API.
    const LOCAL_WEB_ORIGINS = ['http://localhost:56790', 'http://127.0.0.1:56790'];
    const ALLOWED_ORIGINS = env.ENVIRONMENT === 'production'
      ? [...PROD_ORIGINS, ...LOCAL_WEB_ORIGINS]
      : [...PROD_ORIGINS, ...DEV_ORIGINS, ...LOCAL_WEB_ORIGINS];
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : 'https://chinwag.dev',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      let response;

      // Public routes
      if (method === 'POST' && path === '/auth/init') {
        response = await handleInit(request, env);
      } else if (method === 'GET' && path === '/stats') {
        response = await handleStats(env);
      } else if (method === 'GET' && path === '/tools/catalog') {
        response = handleToolCatalog();
      }
      // Authenticated routes
      else {
        const user = await authenticate(request, env);
        if (!user) {
          return json({ error: 'Unauthorized' }, 401, corsHeaders);
        }

        if (method === 'GET' && path === '/me') {
          const { id, ...profile } = user;
          response = json(profile);
        } else if (method === 'GET' && path === '/me/teams') {
          response = await handleGetUserTeams(user, env);
        } else if (method === 'GET' && path === '/me/dashboard') {
          response = await handleDashboardSummary(user, env);
        } else if (method === 'POST' && path === '/presence/heartbeat') {
          response = await handleHeartbeat(user, env);
        } else if (method === 'PUT' && path === '/me/handle') {
          response = await handleUpdateHandle(request, user, env);
        } else if (method === 'PUT' && path === '/me/color') {
          response = await handleUpdateColor(request, user, env);
        } else if (method === 'PUT' && path === '/status') {
          response = await handleSetStatus(request, user, env);
        } else if (method === 'DELETE' && path === '/status') {
          response = await handleClearStatus(user, env);
        } else if (method === 'GET' && path === '/ws/chat') {
          return await handleChatUpgrade(request, user, env);
        }
        // Agent profile routes
        else if (method === 'PUT' && path === '/agent/profile') {
          response = await handleUpdateAgentProfile(request, user, env);
        }
        // Team routes
        else if (method === 'POST' && path === '/teams') {
          response = await handleCreateTeam(request, user, env);
        } else if (path.startsWith('/teams/')) {
          const parsed = parseTeamPath(path);
          if (!parsed) {
            response = json({ error: 'Not found' }, 404);
          } else if (method === 'POST' && parsed.action === 'join') {
            response = await handleTeamJoin(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'leave') {
            response = await handleTeamLeave(request, user, env, parsed.teamId);
          } else if (method === 'GET' && parsed.action === 'context') {
            response = await handleTeamContext(request, user, env, parsed.teamId);
          } else if (method === 'PUT' && parsed.action === 'activity') {
            response = await handleTeamActivity(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'conflicts') {
            response = await handleTeamConflicts(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'heartbeat') {
            response = await handleTeamHeartbeat(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'file') {
            response = await handleTeamFile(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'memory') {
            response = await handleTeamSaveMemory(request, user, env, parsed.teamId);
          } else if (method === 'GET' && parsed.action === 'memory') {
            response = await handleTeamSearchMemory(request, user, env, parsed.teamId);
          } else if (method === 'PUT' && parsed.action === 'memory') {
            response = await handleTeamUpdateMemory(request, user, env, parsed.teamId);
          } else if (method === 'DELETE' && parsed.action === 'memory') {
            response = await handleTeamDeleteMemory(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'locks') {
            response = await handleTeamClaimFiles(request, user, env, parsed.teamId);
          } else if (method === 'DELETE' && parsed.action === 'locks') {
            response = await handleTeamReleaseFiles(request, user, env, parsed.teamId);
          } else if (method === 'GET' && parsed.action === 'locks') {
            response = await handleTeamGetLocks(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'messages') {
            response = await handleTeamSendMessage(request, user, env, parsed.teamId);
          } else if (method === 'GET' && parsed.action === 'messages') {
            response = await handleTeamGetMessages(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'sessions') {
            response = await handleTeamStartSession(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'sessionend') {
            response = await handleTeamEndSession(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'sessionedit') {
            response = await handleTeamSessionEdit(request, user, env, parsed.teamId);
          } else if (method === 'GET' && parsed.action === 'history') {
            response = await handleTeamHistory(request, user, env, parsed.teamId);
          } else {
            response = json({ error: 'Not found' }, 404);
          }
        } else {
          response = json({ error: 'Not found' }, 404);
        }
      }

      // Attach CORS headers
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(corsHeaders)) {
        headers.set(k, v);
      }
      return new Response(response.body, { status: response.status, headers });
    } catch (err) {
      const ref = crypto.randomUUID().slice(0, 8);
      console.error(`Request error (ref: ${ref}):`, err);
      return json({ error: `Internal server error (ref: ${ref})` }, 500, corsHeaders);
    }
  },
};

// --- Auth ---

async function authenticate(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);

  // KV stores token → user_id
  let userId = await env.AUTH_KV.get(`token:${token}`);

  if (!userId) return null;

  const db = getDB(env);

  // Lazy migration: if KV value is a handle (not a UUID), look up by handle and update KV
  if (!userId.includes('-')) {
    const user = await db.getUserByHandle(userId);
    if (!user) return null;
    // Update KV to store user_id instead of handle
    await env.AUTH_KV.put(`token:${token}`, user.id);
    return user;
  }

  return await db.getUser(userId);
}

// --- Route handlers ---

async function handleInit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const db = getDB(env);

  // IP-based account creation limit (3 per day)
  // Check first, consume after success — failed creates don't waste credits.
  const limit = await db.checkRateLimit(ip, 3);
  if (!limit.allowed) {
    return json({ error: 'Too many accounts created today. Try again tomorrow.' }, 429);
  }

  const user = await db.createUser();
  if (user.error) {
    return json({ error: user.error }, 400);
  }

  await db.consumeRateLimit(ip);

  // Store token → user_id in KV
  await env.AUTH_KV.put(`token:${user.token}`, user.id);

  return json({ handle: user.handle, color: user.color, token: user.token }, 201);
}

async function handleUpdateHandle(request, user, env) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { handle } = body;
  if (!handle || typeof handle !== 'string') {
    return json({ error: 'Handle is required' }, 400);
  }

  const db = getDB(env);
  const result = await db.updateHandle(user.id, handle);

  if (result.error) {
    return json({ error: result.error }, 400);
  }

  // No KV update needed — KV maps token → user_id, not handle
  return json(result);
}

async function handleUpdateColor(request, user, env) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { color } = body;
  if (!color || typeof color !== 'string') {
    return json({ error: 'Color is required' }, 400);
  }

  const db = getDB(env);
  const result = await db.updateColor(user.id, color);

  if (result.error) {
    return json({ error: result.error }, 400);
  }
  return json(result);
}

async function handleSetStatus(request, user, env) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { status } = body;
  if (!status || typeof status !== 'string') {
    return json({ error: 'Status is required' }, 400);
  }
  if (status.length > 280) {
    return json({ error: 'Status must be 280 characters or less' }, 400);
  }

  const modResult = await checkContent(status, env);
  if (modResult.blocked) {
    return json({ error: 'Status blocked by content filter. Please revise.' }, 400);
  }

  const db = getDB(env);
  await db.setStatus(user.id, status);
  return json({ ok: true });
}

async function handleClearStatus(user, env) {
  const db = getDB(env);
  await db.setStatus(user.id, null);
  return json({ ok: true });
}

async function handleHeartbeat(user, env) {
  const lobby = getLobby(env);
  await lobby.heartbeat(user.handle);
  return json({ ok: true });
}

async function handleStats(env) {
  const [lobbyStats, dbStats] = await Promise.all([
    getLobby(env).getStats(),
    getDB(env).getStats(),
  ]);
  return json({ ...dbStats, ...lobbyStats });
}

async function handleChatUpgrade(request, user, env) {
  // New accounts must wait 5 minutes before joining chat
  const CHAT_COOLDOWN_MS = 5 * 60 * 1000;
  const accountAge = Date.now() - new Date(user.created_at).getTime();
  if (accountAge < CHAT_COOLDOWN_MS) {
    const secsLeft = Math.ceil((CHAT_COOLDOWN_MS - accountAge) / 1000);
    return json(
      { error: `New accounts must wait before joining chat. ${secsLeft}s remaining.` },
      429
    );
  }

  const lobby = getLobby(env);
  const shuffle = new URL(request.url).searchParams.get('shuffle') === '1';

  const { roomId } = await lobby.assignRoom(user.handle, shuffle);

  // Forward WebSocket upgrade to the assigned Room DO
  const roomStub = env.ROOM.get(env.ROOM.idFromName(roomId));
  const roomUrl = new URL(request.url);
  roomUrl.pathname = '/ws';
  roomUrl.searchParams.set('handle', user.handle);
  roomUrl.searchParams.set('color', user.color);
  roomUrl.searchParams.set('roomId', roomId);

  return roomStub.fetch(new Request(roomUrl.toString(), {
    headers: {
      'X-Chinwag-Verified': '1',
      Upgrade: request.headers.get('Upgrade'),
      Connection: request.headers.get('Connection'),
      'Sec-WebSocket-Key': request.headers.get('Sec-WebSocket-Key'),
      'Sec-WebSocket-Protocol': request.headers.get('Sec-WebSocket-Protocol'),
      'Sec-WebSocket-Version': request.headers.get('Sec-WebSocket-Version'),
    },
  }));
}

// --- Agent identity helpers ---

// Extract agent_id from X-Agent-Id header; fall back to user.id for backward compat.
function getAgentId(request, user) {
  const agentId = request.headers.get('X-Agent-Id');
  if (agentId && typeof agentId === 'string' && agentId.length > 0 && agentId.length <= 60) {
    return agentId;
  }
  return user.id;
}

// Parse tool name from agent_id format "tool:hash". Returns 'unknown' for bare UUIDs.
export function getToolFromAgentId(agentId) {
  const idx = agentId.indexOf(':');
  return idx > 0 ? agentId.slice(0, idx) : 'unknown';
}

// --- Agent & Team handlers ---

async function handleUpdateAgentProfile(request, user, env) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);

  // Validate profile shape — only accept known fields, arrays of strings
  const profile = {
    framework: typeof body.framework === 'string' ? body.framework.slice(0, 50) : null,
    languages: sanitizeTags(body.languages),
    frameworks: sanitizeTags(body.frameworks),
    tools: sanitizeTags(body.tools),
    platforms: sanitizeTags(body.platforms),
  };

  const db = getDB(env);
  const result = await db.updateAgentProfile(user.id, profile);
  if (result.error) return json({ error: result.error }, 400);
  return json(result);
}

export function sanitizeTags(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(t => typeof t === 'string')
    .map(t => t.slice(0, 50).toLowerCase().trim())
    .filter(Boolean)
    .slice(0, 50);
}

async function handleGetUserTeams(user, env) {
  const db = getDB(env);
  const teams = await db.getUserTeams(user.id);
  return json({ teams });
}

async function handleDashboardSummary(user, env) {
  const db = getDB(env);
  const teams = await db.getUserTeams(user.id);

  if (teams.length === 0) {
    return json({ teams: [] });
  }

  // Fan out to TeamDOs in parallel — cap at 25 to limit subrequest count
  const capped = teams.slice(0, 25);
  const results = await Promise.allSettled(
    capped.map(async (t) => {
      const team = getTeam(env, t.team_id);
      try {
        const summary = await team.getSummary(user.id, user.id);
        if (summary.error) {
          // Reconcile: remove stale user_teams entries for teams where membership was lost
          try { await db.removeUserTeam(user.id, t.team_id); } catch {}
          return null;
        }
        return {
          team_id: t.team_id,
          team_name: t.team_name,
          ...summary,
        };
      } catch {
        return null;
      }
    })
  );

  return json({
    teams: results
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value),
  });
}

async function handleCreateTeam(request, user, env) {
  let name = null;
  try {
    const body = await request.json();
    name = typeof body.name === 'string' ? body.name.slice(0, 100).trim() || null : null;
  } catch { /* no body is fine */ }

  const db = getDB(env);
  const limit = await db.checkRateLimit(`team:${user.id}`, 5);
  if (!limit.allowed) {
    return json({ error: 'Team creation limit reached. Try again tomorrow.' }, 429);
  }

  const agentId = getAgentId(request, user);
  const tool = getToolFromAgentId(agentId);
  const teamId = 't_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const team = getTeam(env, teamId);
  await team.join(agentId, user.id, user.handle, tool);

  // user_teams is a denormalized index — TeamDO membership is authoritative.
  // If this fails, lazy backfill in getContext will catch it.
  try { await db.addUserTeam(user.id, teamId, name); } catch {}
  await db.consumeRateLimit(`team:${user.id}`);

  return json({ team_id: teamId }, 201);
}

async function handleTeamJoin(request, user, env, teamId) {
  let name = null;
  try {
    const body = await request.json();
    name = typeof body.name === 'string' ? body.name.slice(0, 100).trim() || null : null;
  } catch { /* no body is fine */ }

  const agentId = getAgentId(request, user);
  const tool = getToolFromAgentId(agentId);
  const team = getTeam(env, teamId);
  const result = await team.join(agentId, user.id, user.handle, tool);
  if (result.error) return json({ error: result.error }, 400);

  // Sync denormalized index — TeamDO is authoritative, so don't fail on this.
  const db = getDB(env);
  try { await db.addUserTeam(user.id, teamId, name); } catch {}

  return json(result);
}

async function handleTeamLeave(request, user, env, teamId) {
  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.leave(agentId, user.id);
  if (result.error) return json({ error: result.error }, 400);

  const db = getDB(env);
  try { await db.removeUserTeam(user.id, teamId); } catch {}

  return json(result);
}

async function handleTeamContext(request, user, env, teamId) {
  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getContext(agentId, user.id);
  if (result.error) return json({ error: result.error }, 403);

  // Lazy backfill: if user is a member (getContext succeeded), ensure user_teams
  // has the entry. Covers users who joined before user_teams existed.
  const db = getDB(env);
  try { await db.addUserTeam(user.id, teamId); } catch {}

  return json(result);
}

async function handleTeamActivity(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { files, summary } = body;
  if (!Array.isArray(files) || files.length === 0) return json({ error: 'files must be a non-empty array' }, 400);
  if (files.length > 50) return json({ error: 'too many files (max 50)' }, 400);
  if (files.some(f => typeof f !== 'string' || f.length > 500)) return json({ error: 'invalid file path' }, 400);
  if (typeof summary !== 'string') return json({ error: 'summary must be a string' }, 400);
  if (summary.length > 280) return json({ error: 'summary must be 280 characters or less' }, 400);
  if (summary && isBlocked(summary)) return json({ error: 'Content blocked' }, 400);

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.updateActivity(agentId, files, summary, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

async function handleTeamConflicts(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { files } = body;
  if (!Array.isArray(files) || files.length === 0) return json({ error: 'files must be a non-empty array' }, 400);
  if (files.length > 50) return json({ error: 'too many files (max 50)' }, 400);
  if (files.some(f => typeof f !== 'string' || f.length > 500)) return json({ error: 'invalid file path' }, 400);

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.checkConflicts(agentId, files, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

async function handleTeamHeartbeat(request, user, env, teamId) {
  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.heartbeat(agentId, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

async function handleTeamFile(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { file } = body;
  if (typeof file !== 'string' || !file.trim()) {
    return json({ error: 'file must be a non-empty string' }, 400);
  }
  if (file.length > 500) {
    return json({ error: 'file path too long' }, 400);
  }

  const db = getDB(env);
  const fileLimit = await db.checkRateLimit(`file:${user.id}`, 500);
  if (!fileLimit.allowed) return json({ error: 'File report limit reached (500/day). Try again tomorrow.' }, 429);

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.reportFile(agentId, file, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  await db.consumeRateLimit(`file:${user.id}`);
  return json(result);
}

async function handleTeamSaveMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { text, category } = body;
  if (typeof text !== 'string' || !text.trim()) {
    return json({ error: 'text is required' }, 400);
  }
  if (text.length > 2000) {
    return json({ error: 'text must be 2000 characters or less' }, 400);
  }
  if (isBlocked(text)) return json({ error: 'Content blocked' }, 400);
  if (!VALID_CATEGORIES.includes(category)) {
    return json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }, 400);
  }

  // Rate limit: 20 memory saves per user per day.
  // Check first, consume after success.
  const db = getDB(env);
  const memLimit = await db.checkRateLimit(`memory:${user.id}`, 20);
  if (!memLimit.allowed) {
    return json({ error: 'Memory save limit reached (20/day). Try again tomorrow.' }, 429);
  }

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.saveMemory(agentId, text.trim(), category, user.handle, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));

  await db.consumeRateLimit(`memory:${user.id}`);
  return json(result, 201);
}

async function handleTeamSearchMemory(request, user, env, teamId) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') || null;
  const category = url.searchParams.get('category') || null;
  const parsedLimit = parseInt(url.searchParams.get('limit') || '20', 10);
  const limit = Math.max(1, Math.min(isNaN(parsedLimit) ? 20 : parsedLimit, 50));

  if (category && !VALID_CATEGORIES.includes(category)) {
    return json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }, 400);
  }

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.searchMemories(agentId, query, category, limit, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

async function handleTeamUpdateMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { id, text, category } = body;
  if (typeof id !== 'string' || !id.trim()) {
    return json({ error: 'id is required' }, 400);
  }
  if (text !== undefined && (typeof text !== 'string' || !text.trim())) {
    return json({ error: 'text must be a non-empty string' }, 400);
  }
  if (text !== undefined && text.length > 2000) {
    return json({ error: 'text must be 2000 characters or less' }, 400);
  }
  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    return json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }, 400);
  }
  if (text === undefined && category === undefined) {
    return json({ error: 'text or category required' }, 400);
  }

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.updateMemory(agentId, id, text, category, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

async function handleTeamDeleteMemory(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { id } = body;
  if (typeof id !== 'string' || !id.trim()) {
    return json({ error: 'id is required' }, 400);
  }

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.deleteMemory(agentId, id, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

async function handleTeamClaimFiles(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { files } = body;
  if (!Array.isArray(files) || files.length === 0) return json({ error: 'files must be a non-empty array' }, 400);
  if (files.length > 20) return json({ error: 'too many files (max 20)' }, 400);
  if (files.some(f => typeof f !== 'string' || f.length > 500)) return json({ error: 'invalid file path' }, 400);

  const db = getDB(env);
  const lockLimit = await db.checkRateLimit(`locks:${user.id}`, 100);
  if (!lockLimit.allowed) return json({ error: 'Lock claim limit reached (100/day). Try again tomorrow.' }, 429);

  const agentId = getAgentId(request, user);
  const tool = getToolFromAgentId(agentId);
  const team = getTeam(env, teamId);
  const result = await team.claimFiles(agentId, files, user.handle, tool, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  await db.consumeRateLimit(`locks:${user.id}`);
  return json(result);
}

async function handleTeamReleaseFiles(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const files = body.files || null;
  if (files !== null && !Array.isArray(files)) return json({ error: 'files must be an array' }, 400);
  if (files && files.some(f => typeof f !== 'string' || f.length > 500)) return json({ error: 'invalid file path' }, 400);

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.releaseFiles(agentId, files, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

async function handleTeamGetLocks(request, user, env, teamId) {
  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getLockedFiles(agentId, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

async function handleTeamSendMessage(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { text, target } = body;
  if (typeof text !== 'string' || !text.trim()) return json({ error: 'text is required' }, 400);
  if (text.length > 500) return json({ error: 'text must be 500 characters or less' }, 400);
  if (isBlocked(text)) return json({ error: 'Content blocked' }, 400);
  if (target !== undefined && typeof target !== 'string') return json({ error: 'target must be a string' }, 400);

  const db = getDB(env);
  const msgLimit = await db.checkRateLimit(`messages:${user.id}`, 200);
  if (!msgLimit.allowed) return json({ error: 'Message limit reached (200/day). Try again tomorrow.' }, 429);

  const agentId = getAgentId(request, user);
  const tool = getToolFromAgentId(agentId);
  const team = getTeam(env, teamId);
  const result = await team.sendMessage(agentId, user.handle, tool, text.trim(), target || null, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  await db.consumeRateLimit(`messages:${user.id}`);
  return json(result, 201);
}

async function handleTeamGetMessages(request, user, env, teamId) {
  const url = new URL(request.url);
  const since = url.searchParams.get('since') || null;

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getMessages(agentId, since, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

async function handleTeamStartSession(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const framework = typeof body.framework === 'string' ? body.framework.slice(0, 50) : 'unknown';

  const db = getDB(env);
  const limit = await db.checkRateLimit(`session:${user.id}`, 50);
  if (!limit.allowed) return json({ error: 'Session limit reached. Try again tomorrow.' }, 429);

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.startSession(agentId, user.handle, framework, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));

  await db.consumeRateLimit(`session:${user.id}`);
  return json(result, 201);
}

async function handleTeamEndSession(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { session_id } = body;
  if (typeof session_id !== 'string') {
    return json({ error: 'session_id is required' }, 400);
  }

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.endSession(agentId, session_id, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  return json(result);
}

async function handleTeamSessionEdit(request, user, env, teamId) {
  const body = await parseBody(request);
  if (body._parseError) return json({ error: body._parseError }, 400);
  const { file } = body;
  if (typeof file !== 'string' || !file.trim()) {
    return json({ error: 'file is required' }, 400);
  }
  if (file.length > 500) return json({ error: 'file path too long' }, 400);

  const db = getDB(env);
  const editLimit = await db.checkRateLimit(`edit:${user.id}`, 1000);
  if (!editLimit.allowed) return json({ error: 'Edit recording limit reached. Try again tomorrow.' }, 429);

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.recordEdit(agentId, file, user.id);
  if (result.error) return json({ error: result.error }, teamErrorStatus(result.error));
  await db.consumeRateLimit(`edit:${user.id}`);
  return json(result);
}

async function handleTeamHistory(request, user, env, teamId) {
  const url = new URL(request.url);
  const parsed = parseInt(url.searchParams.get('days') || '7', 10);
  const days = Math.max(1, Math.min(isNaN(parsed) ? 7 : parsed, 30));

  const agentId = getAgentId(request, user);
  const team = getTeam(env, teamId);
  const result = await team.getHistory(agentId, days, user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

function handleToolCatalog() {
  return json({ tools: TOOL_CATALOG, categories: CATEGORY_NAMES }, 200, {
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
  });
}

// --- Helpers ---

function getDB(env) {
  return env.DATABASE.get(env.DATABASE.idFromName('main'));
}

function getLobby(env) {
  return env.LOBBY.get(env.LOBBY.idFromName('main'));
}

function getTeam(env, teamId) {
  return env.TEAM.get(env.TEAM.idFromName(teamId));
}

export function parseTeamPath(path) {
  // Team IDs are t_ + 16 hex chars. Accept that format only.
  const match = path.match(/^\/teams\/(t_[a-f0-9]{16})\/([a-z]+)$/);
  if (!match) return null;
  return { teamId: match[1], action: match[2] };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

const MAX_BODY_SIZE = 50_000;

async function parseBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return { _parseError: 'Content-Type must be application/json' };
  }
  let raw;
  try { raw = await request.text(); } catch { return { _parseError: 'Could not read body' }; }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_SIZE) {
    return { _parseError: 'Request body too large' };
  }
  try { return JSON.parse(raw); } catch { return { _parseError: 'Invalid JSON body' }; }
}

export function teamErrorStatus(msg) {
  return msg?.includes('Not a member') ? 403 : 400;
}
