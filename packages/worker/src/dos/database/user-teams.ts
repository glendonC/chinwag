// Cross-project team membership -- each row is a (user, team) pair.
// Separate from TeamDO's in-team membership table; this join table lets the
// web dashboard list all teams a user belongs to without fanning out to
// every TeamDO.
//
// Each function takes `sql` as the first parameter.

import type { UserTeam } from '../../types.js';

export function addUserTeam(
  sql: SqlStorage,
  userId: string,
  teamId: string,
  name: string | null = null,
): { ok: true } {
  sql.exec(
    `INSERT INTO user_teams (user_id, team_id, team_name) VALUES (?, ?, ?)
     ON CONFLICT(user_id, team_id) DO UPDATE SET
       team_name = COALESCE(excluded.team_name, user_teams.team_name)`,
    userId,
    teamId,
    name,
  );
  return { ok: true };
}

export function getUserTeams(sql: SqlStorage, userId: string): { ok: true; teams: UserTeam[] } {
  const teams = sql
    .exec(
      'SELECT team_id, team_name, joined_at FROM user_teams WHERE user_id = ? ORDER BY joined_at DESC LIMIT 50',
      userId,
    )
    .toArray() as unknown as UserTeam[];
  return { ok: true, teams };
}

export function removeUserTeam(sql: SqlStorage, userId: string, teamId: string): { ok: true } {
  sql.exec('DELETE FROM user_teams WHERE user_id = ? AND team_id = ?', userId, teamId);
  return { ok: true };
}
