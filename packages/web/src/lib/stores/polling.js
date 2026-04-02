import { createStore, useStore } from 'zustand';
import { api, getApiUrl } from '../api.js';
import { authActions } from './auth.js';
import { teamActions } from './teams.js';
import { requestRefresh, setRefreshHandler } from './refresh.js';
import { applyDelta } from '../../../../shared/dashboard-ws.js';

const POLL_MS = 5000;
const SLOW_POLL_MS = 30000;
const RECONCILE_MS = 60_000;

let pollTimer = null;
let consecutiveFailures = 0;
let activeWs = null;
let reconcileTimer = null;

const pollingStore = createStore((set, get) => ({
  dashboardData: null,
  dashboardStatus: 'idle',
  contextData: null,
  contextStatus: 'idle',
  contextTeamId: null,
  pollError: null,
  pollErrorData: null,
  lastUpdate: null,
}));

/** Single poll cycle. */
async function poll() {
  const { activeTeamId } = teamActions.getState();
  const { token } = authActions.getState();
  if (!token) return;

  try {
    if (activeTeamId === null) {
      pollingStore.setState((state) => ({
        contextData: null,
        contextTeamId: null,
        contextStatus: 'idle',
        dashboardStatus: state.dashboardData ? state.dashboardStatus : 'loading',
      }));
      const data = await api('GET', '/me/dashboard', null, token);
      if (data.failed_teams?.length > 0) {
        await teamActions.loadTeams();
      }
      if (teamActions.getState().activeTeamId !== null) return;
      pollingStore.setState({
        dashboardData: data,
        dashboardStatus: 'ready',
        contextData: null,
        contextStatus: 'idle',
        contextTeamId: null,
      });
    } else {
      pollingStore.setState((state) => {
        const sameTeam = state.contextTeamId === activeTeamId;
        return {
          dashboardData: null,
          dashboardStatus: 'idle',
          contextData: sameTeam ? state.contextData : null,
          contextStatus: sameTeam && state.contextData ? state.contextStatus : 'loading',
          contextTeamId: activeTeamId,
        };
      });
      await teamActions.ensureJoined(activeTeamId);
      const data = await api('GET', `/teams/${activeTeamId}/context`, null, token);
      if (teamActions.getState().activeTeamId !== activeTeamId) return;
      pollingStore.setState({
        contextData: data,
        contextStatus: 'ready',
        contextTeamId: activeTeamId,
        dashboardData: null,
        dashboardStatus: 'idle',
      });
    }

    pollingStore.setState({ pollError: null, pollErrorData: null, lastUpdate: new Date() });

    if (consecutiveFailures > 0) {
      consecutiveFailures = 0;
      restartPolling();
    }
  } catch (err) {
    if (err.status === 401) {
      authActions.logout();
      stopPolling();
      return;
    }
    if (teamActions.getState().activeTeamId !== activeTeamId) return;
    if (activeTeamId === null && err?.data?.failed_teams?.length > 0) {
      await teamActions.loadTeams();
    }
    consecutiveFailures++;
    const pollError = formatError(err);
    const pollErrorData = err?.data || null;
    if (activeTeamId === null) {
      pollingStore.setState((state) => ({
        pollError,
        pollErrorData,
        dashboardStatus: state.dashboardData ? 'stale' : 'error',
        contextData: null,
        contextStatus: 'idle',
        contextTeamId: null,
      }));
    } else {
      pollingStore.setState((state) => {
        const hasSnapshot = state.contextTeamId === activeTeamId && !!state.contextData;
        return {
          pollError,
          pollErrorData,
          dashboardData: null,
          dashboardStatus: 'idle',
          contextStatus: hasSnapshot ? 'stale' : 'error',
          contextTeamId: activeTeamId,
        };
      });
    }
    if (consecutiveFailures >= 3) restartPolling();
  }
}

setRefreshHandler(poll);

function restartPolling() {
  stopPolling();
  const delay = consecutiveFailures >= 3 ? SLOW_POLL_MS : POLL_MS;
  pollTimer = setInterval(poll, delay);
}

/** Close any active WebSocket and its reconciliation timer. */
function closeWebSocket() {
  if (reconcileTimer) { clearInterval(reconcileTimer); reconcileTimer = null; }
  if (activeWs) {
    try { activeWs.close(); } catch {}
    activeWs = null;
  }
}

/**
 * Attempt a WebSocket connection for project (single-team) view.
 * Falls back to polling if WebSocket fails.
 */
function connectTeamWebSocket(teamId) {
  const { token } = authActions.getState();
  if (!token || !teamId) return;

  const wsBase = getApiUrl().replace(/^http/, 'ws');
  const agentId = `web-dashboard:${token.slice(0, 8)}`;
  const wsUrl = `${wsBase}/teams/${teamId}/ws?agentId=${encodeURIComponent(agentId)}&token=${encodeURIComponent(token)}`;

  try {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (teamActions.getState().activeTeamId !== teamId) { ws.close(); return; }
      // WebSocket connected — stop polling, start reconciliation
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (reconcileTimer) { clearInterval(reconcileTimer); reconcileTimer = null; }
      reconcileTimer = setInterval(poll, RECONCILE_MS);
    };

    ws.onmessage = (evt) => {
      if (teamActions.getState().activeTeamId !== teamId) return;
      try {
        const event = JSON.parse(evt.data);
        if (event.type === 'context') {
          pollingStore.setState({
            contextData: event.data,
            contextStatus: 'ready',
            contextTeamId: teamId,
            pollError: null,
            pollErrorData: null,
            lastUpdate: new Date(),
          });
        } else {
          pollingStore.setState((state) => {
            if (state.contextTeamId !== teamId || !state.contextData) return state;
            return {
              contextData: applyDelta(state.contextData, event),
              lastUpdate: new Date(),
            };
          });
        }
      } catch { /* malformed event */ }
    };

    ws.onclose = () => {
      activeWs = null;
      if (reconcileTimer) { clearInterval(reconcileTimer); reconcileTimer = null; }
      // Fall back to polling if we're still on this team
      if (teamActions.getState().activeTeamId === teamId) {
        restartPolling();
      }
    };

    ws.onerror = () => { /* onclose fires after */ };

    activeWs = ws;
  } catch {
    // WebSocket constructor failed — stay on polling
  }
}

function formatError(err) {
  if (typeof err === 'string') return err;
  const msg = err?.message || 'Something went wrong';
  if (err?.status === 408) return 'Request timed out. Try again.';
  if (msg.includes('Failed to fetch') || err?.name === 'TypeError') {
    return 'Cannot reach server. Check your connection.';
  }
  return msg;
}

/** Start polling. Attempts WebSocket for project view, falls back to polling. */
export function startPolling() {
  stopPolling();
  poll(); // immediate first poll

  const { activeTeamId } = teamActions.getState();
  if (activeTeamId) {
    // Project view — try WebSocket, polling runs as fallback until WS connects
    const delay = consecutiveFailures >= 3 ? SLOW_POLL_MS : POLL_MS;
    pollTimer = setInterval(poll, delay);
    connectTeamWebSocket(activeTeamId);
  } else {
    // Overview — polling only (aggregates across all teams, no single-team WS)
    const delay = consecutiveFailures >= 3 ? SLOW_POLL_MS : POLL_MS;
    pollTimer = setInterval(poll, delay);
  }
}

/** Stop polling and close WebSocket. */
export function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  closeWebSocket();
}

// Pause polling when tab is hidden, resume when visible
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else if (authActions.getState().token) {
      startPolling();
    }
  });
}

/** Force an immediate poll cycle (use after mutations to refresh data). */
export function forceRefresh() {
  requestRefresh();
}

/** React hook — use inside components */
export function usePollingStore(selector) {
  return useStore(pollingStore, selector);
}

/** Direct access — use outside components and in tests */
export const pollingActions = {
  getState: () => pollingStore.getState(),
  subscribe: pollingStore.subscribe,
};
