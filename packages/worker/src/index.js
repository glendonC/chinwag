// Worker entry point — HTTP routing, auth, and request handling.
// Uses DO RPC for all Durable Object communication.
// Auth flow: Bearer token → KV lookup → user_id → DO.getUser(id)

import { checkContent } from './moderation.js';

export { DatabaseDO } from './db.js';
export { LobbyDO } from './lobby.js';
export { RoomDO } from './room.js';
export { TeamDO } from './team.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
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
      }
      // Authenticated routes
      else {
        const user = await authenticate(request, env);
        if (!user) {
          return json({ error: 'Unauthorized' }, 401, corsHeaders);
        }

        if (method === 'GET' && path === '/me') {
          response = json(user);
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
          response = await handleCreateTeam(user, env);
        } else if (path.startsWith('/teams/')) {
          const parsed = parseTeamPath(path);
          if (!parsed) {
            response = json({ error: 'Not found' }, 404);
          } else if (method === 'POST' && parsed.action === 'join') {
            response = await handleTeamJoin(user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'leave') {
            response = await handleTeamLeave(user, env, parsed.teamId);
          } else if (method === 'GET' && parsed.action === 'context') {
            response = await handleTeamContext(user, env, parsed.teamId);
          } else if (method === 'PUT' && parsed.action === 'activity') {
            response = await handleTeamActivity(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'conflicts') {
            response = await handleTeamConflicts(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'heartbeat') {
            response = await handleTeamHeartbeat(user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'file') {
            response = await handleTeamFile(request, user, env, parsed.teamId);
          } else if (method === 'POST' && parsed.action === 'memory') {
            response = await handleTeamSaveMemory(request, user, env, parsed.teamId);
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
      console.error('Request error:', err);
      return json({ error: 'Internal server error' }, 500, corsHeaders);
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
  const limit = await db.checkIpLimit(ip, 3);
  if (!limit.allowed) {
    return json({ error: 'Too many accounts created today. Try again tomorrow.' }, 429);
  }

  const user = await db.createUser();
  if (user.error) {
    return json({ error: user.error }, 400);
  }

  // Store token → user_id in KV
  await env.AUTH_KV.put(`token:${user.token}`, user.id);

  return json({ handle: user.handle, color: user.color, token: user.token }, 201);
}

async function handleUpdateHandle(request, user, env) {
  const { handle } = await request.json();
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
  const { color } = await request.json();
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
  const { status } = await request.json();
  if (!status || typeof status !== 'string') {
    return json({ error: 'Status is required' }, 400);
  }
  if (status.length > 280) {
    return json({ error: 'Status must be 280 characters or less' }, 400);
  }

  const modResult = await checkContent(status, env);
  if (modResult.blocked) {
    return json({ error: 'Status could not be set. Please revise.' }, 400);
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
      429,
      {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
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

  return roomStub.fetch(new Request(roomUrl.toString(), {
    headers: { ...Object.fromEntries(request.headers), 'X-Chinwag-Verified': '1' },
  }));
}

// --- Agent & Team handlers ---

async function handleUpdateAgentProfile(request, user, env) {
  const body = await request.json();

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

function sanitizeTags(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(t => typeof t === 'string')
    .map(t => t.slice(0, 50).toLowerCase().trim())
    .filter(Boolean)
    .slice(0, 50);
}

async function handleCreateTeam(user, env) {
  // Rate limit: 5 teams per user per day (reuses account_limits table pattern)
  const db = getDB(env);
  const limit = await db.checkIpLimit(`team:${user.id}`, 5);
  if (!limit.allowed) {
    return json({ error: 'Team creation limit reached. Try again tomorrow.' }, 429);
  }

  const teamId = 't_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const team = getTeam(env, teamId);
  await team.join(user.id, user.id, user.handle);
  return json({ team_id: teamId }, 201);
}

async function handleTeamJoin(user, env, teamId) {
  const team = getTeam(env, teamId);
  const result = await team.join(user.id, user.id, user.handle);
  if (result.error) return json({ error: result.error }, 400);
  return json(result);
}

async function handleTeamLeave(user, env, teamId) {
  const team = getTeam(env, teamId);
  const result = await team.leave(user.id);
  if (result.error) return json({ error: result.error }, 400);
  return json(result);
}

async function handleTeamContext(user, env, teamId) {
  const team = getTeam(env, teamId);
  const result = await team.getContext(user.id);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

async function handleTeamActivity(request, user, env, teamId) {
  const { files, summary } = await request.json();
  if (!Array.isArray(files) || files.length === 0) return json({ error: 'files must be a non-empty array' }, 400);
  if (files.some(f => typeof f !== 'string' || f.length > 500)) return json({ error: 'invalid file path' }, 400);
  if (typeof summary !== 'string') return json({ error: 'summary must be a string' }, 400);
  if (summary.length > 280) return json({ error: 'summary must be 280 characters or less' }, 400);

  const team = getTeam(env, teamId);
  const result = await team.updateActivity(user.id, files, summary);
  if (result.error) return json({ error: result.error }, 400);
  return json(result);
}

async function handleTeamConflicts(request, user, env, teamId) {
  const { files } = await request.json();
  if (!Array.isArray(files) || files.length === 0) return json({ error: 'files must be a non-empty array' }, 400);

  const team = getTeam(env, teamId);
  const result = await team.checkConflicts(user.id, files);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
}

async function handleTeamHeartbeat(user, env, teamId) {
  const team = getTeam(env, teamId);
  const result = await team.heartbeat(user.id);
  if (result.error) return json({ error: result.error }, 400);
  return json(result);
}

async function handleTeamFile(request, user, env, teamId) {
  const { file } = await request.json();
  if (typeof file !== 'string' || !file.trim()) {
    return json({ error: 'file must be a non-empty string' }, 400);
  }
  if (file.length > 500) {
    return json({ error: 'file path too long' }, 400);
  }

  const team = getTeam(env, teamId);
  const result = await team.reportFile(user.id, file);
  if (result.error) return json({ error: result.error }, 400);
  return json(result);
}

async function handleTeamSaveMemory(request, user, env, teamId) {
  const { text, category } = await request.json();
  if (typeof text !== 'string' || !text.trim()) {
    return json({ error: 'text is required' }, 400);
  }
  if (text.length > 2000) {
    return json({ error: 'text must be 2000 characters or less' }, 400);
  }
  const validCategories = ['gotcha', 'pattern', 'config', 'decision', 'reference'];
  if (!validCategories.includes(category)) {
    return json({ error: `category must be one of: ${validCategories.join(', ')}` }, 400);
  }

  // Rate limit: 20 memory saves per user per day
  const db = getDB(env);
  const memLimit = await db.checkIpLimit(`memory:${user.id}`, 20);
  if (!memLimit.allowed) {
    return json({ error: 'Memory save limit reached (20/day). Try again tomorrow.' }, 429);
  }

  const team = getTeam(env, teamId);
  const result = await team.saveMemory(user.id, text.trim(), category, user.handle);
  if (result.error) return json({ error: result.error }, 400);
  return json(result, 201);
}

async function handleTeamStartSession(request, user, env, teamId) {
  const body = await request.json();
  const framework = typeof body.framework === 'string' ? body.framework.slice(0, 50) : 'unknown';

  const team = getTeam(env, teamId);
  const result = await team.startSession(user.id, user.handle, framework);
  if (result.error) return json({ error: result.error }, 400);
  return json(result, 201);
}

async function handleTeamEndSession(request, user, env, teamId) {
  const { session_id } = await request.json();
  if (typeof session_id !== 'string') {
    return json({ error: 'session_id is required' }, 400);
  }

  const team = getTeam(env, teamId);
  const result = await team.endSession(user.id, session_id);
  if (result.error) return json({ error: result.error }, 400);
  return json(result);
}

async function handleTeamSessionEdit(request, user, env, teamId) {
  const { file } = await request.json();
  if (typeof file !== 'string' || !file.trim()) {
    return json({ error: 'file is required' }, 400);
  }

  const team = getTeam(env, teamId);
  const result = await team.recordEdit(user.id, file);
  if (result.error) return json({ error: result.error }, 400);
  return json(result);
}

async function handleTeamHistory(request, user, env, teamId) {
  const url = new URL(request.url);
  const parsed = parseInt(url.searchParams.get('days') || '7', 10);
  const days = Math.max(1, Math.min(isNaN(parsed) ? 7 : parsed, 30));

  const team = getTeam(env, teamId);
  const result = await team.getHistory(user.id, days);
  if (result.error) return json({ error: result.error }, 403);
  return json(result);
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

function parseTeamPath(path) {
  const match = path.match(/^\/teams\/([a-zA-Z0-9_]+)\/([a-z]+)$/);
  if (!match) return null;
  return { teamId: match[1], action: match[2] };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
