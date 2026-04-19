// Default widget layouts for each project tab. These are starter sets
// that suggest the intent of each tab. Users can customize freely.

interface RGLLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Activity tab — live operational surface. Who's working in this repo
// right now, what files are contested, what's in play. KPI strip below
// for at-a-glance project health. Trends tab owns the historical charts.
export const ACTIVITY_DEFAULT_LAYOUT: RGLLayout[] = [
  // Live presence + conflicts side by side
  { i: 'live-agents', x: 0, y: 0, w: 6, h: 3 },
  { i: 'live-conflicts', x: 6, y: 0, w: 6, h: 3 },
  // Files in play (full width)
  { i: 'files-in-play', x: 0, y: 3, w: 12, h: 3 },
  // At-a-glance KPI strip
  { i: 'sessions', x: 0, y: 6, w: 3, h: 2 },
  { i: 'edits', x: 3, y: 6, w: 3, h: 2 },
  { i: 'cost', x: 6, y: 6, w: 3, h: 2 },
  { i: 'files-touched', x: 9, y: 6, w: 3, h: 2 },
];

// Trends tab — historical reflection. Bigger charts, full coverage.
export const TRENDS_DEFAULT_LAYOUT: RGLLayout[] = [
  { i: 'session-trend', x: 0, y: 0, w: 8, h: 3 },
  { i: 'outcomes', x: 8, y: 0, w: 4, h: 3 },
  { i: 'heatmap', x: 0, y: 3, w: 8, h: 4 },
  { i: 'work-types', x: 8, y: 3, w: 4, h: 3 },
  { i: 'directories', x: 0, y: 7, w: 6, h: 4 },
  { i: 'files', x: 6, y: 7, w: 6, h: 4 },
  { i: 'tools', x: 0, y: 11, w: 6, h: 3 },
  { i: 'models', x: 6, y: 11, w: 6, h: 3 },
  { i: 'stuckness', x: 0, y: 14, w: 6, h: 3 },
  { i: 'first-edit', x: 6, y: 14, w: 6, h: 3 },
  { i: 'topics', x: 0, y: 17, w: 6, h: 3 },
  { i: 'sentiment-outcomes', x: 6, y: 17, w: 6, h: 3 },
];
