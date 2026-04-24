// RPC wrapper primitives extracted from the TeamDO class body.
//
// Cloudflare Durable Object RPC is a structural contract: the public
// `async methodName(...)` surface of the class IS what callers stub
// against. That surface has to stay. The RPC method *bodies*, however,
// mostly follow one of three shapes: authenticate-then-run (`withMember`,
// `withOwner`), or authenticate-run-broadcast-meter (`op`). Extracting
// those three shapes into free functions pulls ~80 LoC of repeated
// plumbing out of the class and makes every RPC body expressible as a
// one-line delegator in the final facade.
//
// Mirrors the `WsCtx` pattern in websocket.ts: rebuilt per call, cheap
// literal, closes over live class state via arrow bindings.

import type { DOError } from '../../types.js';
import { isDOError } from '../../lib/errors.js';

type Transact = <T>(fn: () => T) => T;

/** Dependency bag every RPC wrapper needs. */
export interface RpcCtx {
  sql: SqlStorage;
  ensureSchema: () => void;
  transact: Transact;
  resolveOwnedAgentId: (agentId: string, ownerId: string | null) => string | null;
  broadcastToWatchers: (
    event: Record<string, unknown>,
    opts?: { invalidateCache?: boolean },
  ) => void;
  broadcastToExecutors: (event: Record<string, unknown>) => void;
  recordMetric: (metric: string) => void;
  /** Agent IDs with an active 'role:agent' WebSocket connection. */
  getConnectedAgentIds: () => Set<string>;
  hasExecutorConnected: () => boolean;
  /** Last-broadcast timestamps per agent, owned by TeamDO. Cleared on
   *  leave / close. Passed by reference so mutations land in the class's
   *  live Map. */
  lastHeartbeatBroadcast: Map<string, number>;
}

/**
 * Ensure schema, resolve agent, run callback. Eliminates the repeated
 * NOT_MEMBER check across 18+ RPC methods.
 */
export function withMember<T>(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string | null,
  fn: (resolved: string) => T,
): T | DOError {
  ctx.ensureSchema();
  const resolved = ctx.resolveOwnedAgentId(agentId, ownerId);
  if (!resolved) return { error: 'Not a member of this team', code: 'NOT_MEMBER' };
  return fn(resolved);
}

/**
 * Member-scoped RPC wrapper that layers optional side effects on top of
 * `withMember`. Pattern used by ~18 RPC methods:
 *
 *   1. ensureSchema + NOT_MEMBER check (via withMember)
 *   2. Run `run(resolvedAgentId)` to produce a domain result.
 *   3. If the result is NOT a DOError, fire the optional `broadcast` hook
 *      (delta event to connected watchers) and/or the `metric` hook (bump a
 *      telemetry counter). Error returns skip both by design — we never
 *      broadcast a state change that didn't happen.
 *
 * Generic note: `isDOError(result)` narrows at runtime, but TS can't
 * propagate the negation through generic `R`, so we cast once to
 * `Exclude<R, DOError>` after the guard. The cast is safe because the
 * guard just ran; it stays local to this helper so call sites keep a
 * clean `R | DOError` signature.
 */
export function op<R>(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string | null,
  run: (resolved: string) => R,
  side: {
    broadcast?: (result: Exclude<R, DOError>, resolved: string) => Record<string, unknown> | null;
    broadcastOpts?: { invalidateCache?: boolean };
    metric?: (result: Exclude<R, DOError>) => string | null;
  } = {},
): R | DOError {
  return withMember(ctx, agentId, ownerId, (resolved) => {
    const result = run(resolved);
    if (isDOError(result)) return result;
    const success = result as Exclude<R, DOError>;
    const event = side.broadcast?.(success, resolved);
    if (event) ctx.broadcastToWatchers(event, side.broadcastOpts);
    const metric = side.metric?.(success);
    if (metric) ctx.recordMetric(metric);
    return result;
  });
}

/**
 * Owner-scoped RPC wrapper for endpoints that do not resolve a specific
 * agent (dashboard/summary calls). Confirms the caller owns at least one
 * member in this team before running the callback.
 */
export function withOwner<T>(ctx: RpcCtx, ownerId: string, fn: () => T): T | DOError {
  ctx.ensureSchema();
  const row = ctx.sql.exec('SELECT 1 FROM members WHERE owner_id = ? LIMIT 1', ownerId).toArray();
  if (row.length === 0) return { error: 'Not a member of this team', code: 'NOT_MEMBER' };
  return fn();
}
