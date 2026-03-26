import { createStore, useStore } from 'zustand';
import { api } from '../api.js';
import { authActions } from './auth.js';
import { teamActions } from './teams.js';
import { requestRefresh, setRefreshHandler } from './refresh.js';

const POLL_MS = 5000;
const SLOW_POLL_MS = 30000;

let pollTimer = null;
let consecutiveFailures = 0;

const pollingStore = createStore((set, get) => ({
  dashboardData: null,
  contextData: null,
  pollError: null,
  lastUpdate: null,
}));

/** Single poll cycle. */
async function poll() {
  const { activeTeamId } = teamActions.getState();
  const { token } = authActions.getState();
  if (!token) return;

  try {
    if (activeTeamId === null) {
      // Overview mode
      pollingStore.setState({ contextData: null });
      const data = await api('GET', '/me/dashboard', null, token);
      if (teamActions.getState().activeTeamId !== null) return;
      pollingStore.setState({ dashboardData: data, contextData: null });
    } else {
      // Single team mode
      pollingStore.setState({ dashboardData: null });
      await teamActions.ensureJoined(activeTeamId);
      const data = await api('GET', `/teams/${activeTeamId}/context`, null, token);
      // Verify we haven't switched teams during the request
      if (teamActions.getState().activeTeamId !== activeTeamId) return;
      pollingStore.setState({ contextData: data, dashboardData: null });
    }

    pollingStore.setState({ pollError: null, lastUpdate: new Date() });

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
    consecutiveFailures++;
    pollingStore.setState({ pollError: formatError(err) });
    if (consecutiveFailures >= 3) restartPolling();
  }
}

setRefreshHandler(poll);

function restartPolling() {
  stopPolling();
  const delay = consecutiveFailures >= 3 ? SLOW_POLL_MS : POLL_MS;
  pollTimer = setInterval(poll, delay);
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

/** Start polling. Automatically determines mode from activeTeamId. */
export function startPolling() {
  stopPolling();
  poll(); // immediate first poll
  const delay = consecutiveFailures >= 3 ? SLOW_POLL_MS : POLL_MS;
  pollTimer = setInterval(poll, delay);
}

/** Stop polling. */
export function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
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
