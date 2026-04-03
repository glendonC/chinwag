import { createStore, useStore } from 'zustand';
import { api } from '../api.js';
import { POLL_MS, SLOW_POLL_MS } from '../constants.js';
import { authActions } from './auth.js';
import { teamActions } from './teams.js';
import { requestRefresh, setRefreshHandler } from './refresh.js';
import { closeWebSocket, connectTeamWebSocket, setPollingBridge } from './websocket.js';

type DataStatus = 'idle' | 'loading' | 'ready' | 'stale' | 'error';

interface PollingState {
  dashboardData: unknown;
  dashboardStatus: DataStatus;
  contextData: unknown;
  contextStatus: DataStatus;
  contextTeamId: string | null;
  pollError: string | null;
  pollErrorData: unknown;
  lastUpdate: Date | null;
}

/**
 * Internal mutable state for the polling subsystem.
 * Encapsulated in a single object so it's easy to reset and test.
 * `pollingBridge` is intentionally kept separate — it's a cross-module
 * callback interface, not internal polling state.
 */
interface InternalPollingState {
  /** setInterval ID for the poll timer. */
  pollTimer: ReturnType<typeof setInterval> | null;
  /** API failure counter — triggers slow mode at 3+. */
  consecutiveFailures: number;
  /** Incremented on every WebSocket state update. If a poll started before
   *  a WS update and finishes after, the poll result is stale — skip it. */
  dataVersion: number;
  /** AbortController for the current poll cycle. Aborted on new polls,
   *  team switches, stop, and logout so stale fetches never land. */
  pollAbortController: AbortController | null;
}

function createPollingState(): InternalPollingState {
  return {
    pollTimer: null,
    consecutiveFailures: 0,
    dataVersion: 0,
    pollAbortController: null,
  };
}

const pollState = createPollingState();

const pollingStore = createStore<PollingState>(() => ({
  dashboardData: null,
  dashboardStatus: 'idle',
  contextData: null,
  contextStatus: 'idle',
  contextTeamId: null,
  pollError: null,
  pollErrorData: null,
  lastUpdate: null,
}));

// Wire up the bridge so the WebSocket module can update polling state
// without a circular import.
setPollingBridge({
  setState: (...args: unknown[]) => {
    pollState.dataVersion++;
    (pollingStore.setState as (...a: unknown[]) => void)(...args);
  },
  getState: pollingStore.getState,
  stopPollTimer() {
    if (pollState.pollTimer) {
      clearInterval(pollState.pollTimer);
      pollState.pollTimer = null;
    }
  },
  restartPolling,
  poll,
});

/** Abort the current poll controller (if any) and return a fresh signal. */
function resetAbortController(): AbortSignal {
  if (pollState.pollAbortController) pollState.pollAbortController.abort();
  pollState.pollAbortController = new AbortController();
  return pollState.pollAbortController.signal;
}

interface ApiError extends Error {
  status?: number;
  data?: { error?: string; failed_teams?: unknown[] };
}

interface DashboardResponse {
  failed_teams?: unknown[];
  [key: string]: unknown;
}

/** Single poll cycle. */
async function poll(): Promise<void> {
  const snapshotTeamId = teamActions.getState().activeTeamId;
  const { token } = authActions.getState();
  if (!token) return;

  const signal = resetAbortController();

  try {
    if (snapshotTeamId === null) {
      pollingStore.setState((state) => ({
        contextData: null,
        contextTeamId: null,
        contextStatus: 'idle' as DataStatus,
        dashboardStatus: state.dashboardData ? state.dashboardStatus : ('loading' as DataStatus),
      }));
      const data = await api<DashboardResponse>('GET', '/me/dashboard', null, token, { signal });
      if (data.failed_teams?.length && (data.failed_teams.length as number) > 0) {
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
      const versionBeforeFetch = pollState.dataVersion;
      pollingStore.setState((state) => {
        const sameTeam = state.contextTeamId === snapshotTeamId;
        return {
          dashboardData: null,
          dashboardStatus: 'idle' as DataStatus,
          contextData: sameTeam ? state.contextData : null,
          contextStatus: (sameTeam && state.contextData
            ? state.contextStatus
            : 'loading') as DataStatus,
          contextTeamId: snapshotTeamId,
        };
      });
      await teamActions.ensureJoined(snapshotTeamId);
      const data = await api('GET', `/teams/${snapshotTeamId}/context`, null, token, { signal });
      if (teamActions.getState().activeTeamId !== snapshotTeamId) return;
      // Skip if WebSocket delivered newer data while this fetch was in flight
      if (pollState.dataVersion !== versionBeforeFetch) return;
      pollingStore.setState({
        contextData: data,
        contextStatus: 'ready',
        contextTeamId: snapshotTeamId,
        dashboardData: null,
        dashboardStatus: 'idle',
      });
    }

    pollingStore.setState({ pollError: null, pollErrorData: null, lastUpdate: new Date() });

    if (pollState.consecutiveFailures > 0) {
      pollState.consecutiveFailures = 0;
      restartPolling();
    }
  } catch (err) {
    // Aborted requests are not failures — silently discard them.
    if ((err as Error)?.name === 'AbortError') return;

    if ((err as ApiError).status === 401) {
      authActions.logout();
      stopPolling();
      return;
    }
    if (teamActions.getState().activeTeamId !== snapshotTeamId) return;
    if (
      snapshotTeamId === null &&
      (err as ApiError)?.data?.failed_teams?.length &&
      ((err as ApiError).data!.failed_teams!.length as number) > 0
    ) {
      await teamActions.loadTeams();
    }
    pollState.consecutiveFailures++;
    const pollError = formatError(err);
    const pollErrorData = (err as ApiError)?.data || null;
    if (snapshotTeamId === null) {
      pollingStore.setState((state) => ({
        pollError,
        pollErrorData,
        dashboardStatus: (state.dashboardData ? 'stale' : 'error') as DataStatus,
        contextData: null,
        contextStatus: 'idle' as DataStatus,
        contextTeamId: null,
      }));
    } else {
      pollingStore.setState((state) => {
        const hasSnapshot = state.contextTeamId === snapshotTeamId && !!state.contextData;
        return {
          pollError,
          pollErrorData,
          dashboardData: null,
          dashboardStatus: 'idle' as DataStatus,
          contextStatus: (hasSnapshot ? 'stale' : 'error') as DataStatus,
          contextTeamId: snapshotTeamId,
        };
      });
    }
    if (pollState.consecutiveFailures >= 3) restartPolling();
  }
}

setRefreshHandler(poll);

function restartPolling(): void {
  stopPollTimer();
  const delay = pollState.consecutiveFailures >= 3 ? SLOW_POLL_MS : POLL_MS;
  pollState.pollTimer = setInterval(poll, delay);
}

/** Stop only the HTTP poll timer (leaves WebSocket untouched). */
function stopPollTimer(): void {
  if (pollState.pollAbortController) {
    pollState.pollAbortController.abort();
    pollState.pollAbortController = null;
  }
  if (pollState.pollTimer) {
    clearInterval(pollState.pollTimer);
    pollState.pollTimer = null;
  }
}

function formatError(err: unknown): string {
  if (typeof err === 'string') return err;
  const msg = (err as Error)?.message || 'Something went wrong';
  if ((err as ApiError)?.status === 408) return 'Request timed out. Try again.';
  if (msg.includes('Failed to fetch') || (err as Error)?.name === 'TypeError') {
    return 'Cannot reach server. Check your connection.';
  }
  return msg;
}

/** Start polling. Attempts WebSocket for project view, falls back to polling. */
export function startPolling(): void {
  stopPolling();
  poll(); // immediate first poll

  const { activeTeamId } = teamActions.getState();
  if (activeTeamId) {
    // Project view — try WebSocket, polling runs as fallback until WS connects
    const delay = pollState.consecutiveFailures >= 3 ? SLOW_POLL_MS : POLL_MS;
    pollState.pollTimer = setInterval(poll, delay);
    connectTeamWebSocket(activeTeamId);
  } else {
    // Overview — polling only (aggregates across all teams, no single-team WS)
    const delay = pollState.consecutiveFailures >= 3 ? SLOW_POLL_MS : POLL_MS;
    pollState.pollTimer = setInterval(poll, delay);
  }
}

/** Stop polling and close WebSocket. */
export function stopPolling(): void {
  stopPollTimer();
  closeWebSocket();
}

/** Reset all polling state (call on logout to prevent stale data on re-login). */
export function resetPollingState(): void {
  stopPolling();
  if (pollState.pollAbortController) {
    pollState.pollAbortController.abort();
  }
  Object.assign(pollState, createPollingState());
  pollingStore.setState({
    dashboardData: null,
    dashboardStatus: 'idle',
    contextData: null,
    contextStatus: 'idle',
    contextTeamId: null,
    pollError: null,
    pollErrorData: null,
    lastUpdate: null,
  });
}

// Module-level listener — intentionally never removed. This store is a singleton
// that lives for the entire app lifetime. Attaching once is correct.
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
export function forceRefresh(): void {
  requestRefresh();
}

/** React hook — use inside components */
export function usePollingStore<T>(selector: (state: PollingState) => T): T {
  return useStore(pollingStore, selector);
}

/** Direct access — use outside components and in tests */
export const pollingActions = {
  getState: (): PollingState => pollingStore.getState(),
  subscribe: pollingStore.subscribe,
};
