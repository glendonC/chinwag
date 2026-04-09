import { createStore, useStore } from 'zustand';
import { api } from '../api.js';
import { POLL_MS, SLOW_POLL_MS } from '../constants.js';
import {
  type TeamContext,
  type DashboardSummary,
  teamContextSchema,
  dashboardSummarySchema,
  validateResponse,
  createEmptyTeamContext,
  createEmptyDashboardSummary,
} from '../apiSchemas.js';
import { authActions } from './auth.js';
import { teamActions, clearJoinedCache } from './teams.js';
import { requestRefresh, setRefreshHandler } from './refresh.js';
import { closeWebSocket, connectTeamWebSocket, setPollingBridge } from './websocket.js';
import { type PollingState, type DataStatus, buildContextReadyPatch } from './pollingTypes.js';

/**
 * Internal mutable state for the polling subsystem.
 * Encapsulated in a single object so it's easy to reset and test.
 * `pollingBridge` is intentionally kept separate — it's a cross-module
 * callback interface, not internal polling state.
 *
 * Note: `consecutiveFailures` lives in the Zustand store (not here) so
 * concurrent poll() calls cannot race on it. Timer/controller state stays
 * here because it is only ever mutated synchronously.
 */
interface InternalPollingState {
  /** setInterval ID for the poll timer. */
  pollTimer: ReturnType<typeof setInterval> | null;
  /** Incremented on every WebSocket state update. If a poll started before
   *  a WS update and finishes after, the poll result is stale — skip it. */
  dataVersion: number;
  /** AbortController for the current poll cycle. Aborted on new polls,
   *  team switches, stop, and logout so stale fetches never land. */
  pollAbortController: AbortController | null;
}

function createInternalPollingState(): InternalPollingState {
  return {
    pollTimer: null,
    dataVersion: 0,
    pollAbortController: null,
  };
}

const pollState = createInternalPollingState();

const pollingStore = createStore<PollingState>(() => ({
  dashboardData: null,
  dashboardStatus: 'idle',
  contextData: null,
  contextStatus: 'idle',
  contextTeamId: null,
  pollError: null,
  pollErrorData: null,
  lastUpdate: null,
  consecutiveFailures: 0,
}));

// Wire up the bridge so the WebSocket module can update polling state
// without a circular import.
setPollingBridge({
  setState: (partial) => {
    pollState.dataVersion++;
    pollingStore.setState(partial);
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

interface ApiErrorShape {
  status?: number;
  data?: { error?: string; failed_teams?: Array<{ team_id?: string; team_name?: string }> };
}

/** Safely extract ApiError-like properties from an unknown thrown value. */
function toApiError(err: unknown): ApiErrorShape {
  if (typeof err !== 'object' || err === null) return {};
  const result: ApiErrorShape = {};
  if ('status' in err && typeof err.status === 'number') {
    result.status = err.status;
  }
  if ('data' in err && typeof err.data === 'object' && err.data !== null) {
    result.data = err.data as ApiErrorShape['data'];
  }
  return result;
}

/** Check if an unknown error is an AbortError. */
function isAbortError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return 'name' in err && err.name === 'AbortError';
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
      const data = await api('GET', '/me/dashboard', null, token, { signal });
      const validated = validateResponse<DashboardSummary, DashboardSummary>(
        dashboardSummarySchema,
        data,
        'dashboard',
        { fallback: createEmptyDashboardSummary },
      );
      if (validated.failed_teams?.length && validated.failed_teams.length > 0) {
        await teamActions.loadTeams(false);
      }
      if (teamActions.getState().activeTeamId !== null) return;
      // Sync sidebar teams if the dashboard shows teams the store doesn't know about
      const knownIds = new Set((teamActions.getState().teams || []).map((t) => t.team_id));
      const hasMismatch =
        validated.teams.length !== knownIds.size ||
        validated.teams.some((t) => !knownIds.has(t.team_id));
      if (hasMismatch) teamActions.loadTeams(false);
      pollingStore.setState({
        dashboardData: validated,
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
      const validated = validateResponse<TeamContext, TeamContext>(
        teamContextSchema,
        data,
        'team-context',
        {
          fallback: createEmptyTeamContext,
        },
      );
      if (teamActions.getState().activeTeamId !== snapshotTeamId) return;
      // Skip if WebSocket delivered newer data while this fetch was in flight
      if (pollState.dataVersion !== versionBeforeFetch) return;
      pollingStore.setState({
        ...buildContextReadyPatch(snapshotTeamId, validated),
        dashboardData: null,
        dashboardStatus: 'idle',
      });
    }

    pollingStore.setState({ pollError: null, pollErrorData: null, lastUpdate: new Date() });

    // Read consecutiveFailures atomically from the store, then reset
    const { consecutiveFailures: prevFailures } = pollingStore.getState();
    if (prevFailures > 0) {
      pollingStore.setState({ consecutiveFailures: 0 });
      restartPolling();
    }
  } catch (err) {
    // Aborted requests are not failures — silently discard them.
    if (isAbortError(err)) return;

    const apiErr = toApiError(err);

    if (apiErr.status === 401) {
      authActions.logout();
      stopPolling();
      return;
    }
    // Member was evicted server-side (stale heartbeat). Clear the join
    // cache so the next poll cycle re-joins before fetching context.
    // After repeated 403s, eject to overview — the team is gone or
    // we've been permanently removed.
    if (apiErr.status === 403 && snapshotTeamId) {
      clearJoinedCache(snapshotTeamId);
      const { consecutiveFailures } = pollingStore.getState();
      if (consecutiveFailures >= 2) {
        teamActions.selectTeam(null);
        stopPolling();
        await teamActions.loadTeams(false);
        startPolling();
        return;
      }
    }
    if (teamActions.getState().activeTeamId !== snapshotTeamId) return;
    const failedTeams = apiErr.data?.failed_teams;
    if (snapshotTeamId === null && failedTeams && failedTeams.length > 0) {
      await teamActions.loadTeams(false);
    }
    const pollError = formatError(err);
    const pollErrorData = (apiErr.data || null) as DashboardSummary | null;
    if (snapshotTeamId === null) {
      pollingStore.setState((state) => ({
        pollError,
        pollErrorData,
        consecutiveFailures: state.consecutiveFailures + 1,
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
          consecutiveFailures: state.consecutiveFailures + 1,
          dashboardData: null,
          dashboardStatus: 'idle' as DataStatus,
          contextStatus: (hasSnapshot ? 'stale' : 'error') as DataStatus,
          contextTeamId: snapshotTeamId,
        };
      });
    }
    // Re-read from store after the atomic increment
    if (pollingStore.getState().consecutiveFailures >= 3) restartPolling();
  }
}

setRefreshHandler(poll);

/** Max consecutive failures before polling stops entirely (circuit breaker). */
const MAX_CONSECUTIVE_FAILURES = 20;

function restartPolling(): void {
  // Don't restart if auth is gone or failures have exceeded the circuit breaker
  const { token } = authActions.getState();
  const { consecutiveFailures } = pollingStore.getState();
  if (!token || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return;
  stopPollTimer();
  const delay = consecutiveFailures >= 3 ? SLOW_POLL_MS : POLL_MS;
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
  const msg = err instanceof Error ? err.message : 'Something went wrong';
  const apiErr = toApiError(err);
  if (apiErr.status === 408) return 'Request timed out. Try again.';
  if (msg.includes('Failed to fetch') || (err instanceof Error && err.name === 'TypeError')) {
    return 'Cannot reach server. Check your connection.';
  }
  return msg || 'Something went wrong';
}

/** Start polling. Attempts WebSocket for project view, falls back to polling. */
export function startPolling(): void {
  stopPolling();
  poll(); // immediate first poll

  const { activeTeamId } = teamActions.getState();
  const delay = pollingStore.getState().consecutiveFailures >= 3 ? SLOW_POLL_MS : POLL_MS;
  pollState.pollTimer = setInterval(poll, delay);
  if (activeTeamId) {
    // Project view — try WebSocket, polling runs as fallback until WS connects
    connectTeamWebSocket(activeTeamId);
  }
  // Overview — polling only (aggregates across all teams, no single-team WS)
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
  Object.assign(pollState, createInternalPollingState());
  pollingStore.setState({
    dashboardData: null,
    dashboardStatus: 'idle',
    contextData: null,
    contextStatus: 'idle',
    contextTeamId: null,
    pollError: null,
    pollErrorData: null,
    lastUpdate: null,
    consecutiveFailures: 0,
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

/** Inject demo data directly into the polling store (for ?demo=1 visual testing). */
export function injectDemoData(teamId: string, context: TeamContext): void {
  pollingStore.setState({
    contextData: context,
    contextStatus: 'ready',
    contextTeamId: teamId,
    pollError: null,
    pollErrorData: null,
    lastUpdate: new Date(),
    consecutiveFailures: 0,
  });
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
