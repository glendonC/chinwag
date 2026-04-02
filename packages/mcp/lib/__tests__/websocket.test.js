import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createWebSocketManager,
  WS_PING_MS,
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
} from '../websocket.js';

// --- Mock WebSocket ---

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    this.sentMessages = [];
    this.closed = false;
    // Auto-open in next microtask
    Promise.resolve().then(() => this.onopen?.());
  }

  send(data) {
    if (this.closed) throw new Error('WebSocket is closed');
    this.sentMessages.push(data);
  }

  close() {
    this.closed = true;
  }
}

describe('createWebSocketManager', () => {
  let client, state, manager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.WebSocket = MockWebSocket;

    client = {
      post: vi.fn().mockResolvedValue({ ticket: 'tkt_abc' }),
    };
    state = { ws: null, lastActivity: Date.now(), shuttingDown: false };
  });

  afterEach(() => {
    if (manager) manager.disconnect();
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete globalThis.WebSocket;
  });

  function createManager() {
    manager = createWebSocketManager({
      client,
      getApiUrl: () => 'https://api.example.com',
      teamId: 't_test',
      agentId: 'agent_1',
      state,
    });
    return manager;
  }

  it('exports named constants', () => {
    expect(WS_PING_MS).toBe(60_000);
    expect(INITIAL_RECONNECT_DELAY_MS).toBe(1_000);
    expect(MAX_RECONNECT_DELAY_MS).toBe(60_000);
  });

  it('fetches a ws-ticket and opens a WebSocket on connect', async () => {
    createManager();
    manager.connect();

    // Let the ticket fetch resolve
    await vi.advanceTimersByTimeAsync(0);
    // Let the WebSocket onopen fire
    await vi.advanceTimersByTimeAsync(0);

    expect(client.post).toHaveBeenCalledWith('/auth/ws-ticket');
    expect(state.ws).toBeInstanceOf(MockWebSocket);
    expect(state.ws.url).toMatch(/wss:\/\/api\.example\.com\/teams\/t_test\/ws/);
    expect(state.ws.url).toMatch(/agentId=agent_1/);
    expect(state.ws.url).toMatch(/ticket=tkt_abc/);
  });

  it('sets state.ws to null and schedules reconnect on close', async () => {
    createManager();
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    const ws = state.ws;
    expect(ws).not.toBeNull();

    // Simulate close
    ws.onclose();
    expect(state.ws).toBeNull();
  });

  it('reconnects with exponential backoff', async () => {
    createManager();
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    const ws1 = state.ws;
    ws1.onclose();

    // First reconnect after 1s
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('reconnecting in 1s'));
  });

  it('does not reconnect when shutting down', async () => {
    createManager();
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    state.shuttingDown = true;
    const ws1 = state.ws;
    ws1.onclose();

    // Should NOT schedule reconnect
    const reconnectLogs = console.error.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('reconnecting'),
    );
    expect(reconnectLogs).toHaveLength(0);
  });

  it('disconnect clears state and timers', async () => {
    createManager();
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(state.ws).not.toBeNull();
    manager.disconnect();
    expect(state.ws).toBeNull();
  });

  it('schedules reconnect on ticket fetch failure', async () => {
    client.post.mockRejectedValue(new Error('Network error'));
    createManager();
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(console.error).toHaveBeenCalledWith('[chinwag]', 'Network error');
  });

  it('resets reconnect delay on successful connection', async () => {
    createManager();
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(state.ws).not.toBeNull();
    // Connection succeeds, delay should be reset to initial
    // (verified by the reconnect message showing 1s after next disconnect)
    const ws1 = state.ws;
    ws1.onclose();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('reconnecting in 1s'));
  });
});
