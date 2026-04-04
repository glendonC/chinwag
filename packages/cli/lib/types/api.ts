/**
 * CLI-specific API response types.
 *
 * Types that already exist in @chinwag/shared/contracts.js are imported there.
 * This file covers responses used only by the CLI that aren't in the shared contracts.
 */

/** POST /auth/init */
export interface InitAccountResponse {
  token: string;
  handle: string;
  color: string;
}

/** POST /teams */
export interface CreateTeamResponse {
  team_id: string;
}

/** PUT /me/handle */
export interface HandleUpdateResponse {
  error?: string;
}
