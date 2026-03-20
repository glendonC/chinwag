// Room Durable Object — handles WebSocket connections for a single chat room.
// Each room is an independent DO instance, coordinated by the Lobby.

const MAX_HISTORY = 50;
const MAX_MESSAGE_LENGTH = 280;

export class RoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Map of WebSocket -> { handle, color }
    this.sessions = new Map();
    // Recent message history
    this.history = [];
    this.roomId = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname !== '/ws') {
      return new Response('Not found', { status: 404 });
    }

    // Extract user info from query params (set by the Worker router)
    const handle = url.searchParams.get('handle');
    const color = url.searchParams.get('color');

    if (!handle || !color) {
      return new Response('Missing user info', { status: 400 });
    }

    // Store roomId from the DO name for lobby updates
    if (!this.roomId) {
      this.roomId = url.searchParams.get('roomId') || 'unknown';
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server, [handle]);

    // Store session info
    this.sessions.set(server, { handle, color });

    // Send history to the new connection
    server.send(JSON.stringify({
      type: 'history',
      messages: this.history,
      roomCount: this.sessions.size,
    }));

    // Broadcast join to others
    this.broadcast({
      type: 'join',
      handle,
      color,
      roomCount: this.sessions.size,
    }, server);

    // Notify lobby of updated count
    await this.updateLobbyCount();

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

      const message = {
        type: 'message',
        handle: session.handle,
        color: session.color,
        content,
        timestamp: new Date().toISOString(),
      };

      // Add to history
      this.history.push(message);
      if (this.history.length > MAX_HISTORY) {
        this.history.shift();
      }

      // Broadcast to all including sender
      this.broadcast(message);
    }
  }

  async webSocketClose(ws) {
    await this.handleDisconnect(ws);
  }

  async webSocketError(ws) {
    await this.handleDisconnect(ws);
  }

  async handleDisconnect(ws) {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);

    if (session) {
      this.broadcast({
        type: 'leave',
        handle: session.handle,
        roomCount: this.sessions.size,
      });
    }

    await this.updateLobbyCount();
  }

  broadcast(message, exclude = null) {
    const data = JSON.stringify(message);
    for (const [ws] of this.sessions) {
      if (ws !== exclude) {
        try {
          ws.send(data);
        } catch {
          // Connection dead, will be cleaned up on close event
        }
      }
    }
  }

  async updateLobbyCount() {
    try {
      const lobbyId = this.env.LOBBY.idFromName('main');
      const lobby = this.env.LOBBY.get(lobbyId);

      // Extract room ID from the DO's own ID
      const roomId = this.roomId || 'unknown';

      await lobby.fetch(new Request('https://lobby/update', {
        method: 'POST',
        body: JSON.stringify({
          roomId,
          count: this.sessions.size,
        }),
      }));
    } catch (err) {
      console.error('Failed to update lobby:', err);
    }
  }
}
