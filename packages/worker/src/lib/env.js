export function getDB(env) {
  return env.DATABASE.get(env.DATABASE.idFromName('main'));
}

export function getLobby(env) {
  return env.LOBBY.get(env.LOBBY.idFromName('main'));
}

export function getTeam(env, teamId) {
  return env.TEAM.get(env.TEAM.idFromName(teamId));
}
