// WebSocket broadcast helpers extracted from TeamDO.
//
// broadcastToWatchers fans out to every connected socket (agents and
// watchers). broadcastToExecutors targets daemon sockets with spawn
// capability. Callers that own a context cache pass invalidateCache to
// invalidate it before the fan-out — kept as an injected callback so the
// helpers have no coupling to any particular cache implementation.

import { createLogger } from '../../lib/logger.js';
import { getExecutorSockets } from './presence.js';

const log = createLogger('TeamDO');

export interface BroadcastOptions {
  /** Invoked before sending when provided; used to bust context caches. */
  invalidateCache?: (() => void) | undefined;
}

export function broadcastToWatchers(
  ctx: DurableObjectState,
  event: Record<string, unknown>,
  options: BroadcastOptions = {},
): void {
  options.invalidateCache?.();
  const sockets = ctx.getWebSockets();
  if (!sockets.length) return;
  const data = JSON.stringify(event);
  let failures = 0;
  for (const ws of sockets) {
    try {
      ws.send(data);
    } catch {
      failures++;
    }
  }
  if (failures > 0) {
    log.warn('broadcast partial failure', { totalClients: sockets.length, failures });
  }
}

export function broadcastToExecutors(
  ctx: DurableObjectState,
  event: Record<string, unknown>,
): void {
  const sockets = getExecutorSockets(ctx);
  if (!sockets.length) return;
  const data = JSON.stringify(event);
  for (const ws of sockets) {
    try {
      ws.send(data);
    } catch {
      /* client may have disconnected */
    }
  }
}
