import type { Env } from '../types.js';
import type { DatabaseDO } from '../dos/database/index.js';
import type { LobbyDO } from '../lobby.js';
import type { TeamDO } from '../dos/team/index.js';

// Phase 3 complete: all DO stubs are fully parameterized.
// Route handlers can call DO methods directly without `as any` casts.
// The `rpc()` helper strips the `& Disposable` wrapper that Cloudflare's
// RPC system adds to every result, restoring clean union narrowing.

/**
 * Strip the `& Disposable` intersection that Cloudflare's Rpc.Result adds
 * to every DO method return value. Without this, TypeScript cannot narrow
 * `DOResult<T>` unions (e.g. checking `.error`) because both branches carry
 * `& Disposable`. This is a zero-cost identity function at runtime.
 *
 * Cloudflare's RPC wraps return types through complex mapped/conditional types
 * (Rpc.Result<T>, Rpc.Stub<T>). Some patterns - notably `ReturnType<typeof fn>`
 * in DO method signatures - resolve to `never` through the RPC type pipeline.
 * The `[T] extends [never]` guard handles those cases. For all other types, T
 * passes through unchanged; the `& Disposable` only adds symbol keys and a
 * `dispose()` method, neither of which interferes with property access or
 * `'error' in result` narrowing.
 *
 * Usage: `const result = rpc(await db.getUser(id));`
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RpcResult<T> = [T] extends [never] ? any : T;
export function rpc<T>(value: T): RpcResult<T> {
  return value as RpcResult<T>;
}

/** Get the singleton DatabaseDO stub. */
export function getDB(env: Env): DurableObjectStub<DatabaseDO> {
  return env.DATABASE.get(env.DATABASE.idFromName('main'));
}

/** Get the singleton LobbyDO stub (presence + global stats). */
export function getLobby(env: Env): DurableObjectStub<LobbyDO> {
  return env.LOBBY.get(env.LOBBY.idFromName('main'));
}

/** Get a TeamDO stub by team ID. */
export function getTeam(env: Env, teamId: string): DurableObjectStub<TeamDO> {
  return env.TEAM.get(env.TEAM.idFromName(teamId));
}
