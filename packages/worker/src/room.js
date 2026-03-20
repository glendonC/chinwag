// Room Durable Object — handles WebSocket connections for a single chat room.
// Each room is an independent DO instance, coordinated by the Lobby.
// Uses fetch() for WebSocket upgrades, RPC for Lobby communication.

import { DurableObject } from 'cloudflare:workers';
import { isBlocked, checkRateLimit } from './moderation.js';

const MAX_HISTORY = 50;
const MAX_MESSAGE_LENGTH = 280;
const MAX_CHAT_PER_MINUTE = 10;

export class RoomDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // WebSocket → { handle, color }
    this.sessions = new Map();
    this.history = [];
    this.roomId = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') {
      return new Response('Not found', { status: 404 });
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
      if (!content || content.length > MAX_MESSAGE_LENGTH) return;

      if (!checkRateLimit(`chat:${session.handle}`, MAX_CHAT_PER_MINUTE)) {
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
      if (this.history.length > MAX_HISTORY) {
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
