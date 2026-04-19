import { summarizeList } from '../../lib/summarize.js';

// ── View-specific constants ───────────────────────
// Widget-shared utilities (work types, colors, formatters, heatmap helpers)
// live in packages/web/src/widgets/utils.ts. This file intentionally keeps
// only exports that the OverviewView shell itself consumes.

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export function summarizeNames(items: Array<{ team_id?: string; team_name?: string }>): string {
  const names = items.map((item) => item?.team_name || item?.team_id).filter(Boolean) as string[];
  return summarizeList(names);
}
