// Room Durable Object — handles WebSocket connections for a single chat room.
// Each room is an independent DO instance, coordinated by the Lobby.
// Uses fetch() for WebSocket upgrades, RPC for Lobby communication.

import { DurableObject } from 'cloudflare:workers';
import { isBlocked } from './moderation.js';
import {
  CHAT_MAX_HISTORY,
  CHAT_MAX_MESSAGE_LENGTH,
  CHAT_MAX_PER_MINUTE,
  CHAT_RATE_LIMIT_WINDOW_MS,
  CHAT_RATE_LIMIT_PRUNE_AFTER_MS,
} from './lib/constants.js';

export function checkWindowedRateLimit(rateLimits, key, maxPerMinute = 10, now = Date.now()) {
  let entry = rateLimits.get(key);
  if (!entry || now - entry.windowStart > CHAT_RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    rateLimits.set(key, entry);
  }

  entry.count++;

  if (rateLimits.size > 500) {
    for (const [storedKey, storedEntry] of rateLimits) {
      if (now - storedEntry.windowStart > CHAT_RATE_LIMIT_PRUNE_AFTER_MS) {
        rateLimits.delete(storedKey);
      }
    }
  }

  return entry.count <= maxPerMinute;
}

export class RoomDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // WebSocket → { handle, color }
    this.sessions = new Map();
    this.history = [];
    this.chatRateLimits = new Map();
    this.roomId = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') {
      return new Response('Not found', { status: 404 });
    }

    // Handle and color are set by the Worker after authentication — not user-supplied.
    // The X-Chinwag-Verified header confirms this request came from our Worker, not an external caller.
    if (request.headers.get('X-Chinwag-Verified') !== '1') {
      return new Response('Forbidden', { status: 403 });
    }

    const handle = url.searchParams.get('handle');
    const color = url.searchParams.get('color');
    if (!handle || !color) {
      return new Response('Missing user info', { status: 400 });
    }

    if (!this.roomId) {
      this.roomId = url.searchParams.get('roomId') || 'unknown';
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server, [handle]);
    this.sessions.set(server, { handle, color });

    server.send(JSON.stringify({
      type: 'history',
      messages: this.history,
      roomCount: this.sessions.size,
    }));

    this.broadcast({
      type: 'join',
      handle,
      color,
      roomCount: this.sessions.size,
    }, server);

    await this.#updateLobbyCount();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, rawMessage) {
    const session = this.sessions.get(ws);
    if (!session) return;

    let data;
    try {
      data = JSON.parse(rawMessage);
    } catch {
      return;
    }

    if (data.type === 'message') {
      const content = (data.content || '').trim();
      if (!content || content.length > CHAT_MAX_MESSAGE_LENGTH) return;

      if (!checkWindowedRateLimit(this.chatRateLimits, `chat:${session.handle}`, CHAT_MAX_PER_MINUTE)) {
        ws.send(JSON.stringify({
          type: 'system',
          content: 'Slow down — max 10 messages per minute.',
        }));
        return;
      }

      if (isBlocked(content)) {
        ws.send(JSON.stringify({
          type: 'system',
          content: 'Message not sent. Please keep chat respectful.',
        }));
        return;
      }

      const message = {
        type: 'message',
        handle: session.handle,
        color: session.color,
        content,
        timestamp: new Date().toISOString(),
      };

      this.history.push(message);
      if (this.history.length > CHAT_MAX_HISTORY) {
        this.history.shift();
      }

      this.broadcast(message);
    }
  }

  async webSocketClose(ws) {
    await this.#handleDisconnect(ws);
  }

  async webSocketError(ws) {
    await this.#handleDisconnect(ws);
  }

  async #handleDisconnect(ws) {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);

    if (session) {
      this.broadcast({
        type: 'leave',
        handle: session.handle,
        roomCount: this.sessions.size,
      });
    }

    await this.#updateLobbyCount();
  }

  broadcast(message, exclude = null) {
    const data = JSON.stringify(message);
    for (const [ws] of this.sessions) {
      if (ws !== exclude) {
        try { ws.send(data); } catch { /* dead connection */ }
      }
    }
  }

  async #updateLobbyCount() {
    try {
      const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('main'));
      await lobby.updateRoomCount(this.roomId || 'unknown', this.sessions.size);
    } catch (err) {
      console.error('Failed to update lobby:', err);
    }
  }
}
