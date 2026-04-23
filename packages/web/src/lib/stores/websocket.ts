import { api, getRuntimeTargets } from '../api.js';
import { applyDelta } from '@chinmeister/shared/dashboard-ws.js';
import type { TeamContext } from '../apiSchemas.js';
import { RECONCILE_INITIAL_MS, RECONCILE_MAX_MS } from '../constants.js';
import { authActions } from './auth.js';
import { teamActions } from './teams.js';
import { setWsConnected } from './refresh.js';
import {
  type PollingBridge,
  type ConnectionState,
  buildContextReadyPatch,
  buildContextDeltaPatch,
} from './pollingTypes.js';

export type { PollingBridge, ConnectionState };

let activeWs: WebSocket | null = null;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let reconcileDelay: number = RECONCILE_INITIAL_MS;
let reconcileInFlight = false;
/** Monotonic generation counter — prevents stale onclose handlers from
 *  restarting polling after a newer connection has replaced them. */
let wsGeneration = 0;
/** Track reconnection attempts for the connection state machine. */
let reconnectAttempt = 0;

let connectionState: ConnectionState = { status: 'initial' };

/** Listeners for connection state changes. */
const connectionListeners = new Set<(state: ConnectionState) => void>();

function setConnectionState(next: ConnectionState): void {
  connectionState = next;
  for (const listener of connectionListeners) listener(next);
}

/** Subscribe to connection state changes. Returns an unsubscribe function. */
export function subscribeConnectionState(listener: (state: ConnectionState) => void): () => void {
  connectionListeners.add(listener);
  return () => connectionListeners.delete(listener);
}

/** Get the current connection state snapshot. */
export function getConnectionState(): ConnectionState {
  return connectionState;
}

let pollingBridge: PollingBridge = {
  setState: () => {},
  getState: () => ({
    dashboardData: null,
    dashboardStatus: 'idle',
    contextData: null,
    contextStatus: 'idle',
    contextTeamId: null,
    pollError: null,
    pollErrorData: null,
    lastUpdate: null,
    consecutiveFailures: 0,
  }),
  stopPollTimer: () => {},
  restartPolling: () => {},
  poll: () => {},
};

/** Called by the polling module to wire up cross-store coordination. */
export function setPollingBridge(bridge: PollingBridge): void {
  pollingBridge = bridge;
}

/** Close any active WebSocket and its reconciliation timer. */
export function closeWebSocket(): void {
  if (reconcileTimer) {
    clearTimeout(reconcileTimer);
    reconcileTimer = null;
  }
  reconcileDelay = RECONCILE_INITIAL_MS;
  reconcileInFlight = false;
  setWsConnected(false);
  setConnectionState({ status: 'offline', since: Date.now() });
  if (activeWs) {
    // Bump generation so the closing socket's onclose handler becomes a no-op
    wsGeneration++;
    try {
      activeWs.close();
    } catch {
      /* best-effort */
    }
    activeWs = null;
  }
}

interface WsTicketResponse {
  ticket: string;
}

/**
 * Attempt a WebSocket connection for project (single-team) view.
 * Falls back to polling if WebSocket fails.
 */
export async function connectTeamWebSocket(teamId: string): Promise<void> {
  const { token } = authActions.getState();
  if (!token || !teamId) return;

  // Close any existing connection before opening a new one
  closeWebSocket();

  // Capture the generation at the start — if it changes, a newer call
  // has superseded this one and we should bail out.
  const gen = ++wsGeneration;

  setConnectionState(
    reconnectAttempt > 0
      ? { status: 'reconnecting', attempt: reconnectAttempt }
      : { status: 'connecting' },
  );

  // Fetch a short-lived ticket — keeps the real token out of the WS URL
  let ticket: string;
  try {
    const data = await api<WsTicketResponse>('POST', '/auth/ws-ticket', null, token);
    ticket = data.ticket;
  } catch {
    setConnectionState({ status: 'error', error: 'Failed to obtain WebSocket ticket' });
    return; // polling continues as fallback
  }

  // Guard: auth may have changed while waiting for the ticket
  if (authActions.getState().token !== token) return;

  // Guard: team may have changed while waiting for ticket
  if (teamActions.getState().activeTeamId !== teamId) return;

  // Guard: a newer connectTeamWebSocket call superseded this one
  if (wsGeneration !== gen) return;

  const wsBase = getRuntimeTargets().teamWsOrigin;
  const agentId = `web-dashboard:${token.slice(0, 8)}`;
  const wsUrl = `${wsBase}/teams/${teamId}/ws?agentId=${encodeURIComponent(agentId)}&ticket=${encodeURIComponent(ticket)}`;

  /** Schedule the next reconciliation poll with exponential backoff + jitter. */
  function scheduleReconcile(expectedGen: number): void {
    // Apply jitter: use 50-100% of the current delay to avoid thundering-herd
    const jitteredDelay = Math.round(reconcileDelay * (0.5 + Math.random() * 0.5));
    // Pre-compute the next delay so it's ready for the following iteration
    reconcileDelay = Math.min(reconcileDelay * 2, RECONCILE_MAX_MS);
    reconcileTimer = setTimeout(async () => {
      if (wsGeneration !== expectedGen) return;
      if (reconcileInFlight) return; // previous reconcile still running
      reconcileInFlight = true;
      try {
        await pollingBridge.poll();
      } finally {
        reconcileInFlight = false;
      }
      scheduleReconcile(expectedGen);
    }, jitteredDelay);
  }

  try {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // Stale connection — a newer generation has taken over
      if (wsGeneration !== gen) {
        ws.close();
        return;
      }
      if (teamActions.getState().activeTeamId !== teamId) {
        ws.close();
        return;
      }
      // WebSocket connected — stop polling, start reconciliation with backoff
      reconnectAttempt = 0;
      setWsConnected(true);
      setConnectionState({ status: 'connected', connectedAt: Date.now() });
      pollingBridge.stopPollTimer();
      if (reconcileTimer) {
        clearTimeout(reconcileTimer);
        reconcileTimer = null;
      }
      reconcileDelay = RECONCILE_INITIAL_MS;
      scheduleReconcile(gen);
    };

    ws.onmessage = (evt: MessageEvent) => {
      if (wsGeneration !== gen) return;
      if (teamActions.getState().activeTeamId !== teamId) return;
      // Restart the reconciliation timer relative to the last event, but
      // preserve the current backoff delay — resetting on every message would
      // defeat exponential backoff under high-frequency streams.
      if (reconcileTimer) {
        clearTimeout(reconcileTimer);
        reconcileTimer = null;
      }
      scheduleReconcile(gen);
      try {
        const event = JSON.parse(evt.data as string) as Record<string, unknown>;
        if (event.type === 'context') {
          pollingBridge.setState(buildContextReadyPatch(teamId, event.data as TeamContext));
        } else {
          pollingBridge.setState((state) => {
            const patch = buildContextDeltaPatch(
              state,
              teamId,
              applyDelta as (context: unknown, event: unknown) => unknown,
              event,
            );
            // Return full state (identity) when delta cannot be applied —
            // Zustand skips the update when the return is the same reference.
            return patch ?? state;
          });
        }
      } catch (e) {
        console.warn('[chinmeister] Malformed WS event:', (e as Error).message);
      }
    };

    ws.onclose = () => {
      // Only act if this is still the active generation — prevents a
      // replaced connection from interfering with its successor.
      if (wsGeneration !== gen) return;
      activeWs = null;
      setWsConnected(false);
      if (reconcileTimer) {
        clearTimeout(reconcileTimer);
        reconcileTimer = null;
      }
      reconcileDelay = RECONCILE_INITIAL_MS;
      // Fall back to polling if we're still on this team AND still authenticated
      if (teamActions.getState().activeTeamId === teamId && authActions.getState().token) {
        reconnectAttempt++;
        setConnectionState({ status: 'reconnecting', attempt: reconnectAttempt });
        pollingBridge.restartPolling();
      } else {
        setConnectionState({ status: 'offline', since: Date.now() });
      }
    };

    ws.onerror = () => {
      /* onclose fires after */
    };

    activeWs = ws;
  } catch {
    // WebSocket constructor failed — stay on polling
    setConnectionState({ status: 'error', error: 'WebSocket constructor failed' });
  }
}

// Module-level subscription — intentionally never unsubscribed. Ensures the
// WebSocket is closed whenever the auth token changes (logout, refresh, etc.).
authActions.subscribe((state, prev) => {
  if (state.token !== prev?.token) {
    closeWebSocket();
  }
});

/** Returns true if a WebSocket is currently open or connecting. */
export function hasActiveWebSocket(): boolean {
  return activeWs !== null;
}
