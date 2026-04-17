// Room Durable Object -- handles WebSocket connections for a single chat room.
// Each room is an independent DO instance, coordinated by the Lobby.
// Uses fetch() for WebSocket upgrades, RPC for Lobby communication.

import { DurableObject } from 'cloudflare:workers';
import type { Env } from './types.js';
import { getErrorMessage } from './lib/errors.js';
import { createLogger } from './lib/logger.js';
import { safeParse } from './lib/safe-parse.js';

const log = createLogger('RoomDO');
import { isBlocked } from './moderation.js';
import {
  CHAT_MAX_HISTORY,
  CHAT_MAX_MESSAGE_LENGTH,
  CHAT_MAX_PER_MINUTE,
  CHAT_RATE_LIMIT_WINDOW_MS,
  CHAT_RATE_LIMIT_PRUNE_AFTER_MS,
  MAX_WS_MESSAGE_SIZE,
} from './lib/constants.js';

interface RateLimitEntry {
  windowStart: number;
  count: number;
}

interface ChatSession {
  handle: string;
  color: string;
}

interface ChatMessage {
  type: string;
  handle?: string;
  color?: string;
  content?: string;
  timestamp?: string;
  messages?: ChatMessage[];
  roomCount?: number;
}

export function checkWindowedRateLimit(
  rateLimits: Map<string, RateLimitEntry>,
  key: string,
  maxPerMinute = 10,
  now = Date.now(),
): boolean {
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

export class RoomDO extends DurableObject<Env> {
  sessions: Map<WebSocket, ChatSession>;
  history: ChatMessage[];
  chatRateLimits: Map<string, RateLimitEntry>;
  roomId: string | null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // WebSocket -> { handle, color }
    this.sessions = new Map();
    this.history = [];
    this.chatRateLimits = new Map();
    this.roomId = null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') {
      return new Response('Not found', { status: 404 });
    }

    // Handle and color are set by the Worker after authentication -- not user-supplied.
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
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server, [handle]);
    this.sessions.set(server, { handle, color });

    server.send(
      JSON.stringify({
        type: 'history',
        messages: this.history,
        roomCount: this.sessions.size,
      }),
    );

    this.broadcast(
      {
        type: 'join',
        handle,
        color,
        roomCount: this.sessions.size,
      },
      server,
    );

    await this.#updateLobbyCount();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    const session = this.sessions.get(ws);
    if (!session) return;

    const raw = typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage);
    if (raw.length > MAX_WS_MESSAGE_SIZE) {
      ws.close(1009, 'Message too large');
      return;
    }

    const data = safeParse<Record<string, unknown> | null>(
      raw,
      `RoomDO.webSocketMessage room=${this.roomId}`,
      null,
      log,
    );
    if (!data) return;

    if (data.type === 'message') {
      const content = ((data.content as string) || '').trim();
      if (!content || content.length > CHAT_MAX_MESSAGE_LENGTH) return;

      if (
        !checkWindowedRateLimit(this.chatRateLimits, `chat:${session.handle}`, CHAT_MAX_PER_MINUTE)
      ) {
        ws.send(
          JSON.stringify({
            type: 'system',
            content: 'Slow down — max 10 messages per minute.',
          }),
        );
        return;
      }

      if (isBlocked(content)) {
        ws.send(
          JSON.stringify({
            type: 'system',
            content: 'Message not sent. Please keep chat respectful.',
          }),
        );
        return;
      }

      const message: ChatMessage = {
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

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.#handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.#handleDisconnect(ws);
  }

  async #handleDisconnect(ws: WebSocket): Promise<void> {
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

  broadcast(message: ChatMessage, exclude?: WebSocket): void {
    const data = JSON.stringify(message);
    let failures = 0;
    for (const [ws] of this.sessions) {
      if (ws !== exclude) {
        try {
          ws.send(data);
        } catch {
          failures++;
        }
      }
    }
    if (failures > 0) {
      log.warn('broadcast partial failure', { roomId: this.roomId || 'unknown', failures });
    }
  }

  async #updateLobbyCount(): Promise<void> {
    try {
      const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('main'));
      await lobby.updateRoomCount(this.roomId || 'unknown', this.sessions.size);
    } catch (err) {
      log.error('failed to update lobby', {
        roomId: this.roomId || 'unknown',
        error: getErrorMessage(err),
      });
    }
  }
}
