import { useState, useCallback, useRef, useEffect } from 'react';
import {
  DEFAULT_LAYOUT,
  defaultSlot,
  resolveWidgetAlias,
  type WidgetSlot,
  type WidgetColSpan,
  type WidgetRowSpan,
} from '../../widgets/widget-catalog.js';

// ── Unified layout store ─────────────────────────
// v3 shape: ordered list of WidgetSlots. Each slot carries only the
// grid-axis sizes (colSpan, rowSpan) — no x/y. Rendering is CSS Grid with
// grid-auto-flow:row, so ordering is the only placement signal.

const STORAGE_KEY = 'chinmeister:overview-dashboard';
const STORAGE_VERSION = 3;
const UNDO_STACK_LIMIT = 25;

const LEGACY_IDS_KEY = 'chinmeister:overview-layout';
const LEGACY_POS_KEY = 'chinmeister:overview-positions';

interface DashboardLayout {
  version: number;
  widgets: WidgetSlot[];
}

function buildDefaultLayout(): DashboardLayout {
  return { version: STORAGE_VERSION, widgets: DEFAULT_LAYOUT.map((s) => ({ ...s })) };
}

// Map stored RGL w/h to canonical spans. Clamping logic mirrors the catalog
// so a user who stored a hand-customized w=5 lands on the nearest 6.
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

// v1/v2 → v3: both prior shapes store {id,x,y,w,h}. We preserve reading
// order (sort by y then x) and drop positions. Sizes collapse to canonical
// spans. No data lost that the new renderer can use.
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
    .map((w) => ({ id: w.id, colSpan: mapColSpan(w.w), rowSpan: mapRowSpan(w.h) }));
}

// Expand deprecated widget ids (rename/split) into their replacements. An
// unaliased id is preserved at the user's stored size. Replacements drop
// back to catalog defaults since the old slot size may not fit the new
// widgets. De-duplicates so a user who already has a replacement visible
// doesn't end up with two copies after the expansion runs.
function resolveAliases(slots: WidgetSlot[]): WidgetSlot[] {
  const seen = new Set<string>();
  const out: WidgetSlot[] = [];
  for (const slot of slots) {
    const ids = resolveWidgetAlias(slot.id);
    if (ids.length === 1 && ids[0] === slot.id) {
      if (!seen.has(slot.id) && defaultSlot(slot.id)) {
        seen.add(slot.id);
        out.push(slot);
      }
      continue;
    }
    for (const rid of ids) {
      if (seen.has(rid)) continue;
      const def = defaultSlot(rid);
      if (def) {
        seen.add(rid);
        out.push(def);
      }
    }
  }
  return out;
}

// 2026-04: catalog `w` for live-agents was 12 until we narrowed it to 6 to
// match DEFAULT_LAYOUT. Users who toggled live-agents off/on (or who
// drag-added it from the catalog) before the fix have it persisted at
// colSpan: 12 — full width — even though the curated default has always
// placed it at half-width next to live-conflicts. Snap that one slot back.
// Removable once enough time has passed that stale storage has cycled out.
function healLiveAgentsWidth(slots: WidgetSlot[]): WidgetSlot[] {
  return slots.map((s) => (s.id === 'live-agents' && s.colSpan === 12 ? { ...s, colSpan: 6 } : s));
}

// 2026-04-22: catalog `w` for projects was 12 until the comparator-table
// redesign narrowed it to 8. Same situation as live-agents above — users
// with persisted colSpan: 12 see the new table sprawl across the full row
// because the grid has way more leftover space than the cells need. Heal
// back to the new default so the redesign actually lands. Power users who
// genuinely want it at 12 can drag-resize back; the cost of one-time reset
// is lower than leaving the widget visibly broken for existing users.
function healProjectsWidth(slots: WidgetSlot[]): WidgetSlot[] {
  return slots.map((s) => (s.id === 'projects' && s.colSpan === 12 ? { ...s, colSpan: 8 } : s));
}

// 2026-04-24: outcomes widget went from ring-only at 4×3 to ring + 4-column
// table at 8×3. The table (OUTCOME | COUNT | SHARE | TREND) can't render
// in the old 4-col slot — labels clip, headers collide. Snap any saved
// outcomes slot that's narrower than its new minimum (6 cols) up to the
// new default (8). session-trend was cut the same day so its paired
// healer is gone — saved layouts drop the slot via WIDGET_ALIASES.
function healOutcomesWidth(slots: WidgetSlot[]): WidgetSlot[] {
  return slots.map((s) => (s.id === 'outcomes' && s.colSpan < 6 ? { ...s, colSpan: 8 } : s));
}

// 2026-04-25: scope-complexity moved from a row/table experiment to a
// scope-tax composition. The design needs enough horizontal room for the
// hero + bucket marks to breathe; 6-col saved slots collapse into cramped
// typography. Heal existing saved layouts to the catalog's 8-col default.
function healScopeComplexityWidth(slots: WidgetSlot[]): WidgetSlot[] {
  return slots.map((s) =>
    s.id === 'scope-complexity' && s.colSpan < 8 ? { ...s, colSpan: 8 } : s,
  );
}

function migrateFromLegacyKeys(): DashboardLayout | null {
  try {
    const idsRaw = localStorage.getItem(LEGACY_IDS_KEY);
    const posRaw = localStorage.getItem(LEGACY_POS_KEY);
    if (!idsRaw && !posRaw) return null;

    const ids: string[] = idsRaw ? JSON.parse(idsRaw) : [];
    const positions: Array<{ i: string; x: number; y: number; w: number; h: number }> = posRaw
      ? JSON.parse(posRaw)
      : [];
    const posMap = new Map(positions.map((p) => [p.i, p]));
    const legacy: LegacyWidget[] = ids.map((id, idx) => {
      const pos = posMap.get(id);
      return pos
        ? { id, x: pos.x, y: pos.y, w: pos.w, h: pos.h }
        : { id, x: 0, y: idx, w: 6, h: 3 };
    });
    const slots = resolveAliases(migrateLegacyWidgets(legacy));

    localStorage.removeItem(LEGACY_IDS_KEY);
    localStorage.removeItem(LEGACY_POS_KEY);

    return { version: STORAGE_VERSION, widgets: slots };
  } catch {
    return null;
  }
}

function loadDashboard(): DashboardLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if ((parsed?.version === 1 || parsed?.version === 2) && Array.isArray(parsed.widgets)) {
        const slots = resolveAliases(migrateLegacyWidgets(parsed.widgets as LegacyWidget[]));
        const migrated: DashboardLayout = { version: STORAGE_VERSION, widgets: slots };
        saveDashboard(migrated);
        return migrated;
      }
      if (parsed?.version === STORAGE_VERSION && Array.isArray(parsed.widgets)) {
        const expanded = resolveAliases(parsed.widgets as WidgetSlot[]);
        const healed = healScopeComplexityWidth(
          healOutcomesWidth(healProjectsWidth(healLiveAgentsWidth(expanded))),
        );
        const stored = parsed.widgets as WidgetSlot[];
        const changed =
          healed.length !== stored.length ||
          healed.some((s, i) => s.id !== stored[i]?.id || s.colSpan !== stored[i]?.colSpan);
        if (changed) {
          saveDashboard({ version: STORAGE_VERSION, widgets: healed });
        }
        return { version: STORAGE_VERSION, widgets: healed };
      }
    }
  } catch {
    // Ignore corrupt storage
  }

  const migrated = migrateFromLegacyKeys();
  if (migrated && migrated.widgets.length > 0) {
    saveDashboard(migrated);
    return migrated;
  }

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

// ── Hook ─────────────────────────────────────────

export function useOverviewLayout() {
  const [dashboard, setDashboardInner] = useState<DashboardLayout>(loadDashboard);

  const dashboardRef = useRef(dashboard);
  useEffect(() => {
    dashboardRef.current = dashboard;
  }, [dashboard]);

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
        saveDashboard(next);
        return next;
      });
    },
    [pushUndoSnapshot],
  );

  const widgetIds = dashboard.widgets.map((s) => s.id);

  // Toggle on: append with catalog defaults. Toggle off: remove.
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

  // Insert a catalog widget at a specific index in the ordered list. Used by
  // drag-from-catalog: the drop location becomes the insertion point in the
  // CSS Grid source order (rather than an x/y coordinate). No-op if the
  // widget is already in the layout.
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

  // Reorder via @dnd-kit sortable. Accepts the full new ordered id list.
  const reorderWidgets = useCallback(
    (ids: string[]) => {
      setAndSave((prev) => {
        const byId = new Map(prev.widgets.map((s) => [s.id, s]));
        const reordered = ids.map((id) => byId.get(id)).filter((s): s is WidgetSlot => !!s);
        // Append any widgets not in `ids` to preserve data (shouldn't happen
        // but defensive).
        for (const s of prev.widgets) {
          if (!ids.includes(s.id)) reordered.push(s);
        }
        return { ...prev, widgets: reordered };
      });
    },
    [setAndSave],
  );

  // Set a widget's colSpan and/or rowSpan. Both fields optional; omitted
  // fields keep their current value.
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
    try {
      localStorage.removeItem(LEGACY_IDS_KEY);
      localStorage.removeItem(LEGACY_POS_KEY);
    } catch {
      /* */
    }
    const def = buildDefaultLayout();
    saveDashboard(def);
    setDashboardInner(def);
  }, [pushUndoSnapshot]);

  const clearAll = useCallback(() => {
    pushUndoSnapshot();
    const empty: DashboardLayout = { version: STORAGE_VERSION, widgets: [] };
    saveDashboard(empty);
    setDashboardInner(empty);
  }, [pushUndoSnapshot]);

  const undo = useCallback((): boolean => {
    const snap = undoStackRef.current.pop();
    if (!snap) return false;
    saveDashboard(snap);
    setDashboardInner(snap);
    return true;
  }, []);

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
