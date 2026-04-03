import { api, getApiUrl } from '../api.js';
import { applyDelta } from '@chinwag/shared/dashboard-ws.js';
import { RECONCILE_INITIAL_MS, RECONCILE_MAX_MS } from '../constants.js';
import { authActions } from './auth.js';
import { teamActions } from './teams.js';
import { setWsConnected } from './refresh.js';

let activeWs: WebSocket | null = null;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let reconcileDelay: number = RECONCILE_INITIAL_MS;
let reconcileInFlight = false;
/** Monotonic generation counter — prevents stale onclose handlers from
 *  restarting polling after a newer connection has replaced them. */
let wsGeneration = 0;

/**
 * Callbacks into the polling module.
 * Set via `setPollingBridge` to avoid circular imports.
 */
export interface PollingBridge {
  setState: (...args: unknown[]) => void;
  getState: () => unknown;
  stopPollTimer: () => void;
  restartPolling: () => void;
  poll: () => Promise<void> | void;
}

let pollingBridge: PollingBridge = {
  setState: () => {},
  getState: () => ({}),
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

  // Fetch a short-lived ticket — keeps the real token out of the WS URL
  let ticket: string;
  try {
    const data = await api<WsTicketResponse>('POST', '/auth/ws-ticket', null, token);
    ticket = data.ticket;
  } catch {
    return; // polling continues as fallback
  }

  // Guard: auth may have changed while waiting for the ticket
  if (authActions.getState().token !== token) return;

  // Guard: team may have changed while waiting for ticket
  if (teamActions.getState().activeTeamId !== teamId) return;

  // Guard: a newer connectTeamWebSocket call superseded this one
  if (wsGeneration !== gen) return;

  const wsBase = getApiUrl().replace(/^http/, 'ws');
  const agentId = `web-dashboard:${token.slice(0, 8)}`;
  const wsUrl = `${wsBase}/teams/${teamId}/ws?agentId=${encodeURIComponent(agentId)}&ticket=${encodeURIComponent(ticket)}`;

  /** Schedule the next reconciliation poll with exponential backoff. */
  function scheduleReconcile(expectedGen: number): void {
    reconcileTimer = setTimeout(async () => {
      if (wsGeneration !== expectedGen) return;
      if (reconcileInFlight) return; // previous reconcile still running
      reconcileInFlight = true;
      try {
        await pollingBridge.poll();
      } finally {
        reconcileInFlight = false;
      }
      // Double the delay, capped at max
      reconcileDelay = Math.min(reconcileDelay * 2, RECONCILE_MAX_MS);
      scheduleReconcile(expectedGen);
    }, reconcileDelay);
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
      setWsConnected(true);
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
      // Reset reconciliation backoff — fresh data means less need to poll soon,
      // but restarting the timer ensures we reconcile relative to the last event.
      reconcileDelay = RECONCILE_INITIAL_MS;
      if (reconcileTimer) {
        clearTimeout(reconcileTimer);
        reconcileTimer = null;
      }
      scheduleReconcile(gen);
      try {
        const event = JSON.parse(evt.data as string) as Record<string, unknown>;
        if (event.type === 'context') {
          pollingBridge.setState({
            contextData: event.data,
            contextStatus: 'ready',
            contextTeamId: teamId,
            pollError: null,
            pollErrorData: null,
            lastUpdate: new Date(),
          });
        } else {
          pollingBridge.setState((state: Record<string, unknown>) => {
            if (state.contextTeamId !== teamId || !state.contextData) return state;
            return {
              contextData: applyDelta(state.contextData as Parameters<typeof applyDelta>[0], event),
              lastUpdate: new Date(),
            };
          });
        }
      } catch (e) {
        console.warn('[chinwag] Malformed WS event:', (e as Error).message);
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
      // Fall back to polling if we're still on this team
      if (teamActions.getState().activeTeamId === teamId) {
        pollingBridge.restartPolling();
      }
    };

    ws.onerror = () => {
      /* onclose fires after */
    };

    activeWs = ws;
  } catch {
    // WebSocket constructor failed — stay on polling
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
