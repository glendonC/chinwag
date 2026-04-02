// Lobby Durable Object — tracks all chat rooms, assigns users to rooms,
// and tracks presence (who has the app open).
// Uses DO RPC for direct method calls.

import { DurableObject } from 'cloudflare:workers';

const MIN_ROOM_SIZE = 5;
const MAX_ROOM_SIZE = 30;
const TARGET_ROOM_SIZE = 20;
const PRESENCE_TTL_MS = 60_000;

export class LobbyDO extends DurableObject {
  #schemaReady = false;

  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // roomId → { count, lastUpdate }
    this.rooms = new Map();
    // handle → lastSeen timestamp
    this.presence = new Map();
  }

  #ensureSchema() {
    if (this.#schemaReady) return;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        last_updated TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS presence (
        handle TEXT PRIMARY KEY,
        last_seen INTEGER NOT NULL
      );
    `);

    // Hydrate in-memory Maps from SQLite
    for (const row of this.sql.exec('SELECT room_id, count, last_updated FROM rooms')) {
      this.rooms.set(row.room_id, {
        count: row.count,
        lastUpdate: new Date(row.last_updated + 'Z').getTime(),
      });
    }

    for (const row of this.sql.exec('SELECT handle, last_seen FROM presence')) {
      this.presence.set(row.handle, row.last_seen);
    }

    this.#schemaReady = true;
  }

  async heartbeat(handle) {
    this.#ensureSchema();
    const now = Date.now();
    this.presence.set(handle, now);
    this.sql.exec(
      'INSERT INTO presence (handle, last_seen) VALUES (?, ?) ON CONFLICT(handle) DO UPDATE SET last_seen = excluded.last_seen',
      handle,
      now,
    );
    return { ok: true };
  }

  async assignRoom(handle, shuffle = false) {
    this.#ensureSchema();
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
      this.sql.exec(
        'INSERT INTO rooms (room_id, count) VALUES (?, 0)',
        bestRoom,
      );
    }

    return { roomId: bestRoom };
  }

  async updateRoomCount(roomId, count) {
    this.#ensureSchema();
    if (count <= 0) {
      this.rooms.delete(roomId);
      this.sql.exec('DELETE FROM rooms WHERE room_id = ?', roomId);
    } else {
      this.rooms.set(roomId, { count, lastUpdate: Date.now() });
      this.sql.exec(
        'INSERT INTO rooms (room_id, count, last_updated) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(room_id) DO UPDATE SET count = excluded.count, last_updated = excluded.last_updated',
        roomId,
        count,
      );
    }
    return { ok: true };
  }

  async removeRoom(roomId) {
    this.#ensureSchema();
    this.rooms.delete(roomId);
    this.sql.exec('DELETE FROM rooms WHERE room_id = ?', roomId);
    return { ok: true };
  }

  async getStats() {
    this.#ensureSchema();
    const now = Date.now();
    const staleHandles = [];

    // Clean stale presence entries
    for (const [handle, lastSeen] of this.presence) {
      if (now - lastSeen > PRESENCE_TTL_MS) {
        this.presence.delete(handle);
        staleHandles.push(handle);
      }
    }

    // Batch-delete stale presence from SQLite
    if (staleHandles.length > 0) {
      const placeholders = staleHandles.map(() => '?').join(', ');
      this.sql.exec(
        `DELETE FROM presence WHERE handle IN (${placeholders})`,
        ...staleHandles,
      );
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
