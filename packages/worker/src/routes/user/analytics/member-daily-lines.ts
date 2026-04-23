// Per-teammate daily line attribution across teams.
// Sums (handle, day) across every team the user belongs to, since handles
// are globally unique to a user per the account model (users.handle UNIQUE).
// Final projection caps at the top 50 handles by total edits to match
// memberAnalyticsSchema's LIMIT 50, so the two fields agree on which
// teammates exist in the drill.

import type { MemberDailyLineTrend } from '@chinmeister/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

interface MemberDailyBucket {
  sessions: number;
  edits: number;
  lines_added: number;
  lines_removed: number;
}

// Compound key format: `${handle}|${day}`. Pipe is outside the handle
// charset (alphanumeric + underscore) and outside YYYY-MM-DD, so the
// key is collision-free without escaping.
const KEY_SEP = '|';

export type MemberDailyLinesAcc = Map<string, MemberDailyBucket>;

export function createAcc(): MemberDailyLinesAcc {
  return new Map();
}

export function merge(acc: MemberDailyLinesAcc, team: TeamResult): void {
  for (const row of team.member_daily_lines ?? []) {
    const key = `${row.handle}${KEY_SEP}${row.day}`;
    const existing = acc.get(key) ?? {
      sessions: 0,
      edits: 0,
      lines_added: 0,
      lines_removed: 0,
    };
    existing.sessions += row.sessions;
    existing.edits += row.edits;
    existing.lines_added += row.lines_added;
    existing.lines_removed += row.lines_removed;
    acc.set(key, existing);
  }
}

export function project(acc: MemberDailyLinesAcc): MemberDailyLineTrend[] {
  // First collapse into per-handle totals so we can pick the top 50.
  const totalsByHandle = new Map<string, number>();
  for (const [key, v] of acc.entries()) {
    const handle = key.slice(0, key.indexOf(KEY_SEP));
    totalsByHandle.set(handle, (totalsByHandle.get(handle) ?? 0) + v.edits);
  }
  const topHandles = new Set(
    [...totalsByHandle.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 50)
      .map(([h]) => h),
  );

  const out: MemberDailyLineTrend[] = [];
  for (const [key, v] of acc.entries()) {
    const sep = key.indexOf(KEY_SEP);
    const handle = key.slice(0, sep);
    if (!topHandles.has(handle)) continue;
    const day = key.slice(sep + 1);
    out.push({
      handle,
      day,
      sessions: v.sessions,
      edits: v.edits,
      lines_added: v.lines_added,
      lines_removed: v.lines_removed,
    });
  }
  out.sort((a, b) =>
    a.day === b.day ? a.handle.localeCompare(b.handle) : a.day.localeCompare(b.day),
  );
  return out;
}
