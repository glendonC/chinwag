import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Minimal WebSocket fake that exposes lifecycle hooks for testing. */
class MockWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.close = vi.fn(() => {
      this.readyState = 3; // CLOSED
    });
    MockWebSocket.instances.push(this);
  }

  /** Simulate server accepting connection. */
  simulateOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  /** Simulate a server-sent message. */
  simulateMessage(data) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  /** Simulate connection closing. */
  simulateClose() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  /** Simulate an error (onclose fires after). */
  simulateError() {
    this.onerror?.();
  }
}

async function loadWebSocketModule({
  token = 'tok_ws_test',
  activeTeamId = 't_ws',
  apiMock = vi.fn(),
  apiUrl = 'https://api.test.dev',
} = {}) {
  vi.resetModules();
  MockWebSocket.instances = [];

  const wsProto = new URL(apiUrl).protocol === 'https:' ? 'wss:' : 'ws:';
  vi.doMock('../api.js', () => ({
    api: apiMock,
    getApiUrl: () => apiUrl,
    getRuntimeTargets: () => ({
      profile: 'prod',
      apiUrl,
      teamWsOrigin: `${wsProto}//${new URL(apiUrl).host}`,
    }),
  }));
  vi.doMock('./auth.js', () => ({
    authActions: {
      getState: () => ({ token }),
      subscribe: vi.fn(),
    },
  }));
  vi.doMock('./teams.js', () => ({
    teamActions: {
      getState: () => ({ activeTeamId }),
    },
  }));

  const setWsConnectedMock = vi.fn();
  vi.doMock('./refresh.js', () => ({
    setWsConnected: setWsConnectedMock,
  }));

  // Inject our MockWebSocket as the global
  globalThis.WebSocket = MockWebSocket;

  const mod = await import('./websocket.js');
  return { ...mod, apiMock, setWsConnectedMock };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete globalThis.WebSocket;
});

describe('websocket store', () => {
  it('creates a WebSocket with the correct URL after fetching a ticket', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
    const { connectTeamWebSocket } = await loadWebSocketModule({ apiMock });

    await connectTeamWebSocket('t_ws');

    expect(apiMock).toHaveBeenCalledWith('POST', '/auth/ws-ticket', null, 'tok_ws_test');
    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toContain('wss://api.test.dev/teams/t_ws/ws');
    expect(ws.url).toContain('ticket=tix_abc');
    expect(ws.url).toContain('agentId=');
  });

  it('does nothing when token is missing', async () => {
    const apiMock = vi.fn();
    const { connectTeamWebSocket } = await loadWebSocketModule({ token: null, apiMock });

    await connectTeamWebSocket('t_ws');

    expect(apiMock).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('does nothing when teamId is empty', async () => {
    const apiMock = vi.fn();
    const { connectTeamWebSocket } = await loadWebSocketModule({ apiMock });

    await connectTeamWebSocket('');

    expect(apiMock).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('falls back silently when ticket fetch fails', async () => {
    const apiMock = vi.fn().mockRejectedValue(new Error('Network error'));
    const { connectTeamWebSocket } = await loadWebSocketModule({ apiMock });

    // Should not throw
    await connectTeamWebSocket('t_ws');

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('stops polling and marks WS connected on open', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
    const { connectTeamWebSocket, setPollingBridge, setWsConnectedMock } =
      await loadWebSocketModule({ apiMock });

    const bridge = {
      setState: vi.fn(),
      getState: vi.fn(() => ({})),
      stopPollTimer: vi.fn(),
      restartPolling: vi.fn(),
      poll: vi.fn(),
    };
    setPollingBridge(bridge);

    await connectTeamWebSocket('t_ws');
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    expect(setWsConnectedMock).toHaveBeenCalledWith(true);
    expect(bridge.stopPollTimer).toHaveBeenCalledTimes(1);
  });

  it('applies context event to polling store via bridge.setState', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
    const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

    const bridge = {
      setState: vi.fn(),
      getState: vi.fn(() => ({})),
      stopPollTimer: vi.fn(),
      restartPolling: vi.fn(),
      poll: vi.fn(),
    };
    setPollingBridge(bridge);

    await connectTeamWebSocket('t_ws');
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    const contextPayload = { members: [{ handle: 'alice' }] };
    ws.simulateMessage({ type: 'context', data: contextPayload });

    expect(bridge.setState).toHaveBeenCalledWith({
      contextData: contextPayload,
      contextStatus: 'ready',
      contextTeamId: 't_ws',
      pollError: null,
      pollErrorData: null,
      lastUpdate: expect.any(Date),
    });
  });

  it('applies delta events via bridge.setState updater function', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
    const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

    const bridge = {
      setState: vi.fn(),
      getState: vi.fn(() => ({})),
      stopPollTimer: vi.fn(),
      restartPolling: vi.fn(),
      poll: vi.fn(),
    };
    setPollingBridge(bridge);

    await connectTeamWebSocket('t_ws');
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // Send a delta event (non-context type)
    ws.simulateMessage({ type: 'heartbeat', agent_id: 'agent_1' });

    // The second call should be an updater function (for delta events)
    expect(bridge.setState).toHaveBeenCalledTimes(1);
    const updaterArg = bridge.setState.mock.calls[0][0];
    expect(typeof updaterArg).toBe('function');

    // The updater should return the state unchanged if contextTeamId doesn't match
    const staleState = { contextTeamId: 't_other', contextData: { members: [] } };
    expect(updaterArg(staleState)).toBe(staleState);
  });

  it('restarts polling when WebSocket closes on the active team', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
    const { connectTeamWebSocket, setPollingBridge, setWsConnectedMock } =
      await loadWebSocketModule({ apiMock });

    const bridge = {
      setState: vi.fn(),
      getState: vi.fn(() => ({})),
      stopPollTimer: vi.fn(),
      restartPolling: vi.fn(),
      poll: vi.fn(),
    };
    setPollingBridge(bridge);

    await connectTeamWebSocket('t_ws');
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateClose();

    expect(setWsConnectedMock).toHaveBeenCalledWith(false);
    expect(bridge.restartPolling).toHaveBeenCalledTimes(1);
  });

  it('schedules reconciliation polls with exponential backoff on open', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
    const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

    const bridge = {
      setState: vi.fn(),
      getState: vi.fn(() => ({})),
      stopPollTimer: vi.fn(),
      restartPolling: vi.fn(),
      poll: vi.fn().mockResolvedValue(undefined),
    };
    setPollingBridge(bridge);

    await connectTeamWebSocket('t_ws');
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // First reconciliation at RECONCILE_INITIAL_MS (30s)
    expect(bridge.poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(bridge.poll).toHaveBeenCalledTimes(1);

    // Second reconciliation at 2x initial (60s)
    await vi.advanceTimersByTimeAsync(60_000);
    expect(bridge.poll).toHaveBeenCalledTimes(2);

    // Third reconciliation at 4x initial (120s)
    await vi.advanceTimersByTimeAsync(120_000);
    expect(bridge.poll).toHaveBeenCalledTimes(3);
  });

  it('restarts reconciliation timer on message without resetting backoff delay', async () => {
    // Pin jitter to 100% for deterministic timing
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
    const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

    const bridge = {
      setState: vi.fn(),
      getState: vi.fn(() => ({})),
      stopPollTimer: vi.fn(),
      restartPolling: vi.fn(),
      poll: vi.fn().mockResolvedValue(undefined),
    };
    setPollingBridge(bridge);

    await connectTeamWebSocket('t_ws');
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // onopen → scheduleReconcile: jitter(30_000)=30_000, delay→60_000
    // First poll fires at 30s
    await vi.advanceTimersByTimeAsync(30_000);
    expect(bridge.poll).toHaveBeenCalledTimes(1);
    // poll callback → scheduleReconcile: jitter(60_000)=60_000, delay→120_000

    // Message restarts timer at current delay (120_000)
    ws.simulateMessage({ type: 'context', data: { members: [] } });

    // 60s not enough — backoff wasn't reset to initial
    await vi.advanceTimersByTimeAsync(60_000);
    expect(bridge.poll).toHaveBeenCalledTimes(1);

    // After full 120s from message, poll fires
    await vi.advanceTimersByTimeAsync(60_000);
    expect(bridge.poll).toHaveBeenCalledTimes(2);

    vi.spyOn(Math, 'random').mockRestore();
  });

  it('generation counter prevents stale onclose from restarting polling', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
    const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

    const bridge = {
      setState: vi.fn(),
      getState: vi.fn(() => ({})),
      stopPollTimer: vi.fn(),
      restartPolling: vi.fn(),
      poll: vi.fn(),
    };
    setPollingBridge(bridge);

    // First connection
    await connectTeamWebSocket('t_ws');
    const ws1 = MockWebSocket.instances[0];
    ws1.simulateOpen();

    // Second connection supersedes the first (closeWebSocket bumps generation)
    await connectTeamWebSocket('t_ws');
    const ws2 = MockWebSocket.instances[1];
    ws2.simulateOpen();

    // Old connection closing should NOT restart polling (stale generation)
    bridge.restartPolling.mockClear();
    ws1.simulateClose();
    expect(bridge.restartPolling).not.toHaveBeenCalled();

    // New connection closing SHOULD restart polling
    ws2.simulateClose();
    expect(bridge.restartPolling).toHaveBeenCalledTimes(1);
  });

  it('generation counter prevents stale onmessage from applying deltas', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
    const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

    const bridge = {
      setState: vi.fn(),
      getState: vi.fn(() => ({})),
      stopPollTimer: vi.fn(),
      restartPolling: vi.fn(),
      poll: vi.fn(),
    };
    setPollingBridge(bridge);

    // First connection
    await connectTeamWebSocket('t_ws');
    const ws1 = MockWebSocket.instances[0];
    ws1.simulateOpen();

    // Second connection supersedes
    await connectTeamWebSocket('t_ws');
    const ws2 = MockWebSocket.instances[1];
    ws2.simulateOpen();

    // Clear setState calls from onopen
    bridge.setState.mockClear();

    // Message on the old socket should be ignored
    ws1.simulateMessage({ type: 'context', data: { members: [{ handle: 'stale' }] } });
    expect(bridge.setState).not.toHaveBeenCalled();

    // Message on the new socket should apply
    ws2.simulateMessage({ type: 'context', data: { members: [{ handle: 'fresh' }] } });
    expect(bridge.setState).toHaveBeenCalledTimes(1);
  });

  it('closeWebSocket cleans up the active connection and resets state', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
    const {
      connectTeamWebSocket,
      closeWebSocket,
      hasActiveWebSocket,
      setPollingBridge,
      setWsConnectedMock,
    } = await loadWebSocketModule({ apiMock });

    const bridge = {
      setState: vi.fn(),
      getState: vi.fn(() => ({})),
      stopPollTimer: vi.fn(),
      restartPolling: vi.fn(),
      poll: vi.fn(),
    };
    setPollingBridge(bridge);

    await connectTeamWebSocket('t_ws');
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    expect(hasActiveWebSocket()).toBe(true);

    closeWebSocket();

    expect(ws.close).toHaveBeenCalled();
    expect(hasActiveWebSocket()).toBe(false);
    expect(setWsConnectedMock).toHaveBeenCalledWith(false);
  });

  it('closeWebSocket is safe to call when no connection exists', async () => {
    const { closeWebSocket, hasActiveWebSocket } = await loadWebSocketModule();

    expect(hasActiveWebSocket()).toBe(false);
    expect(() => closeWebSocket()).not.toThrow();
  });

  it('replaces http with ws in the WebSocket URL', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
    const { connectTeamWebSocket } = await loadWebSocketModule({
      apiMock,
      apiUrl: 'http://localhost:8787',
    });

    await connectTeamWebSocket('t_ws');

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toMatch(/^ws:\/\/localhost:8787/);
  });

  it('converts https to wss in the WebSocket URL', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
    const { connectTeamWebSocket } = await loadWebSocketModule({
      apiMock,
      apiUrl: 'https://api.prod.dev',
    });

    await connectTeamWebSocket('t_ws');

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toMatch(/^wss:\/\/api.prod.dev/);
  });

  it('handles malformed WebSocket messages without crashing', async () => {
    const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
    const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

    const bridge = {
      setState: vi.fn(),
      getState: vi.fn(() => ({})),
      stopPollTimer: vi.fn(),
      restartPolling: vi.fn(),
      poll: vi.fn(),
    };
    setPollingBridge(bridge);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await connectTeamWebSocket('t_ws');
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // Send invalid JSON
    ws.onmessage?.({ data: 'not valid json {{{' });

    expect(warnSpy).toHaveBeenCalledWith('[chinwag] Malformed WS event:', expect.any(String));
    // Should not have applied any state
    // The only setState calls should be none for broken data — bridge.setState
    // was already called by delta handler but JSON.parse threw, so no setState for this message
  });
});
