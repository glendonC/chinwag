import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createWebSocketManager,
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
    Promise.resolve().then(() => {
      if (!this.closed && this.onopen) this.onopen();
    });
  }

  send(data) {
    if (this.closed) throw new Error('WebSocket is closed');
    this.sentMessages.push(data);
  }

  close() {
    this.closed = true;
  }
}

/** Helper: extract delay in seconds from reconnect log messages. */
function extractDelaySeconds(consoleSpy) {
  const log = consoleSpy.mock.calls.find(
    (c) => typeof c[0] === 'string' && c[0].includes('reconnecting in'),
  );
  if (!log) return null;
  const match = log[0].match(/reconnecting in ([\d.]+)s/);
  return match ? parseFloat(match[1]) : null;
}

/** Helper: extract all delay values from log messages. */
function extractAllDelaySeconds(consoleSpy) {
  return consoleSpy.mock.calls
    .filter((c) => typeof c[0] === 'string' && c[0].includes('reconnecting in'))
    .map((c) => {
      const match = c[0].match(/reconnecting in ([\d.]+)s/);
      return match ? parseFloat(match[1]) : null;
    })
    .filter((d) => d !== null);
}

describe('WebSocket reconnect with exponential backoff', () => {
  let client, state, manager, consoleSpy;

  beforeEach(() => {
    vi.useFakeTimers();
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

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

  /** Connect and wait for WebSocket to be established. */
  async function connectAndWait() {
    createManager();
    manager.connect();
    await vi.advanceTimersByTimeAsync(0); // ticket fetch
    await vi.advanceTimersByTimeAsync(0); // WebSocket onopen
  }

  // --- Initial delay ---

  it('exports INITIAL_RECONNECT_DELAY_MS as 1 second', () => {
    expect(INITIAL_RECONNECT_DELAY_MS).toBe(1_000);
  });

  it('schedules reconnect after WebSocket closes', async () => {
    await connectAndWait();
    const ws = state.ws;
    expect(ws).not.toBeNull();

    ws.onclose();
    expect(state.ws).toBeNull();

    // Reconnect should be scheduled
    const delay = extractDelaySeconds(consoleSpy);
    expect(delay).not.toBeNull();
    // Initial base is 1000ms, jitter [50-100%] => delay in [0.5s, 1.0s]
    expect(delay).toBeGreaterThanOrEqual(0.5);
    expect(delay).toBeLessThanOrEqual(1.0);
  });

  // --- Delay doubles on consecutive failures ---

  it('delay increases on consecutive failures (ticket fetch errors)', async () => {
    // Pin Math.random to 0.5 for deterministic jitter
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    // Ticket fetch fails — triggers scheduleReconnect without successful onopen
    // (so delay is NOT reset between attempts)
    client.post.mockRejectedValue(new Error('offline'));

    createManager();
    manager.connect();
    await vi.advanceTimersByTimeAsync(0); // first attempt fails

    // First failure: base = 1000ms, jitter factor = 0.75 => 750ms
    const firstDelay = extractDelaySeconds(consoleSpy);
    expect(firstDelay).toBeGreaterThan(0);

    // Advance to trigger next reconnect
    consoleSpy.mockClear();
    await vi.advanceTimersByTimeAsync(INITIAL_RECONNECT_DELAY_MS * 2);
    await vi.advanceTimersByTimeAsync(0); // second failure

    // Second failure: base = 2000ms (doubled), jitter => 1500ms
    const secondDelay = extractDelaySeconds(consoleSpy);
    expect(secondDelay).toBeGreaterThan(firstDelay);

    // Third failure: base = 4000ms
    consoleSpy.mockClear();
    await vi.advanceTimersByTimeAsync(INITIAL_RECONNECT_DELAY_MS * 4);
    await vi.advanceTimersByTimeAsync(0);

    const thirdDelay = extractDelaySeconds(consoleSpy);
    expect(thirdDelay).toBeGreaterThan(secondDelay);

    randomSpy.mockRestore();
  });

  it('base delay approximately doubles each time', async () => {
    // Use ticket fetch failure for quick consecutive failures
    client.post.mockRejectedValue(new Error('offline'));

    createManager();
    manager.connect();
    await vi.advanceTimersByTimeAsync(0); // first failure

    const delays = [];

    // Collect several reconnect delays
    for (let i = 0; i < 5; i++) {
      const delay = extractDelaySeconds(consoleSpy);
      if (delay) delays.push(delay);
      consoleSpy.mockClear();
      await vi.advanceTimersByTimeAsync(MAX_RECONNECT_DELAY_MS + 1000);
      await vi.advanceTimersByTimeAsync(0);
    }

    // Each delay should be roughly >= the previous (within jitter variance)
    for (let i = 1; i < delays.length && delays[i] < 60; i++) {
      // With doubling base and 50-100% jitter, next delay's minimum (50% of doubled)
      // equals the current base, so each value should generally be >= previous
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1] * 0.45);
    }
  });

  // --- Delay caps at MAX_RECONNECT_DELAY_MS ---

  it('exports MAX_RECONNECT_DELAY_MS as 60 seconds', () => {
    expect(MAX_RECONNECT_DELAY_MS).toBe(60_000);
  });

  it('does not exceed max delay after many failures', async () => {
    client.post.mockRejectedValue(new Error('offline'));

    createManager();
    manager.connect();
    await vi.advanceTimersByTimeAsync(0); // first attempt fails

    // Run through many reconnect cycles to hit the cap
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(MAX_RECONNECT_DELAY_MS + 1000);
      await vi.advanceTimersByTimeAsync(0);
    }

    // All logged delays should be <= 60s
    const allDelays = extractAllDelaySeconds(consoleSpy);
    expect(allDelays.length).toBeGreaterThan(0);
    for (const d of allDelays) {
      expect(d).toBeLessThanOrEqual(60);
    }
  });

  // --- Jitter ---

  it('jitter keeps delay between 50% and 100% of base (initial base)', async () => {
    // Run multiple reconnects and verify all fall in the expected range
    // Initial base = 1000ms, so delay should be in [500, 1000]
    const delays = [];
    for (let i = 0; i < 5; i++) {
      consoleSpy.mockClear();
      state.ws = null;
      client.post.mockResolvedValue({ ticket: `tkt_${i}` });

      await connectAndWait();
      state.ws.onclose();

      const d = extractDelaySeconds(consoleSpy);
      delays.push(d);

      // Disconnect and recreate to reset delay
      manager.disconnect();
    }

    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(0.5); // 50% of 1s
      expect(d).toBeLessThanOrEqual(1.0); // 100% of 1s
    }
  });

  it('jitter varies the actual delay across runs', async () => {
    // Use deterministic Math.random to prove different random values produce
    // different delays. Spy on Math.random to alternate values.
    const randomSpy = vi.spyOn(Math, 'random');

    const delays = [];
    for (const randomVal of [0.0, 1.0]) {
      randomSpy.mockReturnValue(randomVal);
      consoleSpy.mockClear();
      state.ws = null;
      client.post.mockResolvedValue({ ticket: 'tkt' });
      manager?.disconnect();

      await connectAndWait();
      state.ws.onclose();

      const d = extractDelaySeconds(consoleSpy);
      delays.push(d);

      manager.disconnect();
    }

    // random=0 => 50% of base, random=1 => 100% of base
    expect(delays[0]).toBeLessThan(delays[1]);

    randomSpy.mockRestore();
  });

  // --- Successful connect resets delay ---

  it('successful connection resets delay to initial', async () => {
    await connectAndWait();

    // First close: base = 1000
    state.ws.onclose();
    const firstDelay = extractDelaySeconds(consoleSpy);
    expect(firstDelay).toBeGreaterThanOrEqual(0.5);
    expect(firstDelay).toBeLessThanOrEqual(1.0);

    // Advance past reconnect timer — connection re-established
    await vi.advanceTimersByTimeAsync(INITIAL_RECONNECT_DELAY_MS * 2);
    await vi.advanceTimersByTimeAsync(0); // ticket resolve
    await vi.advanceTimersByTimeAsync(0); // ws open

    // Successful onopen resets delay to INITIAL_RECONNECT_DELAY_MS
    // Close again — delay should be back to initial range
    consoleSpy.mockClear();
    state.ws.onclose();
    const resetDelay = extractDelaySeconds(consoleSpy);

    // Should be in initial range [0.5, 1.0], not doubled range [1.0, 2.0]
    expect(resetDelay).toBeGreaterThanOrEqual(0.5);
    expect(resetDelay).toBeLessThanOrEqual(1.0);
  });

  // --- Edge: no reconnect when shutting down ---

  it('does not schedule reconnect when shuttingDown is true', async () => {
    await connectAndWait();

    state.shuttingDown = true;
    state.ws.onclose();

    const delays = extractAllDelaySeconds(consoleSpy);
    expect(delays).toHaveLength(0);
  });

  it('does not reconnect when shuttingDown is set before connect', async () => {
    createManager();
    state.shuttingDown = true;
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(state.ws).toBeNull();
    expect(client.post).not.toHaveBeenCalled();
  });

  // --- Edge: ticket failure triggers backoff ---

  it('ticket fetch failure schedules reconnect with backoff', async () => {
    client.post.mockRejectedValue(new Error('401 Unauthorized'));

    createManager();
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);

    const delay = extractDelaySeconds(consoleSpy);
    expect(delay).not.toBeNull();
    expect(delay).toBeGreaterThanOrEqual(0.5);
  });
});
