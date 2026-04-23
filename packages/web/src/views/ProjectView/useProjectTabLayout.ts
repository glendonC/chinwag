import { useState, useCallback, useRef, useEffect } from 'react';
import {
  defaultSlot,
  type WidgetSlot,
  type WidgetColSpan,
  type WidgetRowSpan,
} from '../../widgets/widget-catalog.js';

// Per-tab layout persistence for the project page. Each tab (Activity, Trends)
// has its own layout stored under a separate localStorage key so users can
// customize each tab independently. v3 shape: ordered WidgetSlots with
// colSpan/rowSpan only. v1/v2 migrate by sorting stored widgets by (y,x)
// and dropping positions.

const STORAGE_VERSION = 3;
const UNDO_STACK_LIMIT = 25;

interface DashboardLayout {
  version: number;
  widgets: WidgetSlot[];
}

function storageKey(tabId: string): string {
  return `chinmeister:project-${tabId}-dashboard`;
}

function buildDefaultLayout(defaults: WidgetSlot[]): DashboardLayout {
  return { version: STORAGE_VERSION, widgets: defaults.map((s) => ({ ...s })) };
}

function mapColSpan(w: number): WidgetColSpan {
  if (w <= 3) return 3;
  if (w === 4) return 4;
  if (w <= 6) return 6;
  if (w <= 8) return 8;
  return 12;
}

function mapRowSpan(h: number): WidgetRowSpan {
  if (h <= 2) return 2;
  if (h === 3) return 3;
  return 4;
}

interface LegacyWidget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function migrateLegacyWidgets(widgets: LegacyWidget[]): WidgetSlot[] {
  return [...widgets]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((w) => ({ id: w.id, colSpan: mapColSpan(w.w), rowSpan: mapRowSpan(w.h) }))
    .filter((s) => defaultSlot(s.id));
}

function loadDashboard(tabId: string, defaults: WidgetSlot[]): DashboardLayout {
  try {
    const raw = localStorage.getItem(storageKey(tabId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if ((parsed?.version === 1 || parsed?.version === 2) && Array.isArray(parsed.widgets)) {
        const migrated: DashboardLayout = {
          version: STORAGE_VERSION,
          widgets: migrateLegacyWidgets(parsed.widgets as LegacyWidget[]),
        };
        saveDashboard(tabId, migrated);
        return migrated;
      }
      if (parsed?.version === STORAGE_VERSION && Array.isArray(parsed.widgets)) {
        const valid = (parsed.widgets as WidgetSlot[]).filter((s) => defaultSlot(s.id));
        return { version: STORAGE_VERSION, widgets: valid };
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

export function useProjectTabLayout(tabId: string, defaults: WidgetSlot[]) {
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

  const widgetIds = dashboard.widgets.map((s) => s.id);

  const toggleWidget = useCallback(
    (id: string) => {
      setAndSave((prev) => {
        const exists = prev.widgets.some((s) => s.id === id);
        if (exists) {
          return { ...prev, widgets: prev.widgets.filter((s) => s.id !== id) };
        }
        const slot = defaultSlot(id);
        if (!slot) return prev;
        return { ...prev, widgets: [...prev.widgets, slot] };
      });
    },
    [setAndSave],
  );

  // Insert a catalog widget at a specific index. Drag-from-catalog uses this
  // so the drop location becomes the insertion point in the source order.
  const addWidgetAt = useCallback(
    (id: string, index: number) => {
      setAndSave((prev) => {
        if (prev.widgets.some((s) => s.id === id)) return prev;
        const slot = defaultSlot(id);
        if (!slot) return prev;
        const widgets = [...prev.widgets];
        const clamped = Math.max(0, Math.min(index, widgets.length));
        widgets.splice(clamped, 0, slot);
        return { ...prev, widgets };
      });
    },
    [setAndSave],
  );

  const removeWidget = useCallback(
    (id: string) => {
      setAndSave((prev) => ({
        ...prev,
        widgets: prev.widgets.filter((s) => s.id !== id),
      }));
    },
    [setAndSave],
  );

  const reorderWidgets = useCallback(
    (ids: string[]) => {
      setAndSave((prev) => {
        const byId = new Map(prev.widgets.map((s) => [s.id, s]));
        const reordered = ids.map((id) => byId.get(id)).filter((s): s is WidgetSlot => !!s);
        for (const s of prev.widgets) {
          if (!ids.includes(s.id)) reordered.push(s);
        }
        return { ...prev, widgets: reordered };
      });
    },
    [setAndSave],
  );

  const setSlotSize = useCallback(
    (id: string, size: { colSpan?: WidgetColSpan; rowSpan?: WidgetRowSpan }) => {
      setAndSave((prev) => ({
        ...prev,
        widgets: prev.widgets.map((s) =>
          s.id === id
            ? {
                ...s,
                colSpan: size.colSpan ?? s.colSpan,
                rowSpan: size.rowSpan ?? s.rowSpan,
              }
            : s,
        ),
      }));
    },
    [setAndSave],
  );

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
    slots: dashboard.widgets,
    toggleWidget,
    addWidgetAt,
    removeWidget,
    reorderWidgets,
    setSlotSize,
    resetToDefault,
    clearAll,
    undo,
  };
}
