// Dependency bag passed into every per-domain *-rpc module.
//
// TeamDO owns the live class state (sql handle, schema-ready flag, context
// cache, heartbeat debounce, cleanup clock) plus the wrapper helpers that
// every RPC flows through (#withMember, #op, #withOwner). The RPC bodies
// themselves are pure functions of those dependencies, so they live in
// sibling *-rpc.ts modules and receive an RpcCtx built fresh per call.
//
// Building the bag is cheap (object literal, function references already
// bound) and rebuilding per call keeps closures tied to live class state
// without forcing the modules to know about the DurableObject shape.
//
// The interface intentionally surfaces only what's needed by RPC bodies;
// instance-scoped concerns the class manages itself (like #boundRecordMetric
// or the bound hibernation entry points) stay private to TeamDO.

import type { Env, DOError, TeamContext } from '../../types.js';
import type { ContextCache } from './context-cache.js';

export interface RpcCtx {
  sql: SqlStorage;
  env: Env;
  transact: <T>(fn: () => T) => T;
  ensureSchema: () => void;
  recordMetric: (metric: string) => void;
  boundRecordMetric: (metric: string) => void;
  withMember: <T>(
    agentId: string,
    ownerId: string | null,
    fn: (resolved: string) => T,
  ) => T | DOError;
  withOwner: <T>(ownerId: string, fn: () => T) => T | DOError;
  op: <R>(
    agentId: string,
    ownerId: string | null,
    run: (resolved: string) => R,
    side?: {
      broadcast?: (result: Exclude<R, DOError>, resolved: string) => Record<string, unknown> | null;
      broadcastOpts?: { invalidateCache?: boolean };
      metric?: (result: Exclude<R, DOError>) => string | null;
    },
  ) => R | DOError;
  broadcastToWatchers: (
    event: Record<string, unknown>,
    opts?: { invalidateCache?: boolean },
  ) => void;
  broadcastToExecutors: (event: Record<string, unknown>) => void;
  hasExecutorConnected: () => boolean;
  getAvailableSpawnTools: () => string[];
  getConnectedAgentIds: () => Set<string>;
  contextCache: ContextCache<TeamContext & { ok: true }>;
  lastHeartbeatBroadcast: Map<string, number>;
  maybeCleanup: () => void;
}
