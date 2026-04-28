/**
 * Shared types and helpers for the polling/websocket subsystem.
 *
 * Extracted to avoid circular imports between polling.ts and websocket.ts,
 * and to de-duplicate the context-state-update logic both modules perform.
 */

import type { TeamContext, DashboardSummary } from '../apiSchemas.js';

// ── Data status ─────────────────────────────────────

export type DataStatus = 'idle' | 'loading' | 'ready' | 'stale' | 'error';

// ── Polling store shape ─────────────────────────────

export interface PollingState {
  dashboardData: DashboardSummary | null;
  dashboardStatus: DataStatus;
  contextData: TeamContext | null;
  contextStatus: DataStatus;
  contextTeamId: string | null;
  pollError: string | null;
  pollErrorData: DashboardSummary | null;
  lastUpdate: Date | null;
  /** Consecutive API failures - drives slow-mode polling at 3+. */
  consecutiveFailures: number;
}

// ── Connection state machine ────────────────────────

export type ConnectionState =
  | { status: 'initial' }
  | { status: 'connecting' }
  | { status: 'connected'; connectedAt: number }
  | { status: 'reconnecting'; attempt: number }
  | { status: 'offline'; since: number }
  | { status: 'error'; error: string };

// ── Polling bridge (websocket -> polling) ───────────

/**
 * Callbacks into the polling module.
 * Set via `setPollingBridge` to avoid circular imports.
 *
 * `setState` mirrors Zustand's setState signature for PollingState:
 * accepts a partial update object or an updater function.
 */
export interface PollingBridge {
  setState: (
    partial: Partial<PollingState> | ((state: PollingState) => Partial<PollingState>),
  ) => void;
  getState: () => PollingState;
  stopPollTimer: () => void;
  restartPolling: () => void;
  poll: () => Promise<void> | void;
}

// ── Shared context update helpers ───────────────────

/**
 * Build the store patch for a full context snapshot arriving (from either
 * a WebSocket `context` event or a successful HTTP poll).
 */
export function buildContextReadyPatch(teamId: string, data: TeamContext): Partial<PollingState> {
  return {
    contextData: data,
    contextStatus: 'ready',
    contextTeamId: teamId,
    pollError: null,
    pollErrorData: null,
    lastUpdate: new Date(),
  };
}

/**
 * Build the store patch for an incremental delta applied to existing context.
 * Returns `null` if the delta cannot be applied (wrong team or no existing data).
 *
 * The `applyDelta` parameter accepts `unknown` for both arguments because
 * the shared `applyDelta` function uses a structurally-compatible but
 * nominally different `TeamContext` type (from contracts.ts vs apiSchemas.ts).
 */
export function buildContextDeltaPatch(
  state: PollingState,
  teamId: string,
  applyDelta: (context: unknown, event: unknown) => unknown,
  event: unknown,
): Partial<PollingState> | null {
  if (state.contextTeamId !== teamId || !state.contextData) return null;
  const updated = applyDelta(state.contextData, event) as TeamContext | null | undefined;
  if (!updated) return null;
  return {
    contextData: updated,
    lastUpdate: new Date(),
  };
}
