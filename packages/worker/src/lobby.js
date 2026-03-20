// Lobby Durable Object — tracks all chat rooms, assigns users to rooms,
// and tracks presence (who has the app open).

const MIN_ROOM_SIZE = 5;
const MAX_ROOM_SIZE = 30;
const TARGET_ROOM_SIZE = 20;
const PRESENCE_TTL_MS = 60000; // 60 seconds — heartbeat every 30s, so 2 missed = offline

export class LobbyDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Map of roomId -> { count, lastUpdate }
    this.rooms = new Map();
    // Map of handle -> lastSeen timestamp (for presence tracking)
    this.presence = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/assign' && request.method === 'POST') {
      return this.assignRoom(request);
    }

    if (url.pathname === '/stats') {
      return this.getStats();
    }

    if (url.pathname === '/update' && request.method === 'POST') {
      return this.updateRoomCount(request);
    }

    if (url.pathname === '/remove' && request.method === 'POST') {
      return this.removeRoom(request);
    }

    if (url.pathname === '/heartbeat' && request.method === 'POST') {
      return this.heartbeat(request);
    }

    return new Response('Not found', { status: 404 });
  }

  async heartbeat(request) {
    const { handle } = await request.json();
    this.presence.set(handle, Date.now());
    return json({ ok: true });
  }

  async assignRoom(request) {
    const { handle, shuffle } = await request.json();

    let bestRoom = null;
    let bestScore = Infinity;

    for (const [roomId, info] of this.rooms) {
      if (info.count >= MAX_ROOM_SIZE) continue;

      const score = Math.abs(info.count - TARGET_ROOM_SIZE);

      if (shuffle && info.count < MIN_ROOM_SIZE) continue;

      if (score < bestScore) {
        bestScore = score;
        bestRoom = roomId;
      }
    }

    if (!bestRoom) {
      bestRoom = `room-${crypto.randomUUID().slice(0, 8)}`;
      this.rooms.set(bestRoom, { count: 0, lastUpdate: Date.now() });
    }

    return json({ roomId: bestRoom });
  }

  async updateRoomCount(request) {
    const { roomId, count } = await request.json();

    if (count <= 0) {
      this.rooms.delete(roomId);
    } else {
      this.rooms.set(roomId, { count, lastUpdate: Date.now() });
    }

    return json({ ok: true });
  }

  async removeRoom(request) {
    const { roomId } = await request.json();
    this.rooms.delete(roomId);
    return json({ ok: true });
  }

  async getStats() {
    const now = Date.now();

    // Clean stale presence entries
    for (const [handle, lastSeen] of this.presence) {
      if (now - lastSeen > PRESENCE_TTL_MS) {
        this.presence.delete(handle);
      }
    }

    // Chat users (in WebSocket rooms)
    let chatUsers = 0;
    let activeRooms = 0;
    for (const [, info] of this.rooms) {
      chatUsers += info.count;
      activeRooms++;
    }

    // Total online = unique presence heartbeats (includes chat users since they also heartbeat)
    const online = this.presence.size;

    return json({ online, chatUsers, activeRooms });
  }
}

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
}
