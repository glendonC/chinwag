import type { WidgetDef, WidgetSlot } from './types.js';
import { VIZ_MAX_CONSTRAINTS } from './viz-constraints.js';
import { widgetColSpan, widgetRowSpan } from './span.js';
import { LIVE_WIDGETS } from './categories/live.js';
import { USAGE_WIDGETS } from './categories/usage.js';
import { OUTCOMES_WIDGETS } from './categories/outcomes.js';
import { ACTIVITY_WIDGETS } from './categories/activity.js';
import { CODEBASE_WIDGETS } from './categories/codebase.js';
import { TOOLS_WIDGETS } from './categories/tools.js';
import { CONVERSATIONS_WIDGETS } from './categories/conversations.js';
import { MEMORY_WIDGETS } from './categories/memory.js';
import { TEAM_WIDGETS } from './categories/team.js';

/**
 * Flat list of every widget the dashboard knows about. Assembled from
 * per-category modules under ./categories/. Adding a new widget touches
 * one category file; adding a new category adds one import and one
 * spread below.
 */
export const WIDGET_CATALOG: WidgetDef[] = [
  ...LIVE_WIDGETS,
  ...USAGE_WIDGETS,
  ...OUTCOMES_WIDGETS,
  ...ACTIVITY_WIDGETS,
  ...CODEBASE_WIDGETS,
  ...TOOLS_WIDGETS,
  ...CONVERSATIONS_WIDGETS,
  ...MEMORY_WIDGETS,
  ...TEAM_WIDGETS,
];

export const WIDGET_MAP = new Map(
  WIDGET_CATALOG.map((w) => {
    const vizMax = VIZ_MAX_CONSTRAINTS[w.viz];
    return [
      w.id,
      {
        ...w,
        maxW: w.maxW ?? vizMax?.maxW,
        maxH: w.maxH ?? vizMax?.maxH,
      },
    ];
  }),
);

export function getWidget(id: string): WidgetDef | undefined {
  return WIDGET_MAP.get(id);
}

/**
 * Build a WidgetSlot for an id using catalog defaults. Returns null when the
 * id isn't in the catalog.
 */
export function defaultSlot(id: string): WidgetSlot | null {
  const def = getWidget(id);
  if (!def) return null;
  return { id, colSpan: widgetColSpan(def), rowSpan: widgetRowSpan(def) };
}
