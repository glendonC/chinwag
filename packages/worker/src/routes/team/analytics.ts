// Team analytics route — aggregated workflow intelligence data.

import { teamRoute, doResult } from '../../lib/middleware.js';

const ANALYTICS_DEFAULT_DAYS = 7;
const ANALYTICS_MAX_DAYS = 90;
// ± 14 hours covers every real-world IANA offset (Samoa is +13, Kiribati is
// +14, American Samoa is -11). Reject anything outside that range so garbage
// bind values can't be smuggled into the SQL modifier string.
const TZ_OFFSET_MIN = -14 * 60;
const TZ_OFFSET_MAX = 14 * 60;

function parseTzOffset(raw: string | null): number {
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  if (isNaN(n)) return 0;
  return Math.max(TZ_OFFSET_MIN, Math.min(n, TZ_OFFSET_MAX));
}

export const handleTeamAnalytics = teamRoute(async ({ request, agentId, team, user }) => {
  const url = new URL(request.url);
  const parsed = parseInt(url.searchParams.get('days') || String(ANALYTICS_DEFAULT_DAYS), 10);
  const days = Math.max(
    1,
    Math.min(isNaN(parsed) ? ANALYTICS_DEFAULT_DAYS : parsed, ANALYTICS_MAX_DAYS),
  );
  const extended = url.searchParams.get('extended') === '1';
  const tzOffsetMinutes = parseTzOffset(url.searchParams.get('tz_offset_minutes'));

  // Privacy-by-default: scope per-user analytics (sessions, edits, tokens,
  // outcomes, sentiment, etc.) to the caller. Cross-member cohort views
  // (member_analytics, member_count, member_daily_lines in team.ts)
  // intentionally ignore scope so each user still sees the team breakdown.
  // Net effect: project view shows "my numbers in this project" + "team
  // cohort overview" — neither leaks individual teammates' details.
  return doResult(
    team.getAnalytics(agentId, days, user.id, extended, tzOffsetMinutes, {
      handle: user.handle,
    }),
    'getAnalytics',
  );
});
