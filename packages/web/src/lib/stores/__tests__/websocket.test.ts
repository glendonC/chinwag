import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PollingBridge } from '../pollingTypes.js';

/** Mock PollingBridge where every method is a vi.fn() for assertions. */
type MockPollingBridge = {
  [K in keyof PollingBridge]: ReturnType<typeof vi.fn>;
};

/** Create a mock PollingBridge with empty getState for test isolation. */
function createBridgeMock(): MockPollingBridge {
  return {
    setState: vi.fn(),
    getState: vi.fn(() => ({
      dashboardData: null,
      dashboardStatus: 'idle' as const,
      contextData: null,
      contextStatus: 'idle' as const,
      contextTeamId: null,
      pollError: null,
      pollErrorData: null,
      lastUpdate: null,
      consecutiveFailures: 0,
    })),
    stopPollTimer: vi.fn(),
    restartPolling: vi.fn(),
    poll: vi.fn(),
  };
}

/** Minimal WebSocket fake for testing lifecycle hooks. */
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState: number;
  onopen: (() => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close: ReturnType<typeof vi.fn>;

  constructor(url: string) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.close = vi.fn(() => {
      this.readyState = 3; // CLOSED
    });
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  simulateClose() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

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

  vi.doMock('../api.js', () => ({
    api: apiMock,
    getApiUrl: () => apiUrl,
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

  (globalThis as Record<string, unknown>).WebSocket = MockWebSocket;

  const mod = await import('../websocket.js');
  return { ...mod, apiMock, setWsConnectedMock };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).WebSocket;
});

describe('websocket store', () => {
  describe('connection lifecycle', () => {
    it('creates a WebSocket with the correct URL after fetching a ticket', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket } = await loadWebSocketModule({ apiMock });

      await connectTeamWebSocket('t_ws');

      expect(apiMock).toHaveBeenCalledWith('POST', '/auth/ws-ticket', null, 'tok_ws_test');
      expect(MockWebSocket.instances).toHaveLength(1);
      const ws = MockWebSocket.instances[0];
      expect(ws.url).toContain('wss://api.test.dev/teams/t_ws/ws');
      expect(ws.url).toContain('ticket=tix_abc');
    });

    it('stops polling and marks WS connected on open', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket, setPollingBridge, setWsConnectedMock } =
        await loadWebSocketModule({ apiMock });

      const bridge = createBridgeMock();
      setPollingBridge(bridge as unknown as PollingBridge);

      await connectTeamWebSocket('t_ws');
      MockWebSocket.instances[0].simulateOpen();

      expect(setWsConnectedMock).toHaveBeenCalledWith(true);
      expect(bridge.stopPollTimer).toHaveBeenCalledTimes(1);
    });

    it('restarts polling when WebSocket closes on the active team', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket, setPollingBridge, setWsConnectedMock } =
        await loadWebSocketModule({ apiMock });

      const bridge = createBridgeMock();
      setPollingBridge(bridge as unknown as PollingBridge);

      await connectTeamWebSocket('t_ws');
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateClose();

      expect(setWsConnectedMock).toHaveBeenCalledWith(false);
      expect(bridge.restartPolling).toHaveBeenCalledTimes(1);
    });

    it('handles error followed by close gracefully', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      const bridge = createBridgeMock();
      setPollingBridge(bridge as unknown as PollingBridge);

      await connectTeamWebSocket('t_ws');
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();
      ws.simulateError();
      ws.simulateClose();

      // Should still restart polling after error + close sequence
      expect(bridge.restartPolling).toHaveBeenCalledTimes(1);
    });

    it('closeWebSocket cleans up the active connection', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket, closeWebSocket, hasActiveWebSocket, setPollingBridge } =
        await loadWebSocketModule({ apiMock });

      const bridge = createBridgeMock();
      setPollingBridge(bridge as unknown as PollingBridge);

      await connectTeamWebSocket('t_ws');
      MockWebSocket.instances[0].simulateOpen();
      expect(hasActiveWebSocket()).toBe(true);

      closeWebSocket();

      expect(MockWebSocket.instances[0].close).toHaveBeenCalled();
      expect(hasActiveWebSocket()).toBe(false);
    });

    it('closeWebSocket is safe to call when no connection exists', async () => {
      const { closeWebSocket, hasActiveWebSocket } = await loadWebSocketModule();

      expect(hasActiveWebSocket()).toBe(false);
      expect(() => closeWebSocket()).not.toThrow();
    });
  });

  describe('reconnection backoff', () => {
    it('schedules reconciliation polls with exponential backoff', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      const bridge = createBridgeMock();
      bridge.poll = vi.fn().mockResolvedValue(undefined);
      setPollingBridge(bridge as unknown as PollingBridge);

      await connectTeamWebSocket('t_ws');
      MockWebSocket.instances[0].simulateOpen();

      expect(bridge.poll).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(bridge.poll).toHaveBeenCalledTimes(1);

      // Second at 2x (60s)
      await vi.advanceTimersByTimeAsync(60_000);
      expect(bridge.poll).toHaveBeenCalledTimes(2);

      // Third at 4x (120s)
      await vi.advanceTimersByTimeAsync(120_000);
      expect(bridge.poll).toHaveBeenCalledTimes(3);
    });

    it('resets backoff when a message arrives', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      const bridge = createBridgeMock();
      bridge.poll = vi.fn().mockResolvedValue(undefined);
      setPollingBridge(bridge as unknown as PollingBridge);

      await connectTeamWebSocket('t_ws');
      const ws = MockWebSocket.instances[0];
      ws.simulateOpen();

      await vi.advanceTimersByTimeAsync(20_000);
      expect(bridge.poll).not.toHaveBeenCalled();

      ws.simulateMessage({ type: 'context', data: { members: [] } });

      // Reset means next reconcile is 30s from now
      await vi.advanceTimersByTimeAsync(20_000);
      expect(bridge.poll).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(bridge.poll).toHaveBeenCalledTimes(1);
    });
  });

  describe('generation tracking (stale handler prevention)', () => {
    it('prevents stale onclose from restarting polling', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      const bridge = createBridgeMock();
      setPollingBridge(bridge as unknown as PollingBridge);

      // First connection
      await connectTeamWebSocket('t_ws');
      const ws1 = MockWebSocket.instances[0];
      ws1.simulateOpen();

      // Second connection supersedes
      await connectTeamWebSocket('t_ws');
      const ws2 = MockWebSocket.instances[1];
      ws2.simulateOpen();

      bridge.restartPolling.mockClear();
      ws1.simulateClose(); // stale
      expect(bridge.restartPolling).not.toHaveBeenCalled();

      ws2.simulateClose(); // current
      expect(bridge.restartPolling).toHaveBeenCalledTimes(1);
    });

    it('prevents stale onmessage from applying deltas', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      const bridge = createBridgeMock();
      setPollingBridge(bridge as unknown as PollingBridge);

      await connectTeamWebSocket('t_ws');
      const ws1 = MockWebSocket.instances[0];
      ws1.simulateOpen();

      await connectTeamWebSocket('t_ws');
      const ws2 = MockWebSocket.instances[1];
      ws2.simulateOpen();

      bridge.setState.mockClear();

      ws1.simulateMessage({ type: 'context', data: { members: [{ handle: 'stale' }] } });
      expect(bridge.setState).not.toHaveBeenCalled();

      ws2.simulateMessage({ type: 'context', data: { members: [{ handle: 'fresh' }] } });
      expect(bridge.setState).toHaveBeenCalledTimes(1);
    });
  });

  describe('guard conditions', () => {
    it('does nothing when token is missing', async () => {
      const apiMock = vi.fn();
      const { connectTeamWebSocket } = await loadWebSocketModule({
        token: null as unknown as string,
        apiMock,
      });

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

      await connectTeamWebSocket('t_ws');

      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it('replaces http with ws in the WebSocket URL', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket } = await loadWebSocketModule({
        apiMock,
        apiUrl: 'http://localhost:8787',
      });

      await connectTeamWebSocket('t_ws');

      expect(MockWebSocket.instances[0].url).toMatch(/^ws:\/\/localhost:8787/);
    });

    it('converts https to wss in the WebSocket URL', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket } = await loadWebSocketModule({
        apiMock,
        apiUrl: 'https://api.prod.dev',
      });

      await connectTeamWebSocket('t_ws');

      expect(MockWebSocket.instances[0].url).toMatch(/^wss:\/\/api.prod.dev/);
    });
  });

  describe('message handling', () => {
    it('applies context events via bridge.setState', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      const bridge = createBridgeMock();
      setPollingBridge(bridge as unknown as PollingBridge);

      await connectTeamWebSocket('t_ws');
      MockWebSocket.instances[0].simulateOpen();

      const contextPayload = { members: [{ handle: 'alice' }] };
      MockWebSocket.instances[0].simulateMessage({ type: 'context', data: contextPayload });

      expect(bridge.setState).toHaveBeenCalledWith({
        contextData: contextPayload,
        contextStatus: 'ready',
        contextTeamId: 't_ws',
        pollError: null,
        pollErrorData: null,
        lastUpdate: expect.any(Date),
      });
    });

    it('applies delta events via updater function', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      const bridge = createBridgeMock();
      setPollingBridge(bridge as unknown as PollingBridge);

      await connectTeamWebSocket('t_ws');
      MockWebSocket.instances[0].simulateOpen();

      MockWebSocket.instances[0].simulateMessage({ type: 'heartbeat', agent_id: 'agent_1' });

      expect(bridge.setState).toHaveBeenCalledTimes(1);
      const updaterArg = bridge.setState.mock.calls[0][0];
      expect(typeof updaterArg).toBe('function');

      // Updater returns identity when team doesn't match
      const staleState = { contextTeamId: 't_other', contextData: { members: [] } };
      expect(updaterArg(staleState)).toBe(staleState);
    });

    it('handles malformed WebSocket messages without crashing', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tix_abc' });
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      const bridge = createBridgeMock();
      setPollingBridge(bridge as unknown as PollingBridge);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await connectTeamWebSocket('t_ws');
      MockWebSocket.instances[0].simulateOpen();

      MockWebSocket.instances[0].onmessage?.({ data: 'not valid json {{{' });

      expect(warnSpy).toHaveBeenCalledWith('[chinwag] Malformed WS event:', expect.any(String));
    });
  });
});
