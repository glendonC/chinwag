// Default widget layouts for each project tab. These are starter sets
// that suggest the intent of each tab. Users can customize freely.

import type { WidgetSlot } from '../../widgets/widget-catalog.js';

// Activity tab - live operational surface. Who's working in this repo
// right now, what files are contested, what's in play. KPI strip below
// for at-a-glance project health. Trends tab owns the historical charts.
export const ACTIVITY_DEFAULT_LAYOUT: WidgetSlot[] = [
  // Live presence + conflicts side by side
  { id: 'live-agents', colSpan: 6, rowSpan: 3 },
  { id: 'live-conflicts', colSpan: 6, rowSpan: 3 },
  // Files in play (full width)
  { id: 'files-in-play', colSpan: 12, rowSpan: 3 },
  // At-a-glance KPI strip
  { id: 'sessions', colSpan: 3, rowSpan: 2 },
  { id: 'edits', colSpan: 3, rowSpan: 2 },
  { id: 'cost', colSpan: 3, rowSpan: 2 },
  { id: 'files-touched', colSpan: 3, rowSpan: 2 },
];

// Trends tab - historical reflection. Bigger charts, full coverage.
export const TRENDS_DEFAULT_LAYOUT: WidgetSlot[] = [
  // session-trend was cut 2026-04-24 (see widget-catalog.ts Trends
  // block). Outcomes snaps to its natural 8 cols - was 4 only because
  // session-trend filled the other 8. No forced backfill on the row.
  { id: 'outcomes', colSpan: 8, rowSpan: 3 },
  { id: 'heatmap', colSpan: 12, rowSpan: 3 },
  { id: 'work-types', colSpan: 6, rowSpan: 3 },
  { id: 'hourly-effectiveness', colSpan: 6, rowSpan: 3 },
  { id: 'directories', colSpan: 6, rowSpan: 4 },
  { id: 'files', colSpan: 6, rowSpan: 4 },
  { id: 'tools', colSpan: 6, rowSpan: 3 },
  { id: 'models', colSpan: 6, rowSpan: 3 },
  { id: 'stuckness', colSpan: 6, rowSpan: 3 },
  { id: 'first-edit', colSpan: 6, rowSpan: 3 },
  { id: 'topics', colSpan: 6, rowSpan: 3 },
  { id: 'prompt-clarity', colSpan: 6, rowSpan: 3 },
];
