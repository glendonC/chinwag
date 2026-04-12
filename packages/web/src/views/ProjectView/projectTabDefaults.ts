// Default widget layouts for each project tab. These are starter sets
// that suggest the intent of each tab. Users can customize freely.

interface RGLLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Activity tab — at-a-glance + recent state. Mostly compact stat widgets
// since live widgets aren't in the catalog yet (follow-up slice).
export const ACTIVITY_DEFAULT_LAYOUT: RGLLayout[] = [
  { i: 'sessions', x: 0, y: 0, w: 3, h: 2 },
  { i: 'edits', x: 3, y: 0, w: 3, h: 2 },
  { i: 'files-touched', x: 6, y: 0, w: 3, h: 2 },
  { i: 'cost', x: 9, y: 0, w: 3, h: 2 },
  { i: 'outcomes', x: 0, y: 2, w: 6, h: 3 },
  { i: 'tools', x: 6, y: 2, w: 6, h: 3 },
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
  { i: 'sentiment', x: 0, y: 17, w: 6, h: 3 },
  { i: 'topics', x: 6, y: 17, w: 6, h: 3 },
];
