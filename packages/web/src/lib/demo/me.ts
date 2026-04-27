// Auth profile + team list demo data. The auth store and the team store
// short-circuit their /me and /me/teams fetches when demo is active and
// pull from these factories instead, so the sidebar, profile pill, and
// settings view stay coherent with the rest of the demo overlay.

import type { UserProfile, UserTeams } from '../apiSchemas.js';
import { DEMO_TEAMS } from './baseline.js';

// "Joined ~3 months ago" reads naturally for an active developer regardless
// of when the demo is shown. A fixed literal would drift into "joined years
// ago" territory once we shipped this demo to production for any length of
// time.
const ACCOUNT_AGE_DAYS = 102;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function createBaselineMe(): UserProfile {
  return {
    handle: 'glendon',
    color: 'cyan',
    created_at: daysAgoIso(ACCOUNT_AGE_DAYS),
    budgets: null,
    github_id: 'demo-gh-1',
    github_login: 'glendon-demo',
    avatar_url: null,
  };
}

export function createBaselineTeams(): UserTeams {
  return {
    teams: DEMO_TEAMS.map((t) => ({
      team_id: t.team_id,
      team_name: t.team_name,
      joined_at: daysAgoIso(ACCOUNT_AGE_DAYS),
    })),
  };
}

export function createEmptyTeams(): UserTeams {
  return { teams: [] };
}
