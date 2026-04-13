import { useState, useCallback, useRef, useEffect } from 'react';
import { getWidget } from '../OverviewView/widget-catalog.js';

// Per-tab layout persistence for the project page. Each tab (Activity, Trends)
// has its own layout stored under a separate localStorage key so users can
// customize each tab independently.

const STORAGE_VERSION = 1;
const UNDO_STACK_LIMIT = 25;

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

function storageKey(tabId: string): string {
  return `chinwag:project-${tabId}-dashboard`;
}

function buildDefaultLayout(defaults: RGLLayout[]): DashboardLayout {
  return {
    version: STORAGE_VERSION,
    widgets: defaults.map((l) => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h })),
  };
}

function loadDashboard(tabId: string, defaults: RGLLayout[]): DashboardLayout {
  try {
    const raw = localStorage.getItem(storageKey(tabId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.version === STORAGE_VERSION && Array.isArray(parsed.widgets)) {
        return parsed;
      }
    }
  } catch {
    // Ignore corrupt storage
  }
  const def = buildDefaultLayout(defaults);
  saveDashboard(tabId, def);
  return def;
}

function saveDashboard(tabId: string, layout: DashboardLayout) {
  try {
    localStorage.setItem(storageKey(tabId), JSON.stringify(layout));
  } catch {
    // Ignore storage quota
  }
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

export function useProjectTabLayout(tabId: string, defaults: RGLLayout[]) {
  const [dashboard, setDashboardInner] = useState<DashboardLayout>(() =>
    loadDashboard(tabId, defaults),
  );

  const dashboardRef = useRef(dashboard);
  dashboardRef.current = dashboard;

  // Re-load when the tab changes (different storage key)
  useEffect(() => {
    setDashboardInner(loadDashboard(tabId, defaults));
    // Intentionally only re-run on tabId change; defaults is stable per tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  const undoStackRef = useRef<DashboardLayout[]>([]);

  const pushUndoSnapshot = useCallback(() => {
    const snap = dashboardRef.current;
    if (!snap) return;
    const stack = undoStackRef.current;
    stack.push(snap);
    if (stack.length > UNDO_STACK_LIMIT) stack.shift();
  }, []);

  const setAndSave = useCallback(
    (fn: (prev: DashboardLayout) => DashboardLayout) => {
      pushUndoSnapshot();
      setDashboardInner((prev) => {
        const next = fn(prev);
        saveDashboard(tabId, next);
        return next;
      });
    },
    [pushUndoSnapshot, tabId],
  );

  const widgetIds = dashboard.widgets.map((w) => w.id);
  const gridLayout = toRGLLayout(dashboard.widgets);

  const toggleWidget = useCallback(
    (id: string) => {
      setAndSave((prev) => {
        const exists = prev.widgets.some((w) => w.id === id);
        if (exists) {
          return { ...prev, widgets: prev.widgets.filter((w) => w.id !== id) };
        }
        const def = getWidget(id);
        return {
          ...prev,
          widgets: [...prev.widgets, { id, x: 0, y: 0, w: def?.w ?? 6, h: def?.h ?? 3 }],
        };
      });
    },
    [setAndSave],
  );

  const removeWidget = useCallback(
    (id: string) => {
      setAndSave((prev) => ({
        ...prev,
        widgets: prev.widgets.filter((w) => w.id !== id),
      }));
    },
    [setAndSave],
  );

  const updatePositions = useCallback((rglLayout: RGLLayout[]) => {
    setDashboardInner((prev) => {
      const idSet = new Set(prev.widgets.map((w) => w.id));
      const updated = fromRGLLayout(rglLayout.filter((l) => idSet.has(l.i)));
      return { ...prev, widgets: updated };
    });
  }, []);

  const beginInteraction = useCallback(() => {
    pushUndoSnapshot();
  }, [pushUndoSnapshot]);

  const commitLayout = useCallback(() => {
    saveDashboard(tabId, dashboardRef.current);
  }, [tabId]);

  const resetToDefault = useCallback(() => {
    pushUndoSnapshot();
    const def = buildDefaultLayout(defaults);
    saveDashboard(tabId, def);
    setDashboardInner(def);
  }, [pushUndoSnapshot, defaults, tabId]);

  const clearAll = useCallback(() => {
    pushUndoSnapshot();
    const empty: DashboardLayout = { version: STORAGE_VERSION, widgets: [] };
    saveDashboard(tabId, empty);
    setDashboardInner(empty);
  }, [pushUndoSnapshot, tabId]);

  const undo = useCallback((): boolean => {
    const snap = undoStackRef.current.pop();
    if (!snap) return false;
    saveDashboard(tabId, snap);
    setDashboardInner(snap);
    return true;
  }, [tabId]);

  return {
    widgetIds,
    gridLayout,
    toggleWidget,
    removeWidget,
    updatePositions,
    beginInteraction,
    commitLayout,
    resetToDefault,
    clearAll,
    undo,
  };
}
