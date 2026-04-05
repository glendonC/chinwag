import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flushPromises(n = 3) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/**
 * Minimal mock WebSocket that exposes lifecycle callbacks and lets tests
 * trigger onopen / onmessage / onclose / onerror imperatively.
 */
function createMockWebSocketClass() {
  const instances = [];

  class MockWebSocket {
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
      instances.push(this);
    }

    /** Simulate server accepting the connection. */
    _open() {
      this.readyState = 1; // OPEN
      this.onopen?.();
    }

    /** Simulate receiving a message from the server. */
    _message(data) {
      this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
    }

    /** Simulate the connection closing. */
    _close() {
      this.readyState = 3;
      this.onclose?.();
    }

    /** Simulate an error (onclose fires after in real browsers). */
    _error() {
      this.onerror?.();
    }
  }

  return { MockWebSocket, instances };
}

// ---------------------------------------------------------------------------
// Module loader — fresh module per test (mirrors polling.test.js pattern)
// ---------------------------------------------------------------------------

let authSubscribers;

async function loadWebSocketModule({
  token = 'tok_abc',
  activeTeamId = 't_team1',
  apiMock = vi.fn(),
  applyDeltaMock = vi.fn((prev, delta) => ({ ...prev, ...delta })),
  setWsConnectedMock = vi.fn(),
} = {}) {
  vi.resetModules();

  authSubscribers = [];

  vi.doMock('../../api.js', () => ({
    api: apiMock,
    getApiUrl: () => 'https://chinwag-api.example.workers.dev',
    getRuntimeTargets: () => ({
      profile: 'prod',
      apiUrl: 'https://chinwag-api.example.workers.dev',
      teamWsOrigin: 'wss://chinwag-api.example.workers.dev',
    }),
  }));

  vi.doMock('@chinwag/shared/dashboard-ws.js', () => ({
    applyDelta: applyDeltaMock,
  }));

  vi.doMock('../../constants.js', () => ({
    RECONCILE_INITIAL_MS: 100,
    RECONCILE_MAX_MS: 400,
  }));

  vi.doMock('../auth.js', () => ({
    authActions: {
      getState: () => ({ token }),
      subscribe: vi.fn((cb) => {
        authSubscribers.push(cb);
        return () => {
          authSubscribers = authSubscribers.filter((s) => s !== cb);
        };
      }),
    },
  }));

  vi.doMock('../teams.js', () => ({
    teamActions: {
      getState: () => ({ activeTeamId }),
    },
  }));

  vi.doMock('../refresh.js', () => ({
    setWsConnected: setWsConnectedMock,
  }));

  const mod = await import('../websocket.js');
  return { ...mod, apiMock, applyDeltaMock, setWsConnectedMock };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete globalThis.WebSocket;
});

describe('websocket module', () => {
  // -----------------------------------------------------------------------
  // setPollingBridge
  // -----------------------------------------------------------------------
  describe('setPollingBridge', () => {
    it('wires up the cross-store bridge callbacks', async () => {
      const { setPollingBridge, connectTeamWebSocket } = await loadWebSocketModule({
        apiMock: vi.fn().mockResolvedValue({ ticket: 'tkt_1' }),
      });

      const bridge = {
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      };
      setPollingBridge(bridge);

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();

      const ws = instances[0];
      ws._open();

      expect(bridge.stopPollTimer).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // connectTeamWebSocket
  // -----------------------------------------------------------------------
  describe('connectTeamWebSocket', () => {
    it('fetches a WS ticket and opens a WebSocket with correct URL', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_abc' });
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();

      expect(apiMock).toHaveBeenCalledWith('POST', '/auth/ws-ticket', null, 'tok_abc');
      expect(instances).toHaveLength(1);
      expect(instances[0].url).toContain('wss://chinwag-api.example.workers.dev/teams/t_team1/ws');
      expect(instances[0].url).toContain('ticket=tkt_abc');
      expect(instances[0].url).toContain('agentId=web-dashboard%3Atok_abc');
    });

    it('does nothing when token is missing', async () => {
      const apiMock = vi.fn();
      const { connectTeamWebSocket } = await loadWebSocketModule({ token: null, apiMock });

      const { MockWebSocket } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();

      expect(apiMock).not.toHaveBeenCalled();
    });

    it('does nothing when teamId is missing', async () => {
      const apiMock = vi.fn();
      const { connectTeamWebSocket } = await loadWebSocketModule({ apiMock });

      const { MockWebSocket } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket(null);
      await flushPromises();

      expect(apiMock).not.toHaveBeenCalled();
    });

    it('falls back silently when ticket fetch fails', async () => {
      const apiMock = vi.fn().mockRejectedValue(new Error('network'));
      const { connectTeamWebSocket, hasActiveWebSocket } = await loadWebSocketModule({ apiMock });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();

      expect(instances).toHaveLength(0);
      expect(hasActiveWebSocket()).toBe(false);
    });

    it('sets wsConnected on open and stops polling', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const stopPollTimer = vi.fn();
      const { connectTeamWebSocket, setPollingBridge, setWsConnectedMock } =
        await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer,
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();

      instances[0]._open();

      expect(setWsConnectedMock).toHaveBeenCalledWith(true);
      expect(stopPollTimer).toHaveBeenCalledTimes(1);
    });

    it('closes the previous WebSocket before opening a new one', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const { connectTeamWebSocket, setPollingBridge, setWsConnectedMock } =
        await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();

      await connectTeamWebSocket('t_team1');
      await flushPromises();

      // closeWebSocket is called internally, which calls setWsConnected(false)
      expect(setWsConnectedMock).toHaveBeenCalledWith(false);
      expect(instances).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Generation counter (stale handler protection)
  // -----------------------------------------------------------------------
  describe('generation counter', () => {
    it('ignores onopen from a superseded connection', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const stopPollTimer = vi.fn();
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer,
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      // First connection
      await connectTeamWebSocket('t_team1');
      await flushPromises();
      const firstWs = instances[0];

      // Second connection supersedes the first (bumps generation)
      await connectTeamWebSocket('t_team1');
      await flushPromises();

      // First WS finally opens, but generation is stale
      firstWs._open();

      // stopPollTimer should NOT have been called by the stale open (it was
      // called once during closeWebSocket, but the stale onopen should close
      // the ws rather than stopping the poll timer for it)
      expect(firstWs.close).toHaveBeenCalled();
    });

    it('ignores onmessage from a superseded connection', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const setState = vi.fn();
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState,
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      const firstWs = instances[0];
      firstWs._open();

      // Supersede with a new connection
      await connectTeamWebSocket('t_team1');
      await flushPromises();

      // Send message to stale connection
      firstWs._message({ type: 'context', data: { members: [] } });

      // setState should NOT have been called from the stale message
      // (it may have been called by the open, reset that)
      const contextCalls = setState.mock.calls.filter(
        (call) => typeof call[0] === 'object' && call[0]?.contextData !== undefined,
      );
      expect(contextCalls).toHaveLength(0);
    });

    it('ignores onclose from a superseded connection', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const restartPolling = vi.fn();
      const { connectTeamWebSocket, setPollingBridge, setWsConnectedMock } =
        await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling,
        restartPollTimer: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      const firstWs = instances[0];
      firstWs._open();

      // Supersede
      await connectTeamWebSocket('t_team1');
      await flushPromises();

      // Reset call counts after the second connect's closeWebSocket
      restartPolling.mockClear();
      setWsConnectedMock.mockClear();

      // Stale close fires
      firstWs._close();

      // Should NOT restart polling from the stale handler
      expect(restartPolling).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------
  describe('onmessage', () => {
    it('sets full context data for "context" event type', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const setState = vi.fn();
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState,
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();
      setState.mockClear();

      const contextPayload = { members: [{ handle: 'alice' }], memory: [] };
      instances[0]._message({ type: 'context', data: contextPayload });

      expect(setState).toHaveBeenCalledWith(
        expect.objectContaining({
          contextData: contextPayload,
          contextStatus: 'ready',
          contextTeamId: 't_team1',
          pollError: null,
          pollErrorData: null,
        }),
      );
    });

    it('applies delta for non-context event types', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const existingContext = { members: [{ handle: 'alice' }] };
      const setState = vi.fn();
      const applyDeltaMock = vi.fn(() => ({ members: [{ handle: 'alice' }, { handle: 'bob' }] }));
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({
        apiMock,
        applyDeltaMock,
      });

      setPollingBridge({
        setState,
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();
      setState.mockClear();

      const deltaEvent = { type: 'member_joined', data: { handle: 'bob' } };
      instances[0]._message(deltaEvent);

      // For deltas, setState is called with an updater function
      expect(setState).toHaveBeenCalledTimes(1);
      const updater = setState.mock.calls[0][0];
      expect(typeof updater).toBe('function');

      // Call the updater with a state that has matching contextTeamId and contextData
      const result = updater({
        contextTeamId: 't_team1',
        contextData: existingContext,
      });

      expect(applyDeltaMock).toHaveBeenCalledWith(existingContext, deltaEvent);
      expect(result.contextData).toEqual({ members: [{ handle: 'alice' }, { handle: 'bob' }] });
      expect(result.lastUpdate).toBeInstanceOf(Date);
    });

    it('does not apply delta when contextTeamId does not match', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const setState = vi.fn();
      const applyDeltaMock = vi.fn();
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({
        apiMock,
        applyDeltaMock,
      });

      setPollingBridge({
        setState,
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();
      setState.mockClear();

      instances[0]._message({ type: 'member_joined', data: {} });

      const updater = setState.mock.calls[0][0];
      const state = { contextTeamId: 't_OTHER', contextData: { members: [] } };
      const result = updater(state);

      // Should return original state unchanged
      expect(result).toBe(state);
      expect(applyDeltaMock).not.toHaveBeenCalled();
    });

    it('does not apply delta when contextData is null', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const setState = vi.fn();
      const applyDeltaMock = vi.fn();
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({
        apiMock,
        applyDeltaMock,
      });

      setPollingBridge({
        setState,
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();
      setState.mockClear();

      instances[0]._message({ type: 'member_joined', data: {} });

      const updater = setState.mock.calls[0][0];
      const state = { contextTeamId: 't_team1', contextData: null };
      const result = updater(state);

      expect(result).toBe(state);
      expect(applyDeltaMock).not.toHaveBeenCalled();
    });

    it('handles malformed JSON gracefully and logs a warning', async () => {
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const setState = vi.fn();
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState,
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();
      setState.mockClear();

      // Send invalid JSON
      instances[0]._message('{{not valid json');

      expect(warnSpy).toHaveBeenCalledWith('[chinwag] Malformed WS event:', expect.any(String));
      // setState should not have been called with context data
      const contextCalls = setState.mock.calls.filter(
        (c) => typeof c[0] === 'object' && c[0]?.contextData !== undefined,
      );
      expect(contextCalls).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Reconciliation with exponential backoff
  // -----------------------------------------------------------------------
  describe('reconciliation', () => {
    it('starts reconciliation polling on open with initial delay', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const pollMock = vi.fn().mockResolvedValue(undefined);
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: pollMock,
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();

      // Should not have polled yet (RECONCILE_INITIAL_MS = 100 in mock)
      expect(pollMock).not.toHaveBeenCalled();

      // Advance past the initial delay
      await vi.advanceTimersByTimeAsync(100);

      expect(pollMock).toHaveBeenCalledTimes(1);
    });

    it('doubles the reconcile delay with exponential backoff up to max', async () => {
      vi.useFakeTimers();
      // Pin jitter to 100% so delays are deterministic (jitteredDelay = delay * 1.0)
      vi.spyOn(Math, 'random').mockReturnValue(1);
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const pollMock = vi.fn().mockResolvedValue(undefined);
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: pollMock,
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();

      // Initial: jitter(100ms) = 100ms (random=1 → 0.5+0.5=1.0 → 100*1=100)
      await vi.advanceTimersByTimeAsync(100);
      expect(pollMock).toHaveBeenCalledTimes(1);

      // Second: delay doubled to 200ms, jitter(200) = 200ms
      await vi.advanceTimersByTimeAsync(200);
      expect(pollMock).toHaveBeenCalledTimes(2);

      // Third: delay doubled to 400ms (capped at max), jitter(400) = 400ms
      await vi.advanceTimersByTimeAsync(400);
      expect(pollMock).toHaveBeenCalledTimes(3);

      // Fourth: still capped at 400ms
      await vi.advanceTimersByTimeAsync(400);
      expect(pollMock).toHaveBeenCalledTimes(4);

      vi.spyOn(Math, 'random').mockRestore();
    });

    it('preserves backoff delay when a message is received (only restarts timer)', async () => {
      vi.useFakeTimers();
      // Pin jitter to 100% for deterministic timing
      vi.spyOn(Math, 'random').mockReturnValue(1);
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const pollMock = vi.fn().mockResolvedValue(undefined);
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: pollMock,
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();

      // onopen → scheduleReconcile: jitter(100)=100, reconcileDelay→200. Timer at 100ms.
      await vi.advanceTimersByTimeAsync(100);
      expect(pollMock).toHaveBeenCalledTimes(1);
      // poll callback → scheduleReconcile: jitter(200)=200, reconcileDelay→400. Timer at 200ms.

      // Message arrives mid-timer — restarts timer with current reconcileDelay (400)
      // jitter(400)=400, reconcileDelay→800 (or capped). Timer at 400ms from now.
      instances[0]._message({ type: 'context', data: { members: [] } });

      // 200ms is NOT enough — old behavior would have reset to initial 100ms
      await vi.advanceTimersByTimeAsync(200);
      expect(pollMock).toHaveBeenCalledTimes(1);

      // After the full 400ms from the message, poll fires
      await vi.advanceTimersByTimeAsync(200);
      expect(pollMock).toHaveBeenCalledTimes(2);

      vi.spyOn(Math, 'random').mockRestore();
    });

    it('skips reconcile if a previous reconcile is still in flight', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });

      // Create a poll that never resolves (simulates in-flight)
      let resolvePoll;
      const pollMock = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePoll = resolve;
          }),
      );
      const { connectTeamWebSocket, setPollingBridge } = await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: pollMock,
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();

      // Trigger first reconcile (stays in-flight)
      await vi.advanceTimersByTimeAsync(100);
      expect(pollMock).toHaveBeenCalledTimes(1);

      // Resolve the first poll to allow the timer to schedule the next one
      resolvePoll();
      await flushPromises();

      // Now advance to where the second reconcile fires (200ms backoff)
      // but make this one hang
      await vi.advanceTimersByTimeAsync(200);
      expect(pollMock).toHaveBeenCalledTimes(2);

      // The second poll is still in flight; a message resets backoff and
      // schedules a new reconcile at 100ms
      instances[0]._message({ type: 'context', data: {} });
      await vi.advanceTimersByTimeAsync(100);

      // Should still be 2 because reconcileInFlight is true
      expect(pollMock).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // onclose behavior
  // -----------------------------------------------------------------------
  describe('onclose', () => {
    it('falls back to polling when connection closes and team is still active', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const restartPolling = vi.fn();
      const { connectTeamWebSocket, setPollingBridge, setWsConnectedMock, hasActiveWebSocket } =
        await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling,
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();

      restartPolling.mockClear();
      setWsConnectedMock.mockClear();

      instances[0]._close();

      expect(setWsConnectedMock).toHaveBeenCalledWith(false);
      expect(restartPolling).toHaveBeenCalledTimes(1);
      expect(hasActiveWebSocket()).toBe(false);
    });

    it('does not restart polling when the active team has changed', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const restartPolling = vi.fn();
      const teamState = { activeTeamId: 't_team1' };

      vi.resetModules();

      authSubscribers = [];

      vi.doMock('../../api.js', () => ({
        api: apiMock,
        getApiUrl: () => 'https://chinwag-api.example.workers.dev',
        getRuntimeTargets: () => ({
          profile: 'prod',
          apiUrl: 'https://chinwag-api.example.workers.dev',
          teamWsOrigin: 'wss://chinwag-api.example.workers.dev',
        }),
      }));
      vi.doMock('@chinwag/shared/dashboard-ws.js', () => ({
        applyDelta: vi.fn(),
      }));
      vi.doMock('../../constants.js', () => ({
        RECONCILE_INITIAL_MS: 100,
        RECONCILE_MAX_MS: 400,
      }));
      vi.doMock('../auth.js', () => ({
        authActions: {
          getState: () => ({ token: 'tok_abc' }),
          subscribe: vi.fn((cb) => {
            authSubscribers.push(cb);
            return () => {};
          }),
        },
      }));
      vi.doMock('../teams.js', () => ({
        teamActions: {
          getState: () => teamState,
        },
      }));
      vi.doMock('../refresh.js', () => ({
        setWsConnected: vi.fn(),
      }));

      const mod = await import('../websocket.js');

      mod.setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling,
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await mod.connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();

      // Team changes before WS closes
      teamState.activeTeamId = 't_OTHER_TEAM';
      restartPolling.mockClear();

      instances[0]._close();

      expect(restartPolling).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // closeWebSocket
  // -----------------------------------------------------------------------
  describe('closeWebSocket', () => {
    it('closes the active WebSocket and resets state', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const {
        connectTeamWebSocket,
        closeWebSocket,
        setPollingBridge,
        setWsConnectedMock,
        hasActiveWebSocket,
      } = await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();

      expect(hasActiveWebSocket()).toBe(true);

      setWsConnectedMock.mockClear();
      closeWebSocket();

      expect(setWsConnectedMock).toHaveBeenCalledWith(false);
      expect(instances[0].close).toHaveBeenCalled();
      expect(hasActiveWebSocket()).toBe(false);
    });

    it('clears reconcile timer on close', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const pollMock = vi.fn().mockResolvedValue(undefined);
      const { connectTeamWebSocket, closeWebSocket, setPollingBridge } = await loadWebSocketModule({
        apiMock,
      });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: pollMock,
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();

      closeWebSocket();

      // Advance well past any reconcile timer — poll should not fire
      pollMock.mockClear();
      await vi.advanceTimersByTimeAsync(500);

      expect(pollMock).not.toHaveBeenCalled();
    });

    it('is safe to call when no WebSocket is active', async () => {
      const { closeWebSocket, setWsConnectedMock } = await loadWebSocketModule();

      // Should not throw
      expect(() => closeWebSocket()).not.toThrow();
      expect(setWsConnectedMock).toHaveBeenCalledWith(false);
    });
  });

  // -----------------------------------------------------------------------
  // hasActiveWebSocket
  // -----------------------------------------------------------------------
  describe('hasActiveWebSocket', () => {
    it('returns false initially', async () => {
      const { hasActiveWebSocket } = await loadWebSocketModule();
      expect(hasActiveWebSocket()).toBe(false);
    });

    it('returns true after a connection is established', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const { connectTeamWebSocket, setPollingBridge, hasActiveWebSocket } =
        await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();

      // WebSocket is created even before onopen
      expect(hasActiveWebSocket()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Auth token subscription
  // -----------------------------------------------------------------------
  describe('auth token subscription', () => {
    it('closes WebSocket when auth token changes', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const { connectTeamWebSocket, setPollingBridge, setWsConnectedMock, hasActiveWebSocket } =
        await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();

      expect(hasActiveWebSocket()).toBe(true);

      // Simulate auth token change via the subscriber
      expect(authSubscribers.length).toBeGreaterThan(0);
      authSubscribers[0]({ token: 'new_token' }, { token: 'tok_abc' });

      expect(hasActiveWebSocket()).toBe(false);
      expect(setWsConnectedMock).toHaveBeenCalledWith(false);
    });

    it('does not close WebSocket when token stays the same', async () => {
      vi.useFakeTimers();
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const { connectTeamWebSocket, setPollingBridge, hasActiveWebSocket } =
        await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await connectTeamWebSocket('t_team1');
      await flushPromises();
      instances[0]._open();

      // Simulate a state change where token did NOT change
      authSubscribers[0]({ token: 'tok_abc' }, { token: 'tok_abc' });

      expect(hasActiveWebSocket()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Guard: team changed while waiting for ticket
  // -----------------------------------------------------------------------
  describe('guards during ticket fetch', () => {
    it('aborts if active team changes while fetching ticket', async () => {
      const teamState = { activeTeamId: 't_team1' };

      vi.resetModules();
      authSubscribers = [];

      const apiMock = vi.fn().mockImplementation(async () => {
        // Simulate team change during API call
        teamState.activeTeamId = 't_OTHER';
        return { ticket: 'tkt_1' };
      });

      vi.doMock('../../api.js', () => ({
        api: apiMock,
        getApiUrl: () => 'https://chinwag-api.example.workers.dev',
        getRuntimeTargets: () => ({
          profile: 'prod',
          apiUrl: 'https://chinwag-api.example.workers.dev',
          teamWsOrigin: 'wss://chinwag-api.example.workers.dev',
        }),
      }));
      vi.doMock('@chinwag/shared/dashboard-ws.js', () => ({
        applyDelta: vi.fn(),
      }));
      vi.doMock('../../constants.js', () => ({
        RECONCILE_INITIAL_MS: 100,
        RECONCILE_MAX_MS: 400,
      }));
      vi.doMock('../auth.js', () => ({
        authActions: {
          getState: () => ({ token: 'tok_abc' }),
          subscribe: vi.fn((cb) => {
            authSubscribers.push(cb);
            return () => {};
          }),
        },
      }));
      vi.doMock('../teams.js', () => ({
        teamActions: {
          getState: () => teamState,
        },
      }));
      vi.doMock('../refresh.js', () => ({
        setWsConnected: vi.fn(),
      }));

      const mod = await import('../websocket.js');

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await mod.connectTeamWebSocket('t_team1');
      await flushPromises();

      // No WebSocket should have been created
      expect(instances).toHaveLength(0);
    });

    it('aborts if auth token changes while fetching ticket', async () => {
      const authState = { token: 'tok_abc' };

      vi.resetModules();
      authSubscribers = [];

      const apiMock = vi.fn().mockImplementation(async () => {
        // Simulate token change during API call
        authState.token = 'tok_NEW';
        return { ticket: 'tkt_1' };
      });

      vi.doMock('../../api.js', () => ({
        api: apiMock,
        getApiUrl: () => 'https://chinwag-api.example.workers.dev',
        getRuntimeTargets: () => ({
          profile: 'prod',
          apiUrl: 'https://chinwag-api.example.workers.dev',
          teamWsOrigin: 'wss://chinwag-api.example.workers.dev',
        }),
      }));
      vi.doMock('@chinwag/shared/dashboard-ws.js', () => ({
        applyDelta: vi.fn(),
      }));
      vi.doMock('../../constants.js', () => ({
        RECONCILE_INITIAL_MS: 100,
        RECONCILE_MAX_MS: 400,
      }));
      vi.doMock('../auth.js', () => ({
        authActions: {
          getState: () => authState,
          subscribe: vi.fn((cb) => {
            authSubscribers.push(cb);
            return () => {};
          }),
        },
      }));
      vi.doMock('../teams.js', () => ({
        teamActions: {
          getState: () => ({ activeTeamId: 't_team1' }),
        },
      }));
      vi.doMock('../refresh.js', () => ({
        setWsConnected: vi.fn(),
      }));

      const mod = await import('../websocket.js');

      const { MockWebSocket, instances } = createMockWebSocketClass();
      globalThis.WebSocket = MockWebSocket;

      await mod.connectTeamWebSocket('t_team1');
      await flushPromises();

      // No WebSocket should have been created
      expect(instances).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // WebSocket constructor failure
  // -----------------------------------------------------------------------
  describe('WebSocket constructor failure', () => {
    it('stays on polling when WebSocket constructor throws', async () => {
      const apiMock = vi.fn().mockResolvedValue({ ticket: 'tkt_1' });
      const { connectTeamWebSocket, setPollingBridge, hasActiveWebSocket } =
        await loadWebSocketModule({ apiMock });

      setPollingBridge({
        setState: vi.fn(),
        getState: vi.fn(() => ({})),
        stopPollTimer: vi.fn(),
        restartPolling: vi.fn(),
        poll: vi.fn(),
      });

      globalThis.WebSocket = function () {
        throw new Error('WebSocket not supported');
      };

      await connectTeamWebSocket('t_team1');
      await flushPromises();

      expect(hasActiveWebSocket()).toBe(false);
    });
  });
});
