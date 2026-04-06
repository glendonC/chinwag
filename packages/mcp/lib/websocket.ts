// WebSocket connection management for the MCP server.
// Handles connect, reconnect with exponential backoff, heartbeat pings.
// CRITICAL: Never console.log — stdio transport. Use console.error.

import { createLogger } from './utils/logger.js';
import { getErrorMessage } from './utils/responses.js';
import {
  WS_PING_MS,
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  nextReconnectDelay,
} from './constants.js';
import type { ApiClient } from './team.js';

// Re-export for backwards compatibility
export { WS_PING_MS, INITIAL_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } from './constants.js';

const log = createLogger('ws');

/** Shared mutable state that the WebSocket manager reads and writes. */
interface WsManagerState {
  ws: WebSocket | null;
  lastActivity: number;
  shuttingDown: boolean;
}

/** Options for creating a WebSocket manager. */
interface WsManagerOptions {
  /** API client (needs .post() for ws-ticket) */
  client: ApiClient;
  /** Returns the API base URL */
  getApiUrl: () => string;
  /** Team ID to connect to */
  teamId: string;
  /** Agent ID for the connection */
  agentId: string;
  /** Shared mutable state (reads/writes .ws, .lastActivity, .shuttingDown) */
  state: WsManagerState;
  /** Tool IDs this MCP server can spawn — advertised via WebSocket tags. */
  spawnTools?: string[];
  /** Called for every incoming WebSocket message (command dispatch, claim results). */
  onMessage?: (data: Record<string, unknown>, ws: WebSocket) => void;
}

/** Return type of createWebSocketManager. */
export interface WsManager {
  connect: () => void;
  disconnect: () => void;
  /** Update the agent ID used for WebSocket connections. Triggers a reconnect. */
  updateAgentId: (newAgentId: string) => void;
}

/**
 * Creates a WebSocket manager for team presence.
 *
 * The connection IS the heartbeat — pings every 60s keep the DB timestamp
 * fresh for SQL queries. Reconnects with exponential backoff on disconnect.
 */
export function createWebSocketManager({
  client,
  getApiUrl,
  teamId,
  agentId: initialAgentId,
  state,
  spawnTools,
  onMessage,
}: WsManagerOptions): WsManager {
  let agentId = initialAgentId;
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let lastWsSend = 0;
  let connecting = false;

  function scheduleReconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (state.shuttingDown) return;
    const { jitteredDelay, nextDelay } = nextReconnectDelay(reconnectDelay);
    log.info(`WebSocket disconnected, reconnecting in ${(jitteredDelay / 1000).toFixed(1)}s`, {
      reconnectDelay,
    });
    reconnectTimer = setTimeout(connectWs, jitteredDelay);
    if (reconnectTimer.unref) reconnectTimer.unref();
    reconnectDelay = nextDelay;
  }

  function connectWs(): void {
    if (connecting || state.shuttingDown) return;
    connecting = true;
    reconnectTimer = null;

    client
      .post('/auth/ws-ticket')
      .then((res: unknown) => {
        const { ticket } = res as { ticket: string };
        if (state.shuttingDown) {
          connecting = false;
          return;
        }

        const wsBase = getApiUrl().replace(/^http/, 'ws');
        const toolsParam = spawnTools?.length
          ? `&tools=${encodeURIComponent(spawnTools.join(','))}`
          : '';
        const wsUrl = `${wsBase}/teams/${teamId}/ws?agentId=${encodeURIComponent(agentId)}&ticket=${encodeURIComponent(ticket)}&role=agent${toolsParam}`;

        const ws = new WebSocket(wsUrl);

        ws.onopen = (): void => {
          connecting = false;
          state.ws = ws;
          reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
          log.info('WebSocket connected (presence active)');

          pingTimer = setInterval(() => {
            if (Date.now() - lastWsSend > WS_PING_MS - 5000) {
              try {
                ws.send(JSON.stringify({ type: 'ping', lastToolUseAt: state.lastActivity }));
                lastWsSend = Date.now();
              } catch (err: unknown) {
                log.debug(getErrorMessage(err));
              }
            }
          }, WS_PING_MS);
          if (pingTimer.unref) pingTimer.unref();
        };

        ws.onmessage = (event: MessageEvent): void => {
          if (!onMessage) return;
          try {
            const data = JSON.parse(
              typeof event.data === 'string' ? event.data : String(event.data),
            ) as Record<string, unknown>;
            onMessage(data, ws);
          } catch {
            // malformed message — ignore
          }
        };

        ws.onclose = (_event: CloseEvent): void => {
          connecting = false;
          state.ws = null;
          if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
          }
          scheduleReconnect();
        };

        ws.onerror = (event: Event): void => {
          log.error('WebSocket error: ' + getErrorMessage(event));
        };
      })
      .catch((err: unknown) => {
        connecting = false;
        log.error(getErrorMessage(err));
        scheduleReconnect();
      });
  }

  function disconnect(): void {
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
      } catch (err: unknown) {
        log.error('Failed to close WebSocket: ' + getErrorMessage(err));
      }
      state.ws = null;
    }
  }

  function updateAgentId(newAgentId: string): void {
    agentId = newAgentId;
    // Force reconnect with new identity
    disconnect();
    connectWs();
  }

  return { connect: connectWs, disconnect, updateAgentId };
}
