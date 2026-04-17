// WebSocket lifecycle handlers extracted from TeamDO.
//
// Cloudflare's Hibernation API dispatches fetch / webSocketMessage /
// webSocketClose / webSocketError to named methods on the DO class, so the
// class has to keep those methods. The bodies, however, are pure dispatch
// logic that can live here and take an explicit dependency bag. That makes
// them unit-testable without standing up a DurableObjectState, and keeps
// the DO shell small enough to read in one pass.

import { getErrorMessage, isDOError } from '../../lib/errors.js';
import { createLogger } from '../../lib/logger.js';
import { toSQLDateTime } from '../../lib/text-utils.js';
import { updateActivity as updateActivityFn, reportFile as reportFileFn } from './activity.js';
import { releaseFiles as releaseFilesFn } from './locks.js';
import {
  claimCommand as claimCommandFn,
  completeCommand as completeCommandFn,
  getPendingCommands as getPendingCommandsFn,
} from './commands.js';
import { getExecutorSockets, getAvailableSpawnTools } from './presence.js';
import type { DOError } from '../../types.js';

const log = createLogger('TeamDO');

type Transact = <T>(fn: () => T) => T;

/** Dependency bag passed into every handler. */
export interface WsCtx {
  sql: SqlStorage;
  ctx: DurableObjectState;
  ensureSchema: () => void;
  transact: Transact;
  resolveOwnedAgentId: (agentId: string, ownerId: string | null) => string | null;
  broadcastToWatchers: (
    event: Record<string, unknown>,
    opts?: { invalidateCache?: boolean },
  ) => void;
  /** Delegates to TeamDO.getContext so the initial frame reuses the same cache. */
  getContext: (agentId: string) => Promise<Record<string, unknown> | DOError>;
  /** Last-broadcast timestamps per agent, owned by TeamDO. Cleared on close. */
  lastHeartbeatBroadcast: Map<string, number>;
}

// -- fetch: WebSocket upgrade ------------------------------------------------

export async function handleFetch(wsCtx: WsCtx, request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/ws') {
    return new Response('Not found', { status: 404 });
  }

  if (request.headers.get('X-Chinwag-Verified') !== '1') {
    return new Response('Forbidden', { status: 403 });
  }

  const agentId = url.searchParams.get('agentId');
  const ownerId = url.searchParams.get('ownerId');
  if (!agentId || !ownerId) {
    return new Response('Missing agentId or ownerId', { status: 400 });
  }

  wsCtx.ensureSchema();

  const resolved = wsCtx.resolveOwnedAgentId(agentId, ownerId);
  if (!resolved) {
    return new Response('Not a member of this team', { status: 403 });
  }

  const roleParam = url.searchParams.get('role');
  const role = roleParam === 'agent' ? 'agent' : roleParam === 'daemon' ? 'daemon' : 'watcher';
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];

  // Agents and daemons can report available spawn tools via query string — stored as
  // WebSocket tags so they survive DO hibernation and can be queried for context responses.
  const tags = [resolved, `role:${role}`];
  if (role === 'agent' || role === 'daemon') {
    const toolsParam = url.searchParams.get('tools');
    if (toolsParam) {
      for (const t of toolsParam.split(',')) {
        const trimmed = t.trim();
        if (trimmed) tags.push(`spawn:${trimmed}`);
      }
    }
  }

  wsCtx.ctx.acceptWebSocket(server, tags);

  // Agents and daemons: bump heartbeat on connect (WS keeps them alive going forward)
  if (role === 'agent' || role === 'daemon') {
    wsCtx.sql.exec(
      "UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?",
      resolved,
    );
    wsCtx.broadcastToWatchers({ type: 'status_change', agent_id: resolved, status: 'active' });
  }

  const hasSpawnCapability = tags.some((t) => t.startsWith('spawn:'));
  if (hasSpawnCapability) {
    wsCtx.broadcastToWatchers({
      type: 'daemon_status',
      connected: true,
      available_tools: getAvailableSpawnTools(wsCtx.ctx),
    });
  }

  // Send initial full context -- on failure, send error frame so client knows
  try {
    const ctx = await wsCtx.getContext(resolved);
    server.send(JSON.stringify({ type: 'context', data: ctx }));
  } catch (err) {
    log.error('failed to send initial context', { error: getErrorMessage(err) });
    try {
      server.send(JSON.stringify({ type: 'error', message: 'Failed to load initial context' }));
    } catch {
      // Client may have already disconnected
    }
  }

  // Executors (any socket with spawn capability): deliver pending commands
  if (hasSpawnCapability) {
    try {
      const pending = getPendingCommandsFn(wsCtx.sql);
      for (const cmd of pending.commands) {
        const c = cmd as Record<string, unknown>;
        if (c.status === 'pending') {
          server.send(
            JSON.stringify({
              type: 'command',
              id: c.id,
              command_type: c.type,
              payload: JSON.parse((c.payload as string) || '{}'),
            }),
          );
        }
      }
    } catch (err) {
      log.error('failed to send pending commands to daemon', { error: getErrorMessage(err) });
    }
  }

  return new Response(null, { status: 101, webSocket: client });
}

// -- webSocketMessage: inbound frame dispatch --------------------------------

export async function handleMessage(
  wsCtx: WsCtx,
  ws: WebSocket,
  rawMessage: string | ArrayBuffer,
): Promise<void> {
  // Guard: if the WS has no tags, it was never properly accepted -- ignore
  let tags: string[];
  try {
    tags = wsCtx.ctx.getTags(ws);
  } catch (err) {
    log.error('webSocketMessage: failed to read tags', { error: getErrorMessage(err) });
    return;
  }
  const agentId = tags.find((t) => !t.startsWith('role:'));
  if (!agentId) {
    // Unauthenticated or untagged WebSocket -- log and ignore
    log.warn('untagged WebSocket message', {
      event: 'ws_unauth_message',
      messagePreview: String(rawMessage).slice(0, 200),
    });
    return;
  }

  const isAgent = tags.includes('role:agent');

  try {
    const data = JSON.parse(rawMessage as string) as Record<string, unknown>;

    if (data.type === 'ping') {
      wsCtx.ensureSchema();
      if (data.lastToolUseAt) {
        const parsed = new Date(data.lastToolUseAt as string);
        if (!isNaN(parsed.getTime())) {
          const ts = toSQLDateTime(parsed);
          wsCtx.sql.exec(
            "UPDATE members SET last_heartbeat = datetime('now'), last_tool_use = ? WHERE agent_id = ?",
            ts,
            agentId,
          );
        } else {
          wsCtx.sql.exec(
            "UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?",
            agentId,
          );
        }
      } else {
        wsCtx.sql.exec(
          "UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?",
          agentId,
        );
      }
      ws.send(JSON.stringify({ type: 'pong' }));
    } else if (data.type === 'activity' && isAgent) {
      wsCtx.ensureSchema();
      const result = updateActivityFn(
        wsCtx.sql,
        agentId,
        (data.files as string[]) || [],
        (data.summary as string) || '',
        wsCtx.transact,
      );
      if (!isDOError(result)) {
        wsCtx.broadcastToWatchers({
          type: 'activity',
          agent_id: agentId,
          files: data.files,
          summary: data.summary,
        });
      }
    } else if (data.type === 'file' && isAgent) {
      wsCtx.ensureSchema();
      const result = reportFileFn(wsCtx.sql, agentId, data.file as string, wsCtx.transact);
      if (!isDOError(result)) {
        wsCtx.broadcastToWatchers({ type: 'file', agent_id: agentId, file: data.file });
      }
    } else if (data.type === 'claim_command' && tags.some((t) => t.startsWith('spawn:'))) {
      wsCtx.ensureSchema();
      const commandId = typeof data.id === 'string' ? data.id : '';
      if (commandId) {
        const result = claimCommandFn(wsCtx.sql, commandId, agentId);
        ws.send(JSON.stringify({ type: 'claim_result', id: commandId, ...result }));
        if (!isDOError(result)) {
          wsCtx.broadcastToWatchers({
            type: 'command_status',
            id: commandId,
            status: 'claimed',
            claimed_by: agentId,
          });
        }
      }
    } else if (data.type === 'command_result' && tags.some((t) => t.startsWith('spawn:'))) {
      wsCtx.ensureSchema();
      const commandId = typeof data.id === 'string' ? data.id : '';
      const cmdStatus = data.status === 'completed' ? 'completed' : 'failed';
      const resultData =
        typeof data.result === 'object' && data.result
          ? (data.result as Record<string, unknown>)
          : {};
      if (commandId) {
        const result = completeCommandFn(wsCtx.sql, commandId, agentId, cmdStatus, resultData);
        if (!isDOError(result)) {
          wsCtx.broadcastToWatchers({
            type: 'command_status',
            id: commandId,
            status: cmdStatus,
            result: resultData,
          });
        }
      }
    }
  } catch (err) {
    log.error('WebSocket message processing failed', {
      event: 'ws_message_error',
      agentId,
      messagePreview: String(rawMessage).slice(0, 200),
      error: getErrorMessage(err),
    });
    try {
      ws.send(JSON.stringify({ type: 'error', message: 'Message processing failed' }));
    } catch {
      // Client may have disconnected
    }
  }
}

// -- webSocketClose: cleanup on disconnect -----------------------------------

export async function handleClose(wsCtx: WsCtx, ws: WebSocket): Promise<void> {
  let tags: string[];
  try {
    tags = wsCtx.ctx.getTags(ws);
  } catch (err) {
    log.error('webSocketClose: failed to read tags on closing socket', {
      error: getErrorMessage(err),
    });
    // Tags lost -- cannot identify agent. This is rare (DO restart mid-close).
    // Stale locks/members will be cleaned up by the periodic cleanup pass.
    return;
  }
  const isAgent = tags.includes('role:agent');
  const closingHasSpawn = tags.some((t) => t.startsWith('spawn:'));
  const agentId = tags.find((t) => !t.startsWith('role:') && !t.startsWith('spawn:'));

  // Spawn capability disconnect: recompute available tools for watchers
  if (closingHasSpawn && agentId) {
    const remaining = getExecutorSockets(wsCtx.ctx).filter((s) => s !== ws);
    wsCtx.broadcastToWatchers({
      type: 'daemon_status',
      connected: remaining.length > 0,
      available_tools: getAvailableSpawnTools(wsCtx.ctx),
    });
  }

  if (isAgent && agentId) {
    wsCtx.ensureSchema();
    wsCtx.lastHeartbeatBroadcast.delete(agentId);
    // Release locks -- agent is gone, don't block others
    let locksReleased = true;
    try {
      releaseFilesFn(wsCtx.sql, agentId, null);
    } catch (err) {
      locksReleased = false;
      log.error('webSocketClose: lock release failed', {
        agentId,
        error: getErrorMessage(err),
      });
    }
    // Always broadcast status_change (agent is offline regardless)
    wsCtx.broadcastToWatchers({ type: 'status_change', agent_id: agentId, status: 'offline' });
    // Only broadcast lock release if it actually happened
    if (locksReleased) {
      wsCtx.broadcastToWatchers({
        type: 'lock_change',
        action: 'release_all',
        agent_id: agentId,
      });
    }
  }
}

// -- webSocketError: observability only --------------------------------------

export async function handleError(wsCtx: WsCtx, ws: WebSocket): Promise<void> {
  // Log the error for observability; handleClose fires after for actual cleanup
  let agentId = 'unknown';
  try {
    const tags = wsCtx.ctx.getTags(ws);
    agentId = tags.find((t) => !t.startsWith('role:')) || 'unknown';
  } catch (err) {
    log.error('webSocketError: failed to read tags', { error: getErrorMessage(err) });
  }
  log.warn('WebSocket error', { event: 'ws_error', agentId });
}
