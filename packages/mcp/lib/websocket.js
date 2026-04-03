// WebSocket connection management for the MCP server.
// Handles connect, reconnect with exponential backoff, heartbeat pings.
// CRITICAL: Never console.log — stdio transport. Use console.error.

import { createLogger } from '../dist/utils/logger.js';

const log = createLogger('ws');

/** @type {number} Ping interval to keep DB heartbeat fresh */
export const WS_PING_MS = 60_000;
/** @type {number} Initial delay before first reconnect attempt */
export const INITIAL_RECONNECT_DELAY_MS = 1_000;
/** @type {number} Maximum reconnect backoff cap */
export const MAX_RECONNECT_DELAY_MS = 60_000;

/**
 * Creates a WebSocket manager for team presence.
 *
 * The connection IS the heartbeat — pings every 60s keep the DB timestamp
 * fresh for SQL queries. Reconnects with exponential backoff on disconnect.
 *
 * @param {object} options
 * @param {object} options.client - API client (needs .post() for ws-ticket)
 * @param {() => string} options.getApiUrl - Returns the API base URL
 * @param {string} options.teamId - Team ID to connect to
 * @param {string} options.agentId - Agent ID for the connection
 * @param {object} options.state - Shared mutable state (reads/writes .ws, .lastActivity, .shuttingDown)
 * @returns {{ connect: () => void, disconnect: () => void }}
 */
export function createWebSocketManager({ client, getApiUrl, teamId, agentId, state }) {
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  let reconnectTimer = null;
  let pingTimer = null;
  let lastWsSend = 0;
  let connecting = false;

  function scheduleReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (state.shuttingDown) return;
    log.info(`WebSocket disconnected, reconnecting in ${reconnectDelay / 1000}s`, {
      reconnectDelay,
    });
    reconnectTimer = setTimeout(connectWs, reconnectDelay);
    if (reconnectTimer.unref) reconnectTimer.unref();
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }

  function connectWs() {
    if (connecting || state.shuttingDown) return;
    connecting = true;
    reconnectTimer = null;

    client
      .post('/auth/ws-ticket')
      .then(({ ticket }) => {
        if (state.shuttingDown) {
          connecting = false;
          return;
        }

        const wsBase = getApiUrl().replace(/^http/, 'ws');
        const wsUrl = `${wsBase}/teams/${teamId}/ws?agentId=${encodeURIComponent(agentId)}&ticket=${encodeURIComponent(ticket)}&role=agent`;

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          connecting = false;
          state.ws = ws;
          reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
          log.info('WebSocket connected (presence active)');

          pingTimer = setInterval(() => {
            if (Date.now() - lastWsSend > WS_PING_MS - 5000) {
              try {
                ws.send(JSON.stringify({ type: 'ping', lastToolUseAt: state.lastActivity }));
                lastWsSend = Date.now();
              } catch (err) {
                log.debug(err?.message || 'ws ping failed');
              }
            }
          }, WS_PING_MS);
          if (pingTimer.unref) pingTimer.unref();
        };

        ws.onmessage = () => {}; // agent doesn't need broadcasts

        ws.onclose = () => {
          connecting = false;
          state.ws = null;
          if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
          }
          scheduleReconnect();
        };

        ws.onerror = (err) => {
          log.error('WebSocket error: ' + (err?.message || 'unknown'));
        };
      })
      .catch((err) => {
        connecting = false;
        log.error(err?.message || 'ws ticket fetch failed');
        scheduleReconnect();
      });
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    connecting = false;
    if (state.ws) {
      try {
        state.ws.close();
      } catch (err) {
        log.error('Failed to close WebSocket: ' + err.message);
      }
      state.ws = null;
    }
  }

  return { connect: connectWs, disconnect };
}
