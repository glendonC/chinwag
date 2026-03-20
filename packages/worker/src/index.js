export { DatabaseDO } from './db.js';
export { LobbyDO } from './lobby.js';
export { RoomDO } from './room.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    // CORS headers for all responses
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
          response = await handleMe(user, env);
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
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    } catch (err) {
      console.error('Request error:', err);
      return json({ error: 'Internal server error' }, 500, corsHeaders);
    }
  },
};

// --- Auth ---

async function authenticate(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);

  const handle = await env.AUTH_KV.get(`token:${token}`);
  if (!handle) return null;

  const db = getDB(env);
  const res = await db.fetch(new Request('https://db/rpc', {
    method: 'POST',
    body: JSON.stringify({ method: 'getUser', args: [handle] }),
  }));
  const user = await res.json();
  return user || null;
}

// --- Route handlers ---

async function handleInit(request, env) {
  const body = await request.json().catch(() => ({}));
  const db = getDB(env);

  const res = await db.fetch(new Request('https://db/rpc', {
    method: 'POST',
    body: JSON.stringify({ method: 'createUser', args: [body] }),
  }));
  const user = await res.json();

  if (user.error) {
    return json({ error: user.error }, 400);
  }

  // Store token → handle mapping in KV for fast auth lookups
  await env.AUTH_KV.put(`token:${user.token}`, user.handle);

  return json({
    handle: user.handle,
    color: user.color,
    token: user.token,
  }, 201);
}

async function handleMe(user, env) {
  return json(user);
}

async function handleUpdateHandle(request, user, env) {
  const { handle } = await request.json();
  if (!handle || typeof handle !== 'string') {
    return json({ error: 'Handle is required' }, 400);
  }

  const db = getDB(env);
  const res = await db.fetch(new Request('https://db/rpc', {
    method: 'POST',
    body: JSON.stringify({ method: 'updateHandle', args: [user.handle, handle] }),
  }));
  const result = await res.json();

  if (result.error) {
    return json({ error: result.error }, 400);
  }

  // Update KV token mapping to new handle
  await env.AUTH_KV.put(`token:${user.token}`, handle);

  return json(result);
}

async function handleUpdateColor(request, user, env) {
  const { color } = await request.json();
  if (!color || typeof color !== 'string') {
    return json({ error: 'Color is required' }, 400);
  }

  const db = getDB(env);
  const res = await db.fetch(new Request('https://db/rpc', {
    method: 'POST',
    body: JSON.stringify({ method: 'updateColor', args: [user.handle, color] }),
  }));
  const result = await res.json();

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

  const db = getDB(env);
  const res = await db.fetch(new Request('https://db/rpc', {
    method: 'POST',
    body: JSON.stringify({ method: 'postNote', args: [user.handle, message] }),
  }));
  const result = await res.json();

  if (result.error) {
    return json({ error: result.error }, 400);
  }
  return json(result, 201);
}

async function handleInbox(user, env) {
  const db = getDB(env);
  const res = await db.fetch(new Request('https://db/rpc', {
    method: 'POST',
    body: JSON.stringify({ method: 'getInbox', args: [user.handle] }),
  }));
  const result = await res.json();
  return json(result);
}

async function handleFeed(url, user, env) {
  const cursor = url.searchParams.get('cursor') || null;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
  const excludeHandle = user?.handle || null;

  const db = getDB(env);
  const res = await db.fetch(new Request('https://db/rpc', {
    method: 'POST',
    body: JSON.stringify({ method: 'getFeed', args: [limit, cursor, excludeHandle] }),
  }));
  const result = await res.json();
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

  const db = getDB(env);
  await db.fetch(new Request('https://db/rpc', {
    method: 'POST',
    body: JSON.stringify({ method: 'setStatus', args: [user.handle, status] }),
  }));
  return json({ ok: true });
}

async function handleClearStatus(user, env) {
  const db = getDB(env);
  await db.fetch(new Request('https://db/rpc', {
    method: 'POST',
    body: JSON.stringify({ method: 'setStatus', args: [user.handle, null] }),
  }));
  return json({ ok: true });
}

async function handleHeartbeat(user, env) {
  const lobby = getLobby(env);
  await lobby.fetch(new Request('https://lobby/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ handle: user.handle }),
  }));
  return json({ ok: true });
}

async function handleStats(env) {
  const lobby = getLobby(env);
  const res = await lobby.fetch(new Request('https://lobby/stats'));
  const stats = await res.json();

  const db = getDB(env);
  const dbRes = await db.fetch(new Request('https://db/rpc', {
    method: 'POST',
    body: JSON.stringify({ method: 'getStats', args: [] }),
  }));
  const dbStats = await dbRes.json();

  return json({ ...dbStats, ...stats });
}

async function handleChatUpgrade(request, user, env) {
  const lobby = getLobby(env);
  const shuffle = new URL(request.url).searchParams.get('shuffle') === '1';

  // Ask lobby for a room assignment
  const assignRes = await lobby.fetch(new Request('https://lobby/assign', {
    method: 'POST',
    body: JSON.stringify({ handle: user.handle, shuffle }),
  }));
  const { roomId } = await assignRes.json();

  // Forward the WebSocket upgrade to the assigned room
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
  const id = env.DATABASE.idFromName('main');
  return env.DATABASE.get(id);
}

function getLobby(env) {
  const id = env.LOBBY.idFromName('main');
  return env.LOBBY.get(id);
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
