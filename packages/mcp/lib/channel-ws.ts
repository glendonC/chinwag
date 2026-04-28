// Channel WebSocket manager - connects as a watcher to TeamDO.
// Receives delta events, maintains a local TeamContext via applyDelta,
// and notifies the channel server of state changes for diffing.
//
// This is separate from lib/websocket.js (agent role, ignores messages).
// The channel needs watcher role, processes every incoming message,
// and maintains materialized state for conflict/stuckness detection.
//
// CRITICAL: Never console.log - stdio transport.

import { applyDelta, normalizeDashboardDeltaEvent } from '@chinmeister/shared/dashboard-ws.js';
import type { TeamContext } from '@chinmeister/shared/contracts/dashboard.js';
import type { ApiClient } from './team.js';
import { getErrorMessage } from './utils/responses.js';
import { INITIAL_RECONNECT_DELAY_MS, nextReconnectDelay } from './constants.js';

interface Logger {
  info: (msg: string) => void;
  error: (msg: string) => void;
  warn: (msg: string) => void;
}

interface ChannelWebSocketOptions {
  client: ApiClient;
  getApiUrl: () => string;
  teamId: string;
  agentId: string;
  onContextUpdate: (prev: TeamContext | null, curr: TeamContext) => void;
  logger: Logger;
}

export interface ChannelWebSocket {
  connect: () => void;
  disconnect: () => void;
  getContext: () => TeamContext | null;
  setContext: (ctx: TeamContext | null) => void;
  isConnected: () => boolean;
}

export function createChannelWebSocket({
  client,
  getApiUrl,
  teamId,
  agentId,
  onContextUpdate,
  logger,
}: ChannelWebSocketOptions): ChannelWebSocket {
  let localContext: TeamContext | null = null;
  let ws: WebSocket | null = null;
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let connecting = false;

  function connect(): void {
    if (destroyed || connecting) return;
    connecting = true;
    reconnectTimer = null;

    client
      .post('/auth/ws-ticket')
      .then((res: unknown) => {
        const { ticket } = res as { ticket: string };
        if (destroyed) {
          connecting = false;
          return;
        }

        const wsBase = getApiUrl().replace(/^http/, 'ws');
        const url = `${wsBase}/teams/${teamId}/ws?agentId=${encodeURIComponent(agentId)}&ticket=${encodeURIComponent(ticket)}&role=watcher`;

        const socket = new WebSocket(url);

        socket.onopen = () => {
          connecting = false;
          ws = socket;
          reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
          logger.info('WebSocket connected (watcher)');
        };

        socket.onmessage = (event: MessageEvent) => {
          try {
            const raw = typeof event.data === 'string' ? event.data : String(event.data);
            const data = JSON.parse(raw) as Record<string, unknown>;

            // Initial full context frame sent by TeamDO on connect
            if (data.type === 'context' && data.data) {
              const prev = localContext;
              localContext = data.data as TeamContext;
              onContextUpdate(prev, localContext);
              return;
            }

            // Delta events - apply to local state and notify
            const normalized = normalizeDashboardDeltaEvent(data);
            if (!normalized || !localContext) return;

            const prev = localContext;
            localContext = (applyDelta(localContext, normalized) as TeamContext) || localContext;
            onContextUpdate(prev, localContext);
          } catch (err: unknown) {
            logger.error('WebSocket message parse error: ' + getErrorMessage(err));
          }
        };

        socket.onclose = () => {
          connecting = false;
          ws = null;
          scheduleReconnect();
        };

        socket.onerror = (event: Event) => {
          logger.error(
            'WebSocket error: ' +
              ((event as { message?: string })?.message || event?.type || 'unknown'),
          );
        };
      })
      .catch((err: unknown) => {
        connecting = false;
        logger.error('WebSocket ticket fetch failed: ' + getErrorMessage(err));
        scheduleReconnect();
      });
  }

  function scheduleReconnect(): void {
    if (destroyed || reconnectTimer) return;
    const { jitteredDelay, nextDelay } = nextReconnectDelay(reconnectDelay);
    logger.info(`WebSocket reconnecting in ${(jitteredDelay / 1000).toFixed(1)}s`);
    reconnectTimer = setTimeout(connect, jitteredDelay);
    if (reconnectTimer.unref) reconnectTimer.unref();
    reconnectDelay = nextDelay;
  }

  function disconnect(): void {
    destroyed = true;
    connecting = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        // closing during shutdown - safe to ignore
      }
      ws = null;
    }
  }

  function getContext(): TeamContext | null {
    return localContext;
  }

  function setContext(ctx: TeamContext | null): void {
    localContext = ctx;
  }

  function isConnected(): boolean {
    return ws !== null && ws.readyState === WebSocket.OPEN;
  }

  return { connect, disconnect, getContext, setContext, isConnected };
}
