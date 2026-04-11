import { useState, useCallback } from 'react';
import { DEFAULT_WIDGET_IDS, DEFAULT_LAYOUT, getWidget } from './widget-catalog.js';

// ── Unified layout store ─────────────────────────
// Single source of truth: widget IDs + grid positions in one object.
// Replaces the previous dual-store (chinwag:overview-layout + chinwag:overview-positions).

const STORAGE_KEY = 'chinwag:overview-dashboard';
const STORAGE_VERSION = 1;

// Migrate from legacy dual stores if they exist
const LEGACY_IDS_KEY = 'chinwag:overview-layout';
const LEGACY_POS_KEY = 'chinwag:overview-positions';

interface WidgetPosition {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DashboardLayout {
  version: number;
  widgets: WidgetPosition[];
}

function buildDefaultLayout(): DashboardLayout {
  return {
    version: STORAGE_VERSION,
    widgets: DEFAULT_LAYOUT.map((l) => ({
      id: l.i,
      x: l.x,
      y: l.y,
      w: l.w,
      h: l.h,
    })),
  };
}

function migrateLegacy(): DashboardLayout | null {
  try {
    const idsRaw = localStorage.getItem(LEGACY_IDS_KEY);
    const posRaw = localStorage.getItem(LEGACY_POS_KEY);
    if (!idsRaw && !posRaw) return null;

    const ids: string[] = idsRaw ? JSON.parse(idsRaw) : DEFAULT_WIDGET_IDS;
    const positions: Array<{ i: string; x: number; y: number; w: number; h: number }> = posRaw
      ? JSON.parse(posRaw)
      : [];

    const posMap = new Map(positions.map((p) => [p.i, p]));
    const widgets: WidgetPosition[] = ids.map((id) => {
      const pos = posMap.get(id);
      if (pos) return { id: pos.i, x: pos.x, y: pos.y, w: pos.w, h: pos.h };
      // No stored position — use catalog defaults
      const def = getWidget(id);
      const defaultPos = DEFAULT_LAYOUT.find((l) => l.i === id);
      return {
        id,
        x: defaultPos?.x ?? 0,
        y: defaultPos?.y ?? Infinity,
        w: def?.w ?? 6,
        h: def?.h ?? 3,
      };
    });

    const layout: DashboardLayout = { version: STORAGE_VERSION, widgets };

    // Clean up legacy keys
    localStorage.removeItem(LEGACY_IDS_KEY);
    localStorage.removeItem(LEGACY_POS_KEY);

    return layout;
  } catch {
    return null;
  }
}

function isLayoutValid(layout: DashboardLayout): boolean {
  if (!layout.widgets.length) return false;
  // Check that at least some widgets use multi-column positions (not all x=0)
  const hasMultiCol = layout.widgets.some((w) => w.x > 0 || w.w > 4);
  return hasMultiCol;
}

function loadDashboard(): DashboardLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.version === STORAGE_VERSION && Array.isArray(parsed.widgets)) {
        if (isLayoutValid(parsed)) return parsed;
        // Stored layout is broken (all single-column) — rebuild from defaults
        // but keep the user's widget selection
        const selectedIds = new Set(parsed.widgets.map((w: WidgetPosition) => w.id));
        const rebuilt = buildDefaultLayout();
        rebuilt.widgets = rebuilt.widgets.filter((w) => selectedIds.has(w.id));
        // Add any user widgets not in the default layout
        for (const wp of parsed.widgets) {
          if (!rebuilt.widgets.some((w) => w.id === wp.id)) {
            const def = getWidget(wp.id);
            rebuilt.widgets.push({
              id: wp.id,
              x: 0,
              y: Infinity,
              w: def?.w ?? 6,
              h: def?.h ?? 3,
            });
          }
        }
        saveDashboard(rebuilt);
        return rebuilt;
      }
    }
  } catch {
    // Ignore corrupt storage
  }

  // Try migrating from legacy stores
  const migrated = migrateLegacy();
  if (migrated && isLayoutValid(migrated)) {
    saveDashboard(migrated);
    return migrated;
  }

  // Clean up any broken legacy data
  try {
    localStorage.removeItem(LEGACY_IDS_KEY);
    localStorage.removeItem(LEGACY_POS_KEY);
  } catch {
    /* */
  }

  const def = buildDefaultLayout();
  saveDashboard(def);
  return def;
}

function saveDashboard(layout: DashboardLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Ignore storage quota
  }
}

// ── RGL layout helpers ───────────────────────────

interface RGLLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

function toRGLLayout(widgets: WidgetPosition[]): RGLLayout[] {
  return widgets.map((wp) => {
    const def = getWidget(wp.id);
    return {
      i: wp.id,
      x: wp.x,
      y: wp.y,
      w: wp.w,
      h: wp.h,
      minW: def?.minW,
      minH: def?.minH,
      maxW: def?.maxW,
      maxH: def?.maxH,
    };
  });
}

function fromRGLLayout(rgl: RGLLayout[]): WidgetPosition[] {
  return rgl.map((l) => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h }));
}

// ── Hook ─────────────────────────────────────────

export function useOverviewLayout() {
  const [dashboard, setDashboardInner] = useState<DashboardLayout>(loadDashboard);

  const setDashboard = useCallback((fn: (prev: DashboardLayout) => DashboardLayout) => {
    setDashboardInner((prev) => {
      const next = fn(prev);
      saveDashboard(next);
      return next;
    });
  }, []);

  // Derived: ordered widget IDs
  const widgetIds = dashboard.widgets.map((w) => w.id);

  // Derived: RGL layout with constraints
  const gridLayout = toRGLLayout(dashboard.widgets);

  // Toggle a widget on/off
  const toggleWidget = useCallback(
    (id: string) => {
      setDashboard((prev) => {
        const exists = prev.widgets.some((w) => w.id === id);
        if (exists) {
          return { ...prev, widgets: prev.widgets.filter((w) => w.id !== id) };
        }
        // Add with auto-placement
        const def = getWidget(id);
        const defaultPos = DEFAULT_LAYOUT.find((l) => l.i === id);
        return {
          ...prev,
          widgets: [
            ...prev.widgets,
            {
              id,
              x: defaultPos?.x ?? 0,
              y: defaultPos?.y ?? Infinity,
              w: def?.w ?? 6,
              h: def?.h ?? 3,
            },
          ],
        };
      });
    },
    [setDashboard],
  );

  // Remove a widget
  const removeWidget = useCallback(
    (id: string) => {
      setDashboard((prev) => ({
        ...prev,
        widgets: prev.widgets.filter((w) => w.id !== id),
      }));
    },
    [setDashboard],
  );

  // Update positions from RGL drag/resize callback
  const updatePositions = useCallback(
    (rglLayout: RGLLayout[]) => {
      setDashboard((prev) => {
        // Only update positions for widgets that exist in our store
        const idSet = new Set(prev.widgets.map((w) => w.id));
        const updated = fromRGLLayout(rglLayout.filter((l) => idSet.has(l.i)));
        // Preserve ordering from RGL
        return { ...prev, widgets: updated };
      });
    },
    [setDashboard],
  );

  // Reset to default — clear everything and rebuild
  const resetToDefault = useCallback(() => {
    try {
      localStorage.removeItem(LEGACY_IDS_KEY);
      localStorage.removeItem(LEGACY_POS_KEY);
    } catch {
      /* */
    }
    const def = buildDefaultLayout();
    saveDashboard(def);
    setDashboardInner(def);
  }, []);

  return {
    widgetIds,
    gridLayout,
    toggleWidget,
    removeWidget,
    updatePositions,
    resetToDefault,
  };
}
