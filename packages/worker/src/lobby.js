// Lobby Durable Object — tracks all chat rooms, assigns users to rooms,
// and tracks presence (who has the app open).
// Uses DO RPC for direct method calls.

import { DurableObject } from 'cloudflare:workers';

const MIN_ROOM_SIZE = 5;
const MAX_ROOM_SIZE = 30;
const TARGET_ROOM_SIZE = 20;
const PRESENCE_TTL_MS = 60_000;

export class LobbyDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // roomId → { count, lastUpdate }
    this.rooms = new Map();
    // handle → lastSeen timestamp
    this.presence = new Map();
  }

  async heartbeat(handle) {
    this.presence.set(handle, Date.now());
    return { ok: true };
  }

  async assignRoom(handle, shuffle = false) {
    let bestRoom = null;
    let bestScore = Infinity;

    for (const [roomId, info] of this.rooms) {
      if (info.count >= MAX_ROOM_SIZE) continue;
      if (shuffle && info.count < MIN_ROOM_SIZE) continue;

      const score = Math.abs(info.count - TARGET_ROOM_SIZE);
      if (score < bestScore) {
        bestScore = score;
        bestRoom = roomId;
      }
    }

    if (!bestRoom) {
      bestRoom = `room-${crypto.randomUUID().slice(0, 8)}`;
      this.rooms.set(bestRoom, { count: 0, lastUpdate: Date.now() });
    }

    return { roomId: bestRoom };
  }

  async updateRoomCount(roomId, count) {
    if (count <= 0) {
      this.rooms.delete(roomId);
    } else {
      this.rooms.set(roomId, { count, lastUpdate: Date.now() });
    }
    return { ok: true };
  }

  async removeRoom(roomId) {
    this.rooms.delete(roomId);
    return { ok: true };
  }

  async getStats() {
    const now = Date.now();

    // Clean stale presence entries
    for (const [handle, lastSeen] of this.presence) {
      if (now - lastSeen > PRESENCE_TTL_MS) {
        this.presence.delete(handle);
      }
    }

    let chatUsers = 0;
    let activeRooms = 0;
    for (const [, info] of this.rooms) {
      chatUsers += info.count;
      activeRooms++;
    }

    return { online: this.presence.size, chatUsers, activeRooms };
  }
}
