// WebSocket connection manager for single-team (project) view.
// Isolated from the polling store — communicates via callbacks.
//
// The polling module calls connectTeamWebSocket() when entering project
// view and closeWebSocket() on stop/teardown. This module handles ticket
// acquisition, connection lifecycle, and reconnection is delegated back
// to the caller via onClose.

import { api, getApiUrl } from '../api.js';
import { authActions } from './auth.js';
import { teamActions } from './teams.js';
import { validateResponse, webSocketTicketSchema } from '../apiSchemas.js';

// Internal state — one active connection at a time.
let _activeWs = null;
let _reconcileTimer = null;

/**
 * Close any active WebSocket and its reconciliation timer.
 * Safe to call when no connection exists.
 */
export function closeWebSocket() {
  if (_reconcileTimer) {
    clearInterval(_reconcileTimer);
    _reconcileTimer = null;
  }
  if (_activeWs) {
    try {
      _activeWs.close();
    } catch {
      /* ignore close errors */
    }
    _activeWs = null;
  }
}

/**
 * Attempt a WebSocket connection for a single team.
 *
 * @param {string} teamId - Team to connect to
 * @param {object} callbacks
 * @param {(data: object) => void} callbacks.onContextSnapshot - Full context received
 * @param {(event: object) => void} callbacks.onDeltaEvent - Incremental delta event
 * @param {() => void} callbacks.onConnected - WS opened successfully
 * @param {() => void} callbacks.onClose - WS closed (caller should restart polling)
 * @param {(msg: string) => void} callbacks.onMalformed - Malformed event received
 * @param {() => void} callbacks.onReconcile - Periodic reconciliation tick
 */
export async function connectTeamWebSocket(teamId, callbacks) {
  const { token } = authActions.getState();
  if (!token || !teamId) return;

  // Fetch a short-lived ticket — keeps the real token out of the WS URL
  let ticket;
  try {
    const rawData = await api('POST', '/auth/ws-ticket', null, token);
    const data = validateResponse(webSocketTicketSchema, rawData, 'ws-ticket', {
      throwOnError: true,
    });
    ticket = data.ticket;
  } catch {
    return; // polling continues as fallback
  }

  // Team may have changed while waiting for ticket
  if (teamActions.getState().activeTeamId !== teamId) return;

  const wsBase = getApiUrl().replace(/^http/, 'ws');
  const agentId = `web-dashboard:${token.slice(0, 8)}`;
  const wsUrl = `${wsBase}/teams/${teamId}/ws?agentId=${encodeURIComponent(agentId)}&ticket=${encodeURIComponent(ticket)}`;

  try {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (teamActions.getState().activeTeamId !== teamId) {
        ws.close();
        return;
      }
      callbacks.onConnected();
      // Start periodic reconciliation (full poll to catch missed deltas)
      if (_reconcileTimer) clearInterval(_reconcileTimer);
      _reconcileTimer = setInterval(callbacks.onReconcile, 60_000);
    };

    ws.onmessage = (evt) => {
      if (teamActions.getState().activeTeamId !== teamId) return;
      try {
        const event = JSON.parse(evt.data);
        if (event.type === 'context') {
          callbacks.onContextSnapshot(event.data);
        } else {
          callbacks.onDeltaEvent(event);
        }
      } catch (e) {
        callbacks.onMalformed(e.message);
      }
    };

    ws.onclose = () => {
      _activeWs = null;
      if (_reconcileTimer) {
        clearInterval(_reconcileTimer);
        _reconcileTimer = null;
      }
      // Caller decides whether to restart polling
      if (teamActions.getState().activeTeamId === teamId) {
        callbacks.onClose();
      }
    };

    ws.onerror = () => {
      /* onclose fires after */
    };

    _activeWs = ws;
  } catch {
    // WebSocket constructor failed — stay on polling
  }
}

/** Expose for testing. */
export function _getInternalState() {
  return { activeWs: _activeWs, reconcileTimer: _reconcileTimer };
}
