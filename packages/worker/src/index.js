// Worker entry point — HTTP routing, auth, and request handling.
// Uses DO RPC for all Durable Object communication.
// Auth flow: Bearer token → KV lookup → user_id → DO.getUser(id)

import { checkContent, isBlocked, checkRateLimit } from './moderation.js';

export { DatabaseDO } from './db.js';
export { LobbyDO } from './lobby.js';
export { RoomDO } from './room.js';

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
        } else if (method === 'POST' && path === '/notes') {
          response = await handlePostNote(request, user, env);
        } else if (method === 'GET' && path === '/notes/inbox') {
          response = await handleInbox(user, env);
        } else if (method === 'GET' && path === '/notes/today') {
          response = await handleFeed(url, user, env);
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

async function handlePostNote(request, user, env) {
  const { message } = await request.json();
  if (!message || typeof message !== 'string') {
    return json({ error: 'Message is required' }, 400);
  }
  if (message.length > 280) {
    return json({ error: 'Message must be 280 characters or less' }, 400);
  }

  // Two-layer content check: blocklist (instant) + AI (async)
  const modResult = await checkContent(message, env);
  if (modResult.blocked) {
    return json({ error: 'Message could not be posted. Please revise.' }, 400);
  }

  const db = getDB(env);
  const result = await db.postNote(user.id, message);

  if (result.error) {
    return json({ error: result.error }, 400);
  }
  return json(result, 201);
}

async function handleInbox(user, env) {
  const db = getDB(env);
  return json(await db.getInbox(user.id));
}

async function handleFeed(url, user, env) {
  const cursor = url.searchParams.get('cursor') || null;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  const db = getDB(env);
  return json(await db.getFeed(limit, cursor, user.id));
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
    headers: request.headers,
  }));
}

// --- Helpers ---

function getDB(env) {
  return env.DATABASE.get(env.DATABASE.idFromName('main'));
}

function getLobby(env) {
  return env.LOBBY.get(env.LOBBY.idFromName('main'));
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
