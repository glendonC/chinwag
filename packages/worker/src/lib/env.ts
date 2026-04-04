import type { Env } from '../types.js';

// During incremental migration, DO classes are still .js.
// Stubs are typed as DurableObjectStub (unparameterized) for now.
// Phase 2 will add generic DurableObjectStub<T> once DOs are converted.

/** Get the singleton DatabaseDO stub. */
export function getDB(env: Env): DurableObjectStub {
  return env.DATABASE.get(env.DATABASE.idFromName('main'));
}

/** Get the singleton LobbyDO stub. */
export function getLobby(env: Env): DurableObjectStub {
  return env.LOBBY.get(env.LOBBY.idFromName('main'));
}

/** Get a TeamDO stub by team ID. */
export function getTeam(env: Env, teamId: string): DurableObjectStub {
  return env.TEAM.get(env.TEAM.idFromName(teamId));
}
