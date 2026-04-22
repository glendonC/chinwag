import { useMemo, useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import {
  GRID_DROPPABLE_ID,
  snapChipToCursor,
  type CatalogDragPayload,
} from '../../components/WidgetGrid/WidgetGrid.js';

const MOBILE_QUERY = '(max-width: 767px)';

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  }, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

import { usePollingStore, forceRefresh } from '../../lib/stores/polling.js';
import { useAuthStore } from '../../lib/stores/auth.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { getColorHex } from '../../lib/utils.js';
import { navigate, setQueryParam, useQueryParam } from '../../lib/router.js';
import { projectGradient } from '../../lib/projectGradient.js';
import { useUserAnalytics } from '../../hooks/useUserAnalytics.js';
import { useConversationAnalytics } from '../../hooks/useConversationAnalytics.js';
import { useDismissible } from '../../hooks/useDismissible.js';
import { useDetailDrill } from '../../hooks/useDetailDrill.js';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import InlineHint from '../../components/InlineHint/InlineHint.jsx';
import StatusState from '../../components/StatusState/StatusState.jsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import CustomizeButton from '../../components/CustomizeButton/CustomizeButton.jsx';
import EditModePill from '../../components/EditModePill/EditModePill.js';
import RangePills from '../../components/RangePills/RangePills.jsx';
import {
  ShimmerText,
  SkeletonStatGrid,
  SkeletonRows,
} from '../../components/Skeleton/Skeleton.jsx';
import { useOverviewData } from './useOverviewData.js';
import { useDemoScenario } from '../../hooks/useDemoScenario.js';
import { getDemoData } from '../../lib/demo/index.js';
import LiveNowView from './LiveNowView.js';
import UsageDetailView from './UsageDetailView.js';
import { RANGES, type RangeDays, summarizeNames } from './overview-utils.js';
import { useOverviewLayout } from './useOverviewLayout.js';
import { useProjectFilter } from './useProjectFilter.js';
import { getWidget } from '../../widgets/widget-catalog.js';
import { WidgetRenderer } from '../../widgets/WidgetRenderer.js';
import { WidgetCatalog } from '../../widgets/WidgetCatalog.js';
import type { Lock } from '../../lib/apiSchemas.js';

import styles from './OverviewView.module.css';
import { WidgetGrid } from '../../components/WidgetGrid/WidgetGrid.js';

// ── Project Filter ───────────────────────────────

function ProjectFilter({
  teams,
  projectFilter,
  selectTeam: selectTeamFn,
}: {
  teams: Array<{ team_id: string; team_name?: string | null }>;
  projectFilter: ReturnType<typeof useProjectFilter>;
  selectTeam: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { isAllSelected, isSingleProject, selectedIds, toggle, selectAll, isSelected } =
    projectFilter;

  if (teams.length === 0) return null;

  if (teams.length === 1) {
    const only = teams[0];
    const label = only.team_name || only.team_id;
    return (
      <span className={styles.projectFilterStatic} title={label}>
        <span
          className={styles.projectFilterStaticSwatch}
          style={{ background: projectGradient(only.team_id) }}
          aria-hidden="true"
        />
        <span className={styles.projectFilterStaticLabel}>{label}</span>
      </span>
    );
  }

  const selectedCount = isAllSelected ? teams.length : (selectedIds?.length ?? 0);
  const label = isAllSelected
    ? 'All projects'
    : isSingleProject
      ? (teams.find((t) => t.team_id === selectedIds![0])?.team_name ?? `1 project`)
      : `${selectedCount} projects`;

  return (
    <div className={styles.projectFilter}>
      <button
        type="button"
        className={clsx(styles.projectFilterTrigger, open && styles.projectFilterTriggerActive)}
        onClick={() => setOpen(!open)}
      >
        {label}
        <svg
          className={styles.projectFilterChevron}
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M2 3.5 L5 6.5 L8 3.5" />
        </svg>
      </button>
      {open && (
        <>
          <div className={styles.projectFilterBackdrop} onClick={() => setOpen(false)} />
          <div className={styles.projectFilterDropdown}>
            <div className={styles.projectFilterActions}>
              <button type="button" className={styles.projectFilterAction} onClick={selectAll}>
                Select all
              </button>
            </div>
            <div className={styles.projectFilterList}>
              {teams.map((t) => {
                const checked = isSelected(t.team_id);
                return (
                  <div
                    key={t.team_id}
                    className={styles.projectFilterItem}
                    onClick={() => toggle(t.team_id)}
                  >
                    <span
                      className={clsx(
                        styles.projectFilterCheck,
                        checked && styles.projectFilterCheckOn,
                      )}
                    >
                      {checked && (
                        <svg
                          className={styles.projectFilterCheckMark}
                          viewBox="0 0 10 10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2 5.5 L4 7.5 L8 3" />
                        </svg>
                      )}
                    </span>
                    <span className={styles.projectFilterName}>{t.team_name || t.team_id}</span>
                  </div>
                );
              })}
            </div>
            {isSingleProject && selectedIds?.[0] && (
              <div className={styles.projectFilterHint}>
                <button
                  type="button"
                  className={styles.projectFilterHintLink}
                  onClick={() => {
                    selectTeamFn(selectedIds[0]);
                    navigate('project', selectedIds[0]);
                    setOpen(false);
                  }}
                >
                  View full project dashboard
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Single-project hint (floating pill, bottom-center of content column) ──

const SINGLE_PROJECT_HINT_KEY = 'chinwag:single-project-hint-dismissed';

// Module-level stable reference for the Live widgets' `locks` prop. Inline
// `[]` rebuilds the array every render and defeats the memo on
// WidgetRenderer (shallow compare sees a new reference). The empty array
// here keeps the reference stable per module load.
const OVERVIEW_LOCKS: Lock[] = [];

// ── Main Component ────────────────────────────────

export default function OverviewView() {
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [editing, setEditing] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const { dashboardData, dashboardStatus, pollError, pollErrorData } = usePollingStore(
    useShallow((s) => ({
      dashboardData: s.dashboardData,
      dashboardStatus: s.dashboardStatus,
      pollError: s.pollError,
      pollErrorData: s.pollErrorData,
    })),
  );
  const user = useAuthStore((s) => s.user);
  const userColor = getColorHex(user?.color ?? '') || '#121317';
  const { teams, teamsError, selectTeam } = useTeamStore(
    useShallow((s) => ({
      teams: s.teams,
      teamsError: s.teamsError,
      selectTeam: s.selectTeam,
    })),
  );

  const demo = useDemoScenario();
  // In demo mode, substitute the scenario's fixture summaries so the live
  // widgets, projects widget, and liveAgents derivation all render from the
  // same source of truth without threading a demo flag through every hook.
  const summaries = useMemo(() => {
    if (demo.active) return getDemoData(demo.scenarioId).live.summaries;
    return dashboardData?.teams ?? [];
  }, [demo.active, demo.scenarioId, dashboardData?.teams]);
  const demoLocks = useMemo<Lock[]>(() => {
    if (!demo.active) return OVERVIEW_LOCKS;
    return getDemoData(demo.scenarioId).live.locks;
  }, [demo.active, demo.scenarioId]);
  const failedTeams = useMemo(
    () => dashboardData?.failed_teams ?? pollErrorData?.failed_teams ?? [],
    [dashboardData?.failed_teams, pollErrorData?.failed_teams],
  );

  const knownTeamCount = teams.length;
  const hasKnownProjects = knownTeamCount > 0 || summaries.length > 0;
  const failedLabel = failedTeams.length > 0 ? summarizeNames(failedTeams) : '';

  const { liveAgents, sortedSummaries } = useOverviewData(summaries);

  // Live Now full-page view. Query-param driven so the URL deep-links and
  // the back/forward buttons work. The value, when present, doubles as a
  // focus hint — clicking a specific agent row in the widget passes that
  // agent_id so LiveNowView can auto-scroll to their row inside the full
  // picture. An empty string opens the view without focus. The auxiliary
  // `live-tab` param carries the initial tab when a row deep-links to a
  // specific section (conflicts/files); closing live clears both.
  const live = useDetailDrill('live');
  const liveTabParam = useQueryParam('live-tab');
  const liveShifted = live.shifted;
  const focusAgentId = live.param && live.param.length > 0 ? live.param : null;
  const closeLive = useCallback(() => {
    setQueryParam('live-tab', null);
    live.close();
  }, [live]);

  // Usage Detail — same query-param pattern as Live Now, scoped to the
  // usage category. The value is the initial tab (sessions/edits/cost/etc).
  const usage = useDetailDrill('usage');
  const usageShifted = usage.shifted;

  // Escape closes whichever detail view is open. Collapsing to a single
  // active close handler keeps one listener regardless of how many
  // drill-ins exist; adding a new category extends the chain by one line.
  const activeClose = liveShifted ? closeLive : usageShifted ? usage.close : null;
  useEffect(() => {
    if (!activeClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') activeClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeClose]);

  const projectFilter = useProjectFilter(teams);
  const { analytics } = useUserAnalytics(rangeDays, true, projectFilter.selectedIds);
  const { data: conversationData } = useConversationAnalytics(
    rangeDays,
    true,
    projectFilter.selectedIds,
  );

  const {
    widgetIds,
    slots,
    toggleWidget: toggleWidgetRaw,
    addWidgetAt,
    removeWidget: removeWidgetRaw,
    reorderWidgets,
    setSlotSize,
    resetToDefault,
    clearAll: clearAllRaw,
    undo,
  } = useOverviewLayout();

  const singleProjectHint = useDismissible(SINGLE_PROJECT_HINT_KEY);
  const isMobile = useMediaQuery(MOBILE_QUERY);

  // Visually-hidden live region for screen-reader announcements when
  // widgets are added/removed/restored. Using state (not a ref) so React
  // re-renders the message into the DOM where the live region picks it up.
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((text: string) => {
    // Reset to empty first so identical messages get re-announced.
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(text));
  }, []);

  // Trigger for scroll + highlight. Cleared as soon as GridContainer picks
  // it up (via a no-op render cycle), so adding the same widget twice in
  // rapid succession still retriggers the effect.
  const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null);
  useEffect(() => {
    if (!recentlyAddedId) return;
    const t = setTimeout(() => setRecentlyAddedId(null), 2500);
    return () => clearTimeout(t);
  }, [recentlyAddedId]);

  const toggleWidget = useCallback(
    (id: string) => {
      const def = getWidget(id);
      const wasActive = widgetIds.includes(id);
      toggleWidgetRaw(id);
      if (def) {
        announce(wasActive ? `Removed ${def.name}` : `Added ${def.name}`);
      }
      if (!wasActive) setRecentlyAddedId(id);
    },
    [toggleWidgetRaw, widgetIds, announce],
  );

  const removeWidget = useCallback(
    (id: string) => {
      const def = getWidget(id);
      removeWidgetRaw(id);
      if (def) announce(`Removed ${def.name}`);
    },
    [removeWidgetRaw, announce],
  );

  const clearAll = useCallback(() => {
    clearAllRaw();
    announce('Cleared all widgets');
  }, [clearAllRaw, announce]);

  // ── Drag context (covers both catalog drag AND grid reorder) ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const [catalogDragging, setCatalogDragging] = useState<CatalogDragPayload | null>(null);
  // Sortable reorder state — captured at drag start so the DragOverlay
  // can render the dragged widget at its real cell dimensions. Without
  // the overlay, sortable items move via inline transform on the
  // original element, which on CSS Grid + transform combos visibly
  // inflates past their grid track. With the overlay path, the original
  // cell holds a stable placeholder and the moving widget is sized to
  // exactly what the user grabbed.
  const [sortableDragging, setSortableDragging] = useState<{
    id: string;
    w: number;
    h: number;
  } | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const activeId = String(event.active.id);
    if (activeId.startsWith('catalog:')) {
      const data = event.active.data.current as CatalogDragPayload | undefined;
      if (data) setCatalogDragging(data);
      return;
    }
    const rect = event.active.rect.current.initial;
    if (rect) {
      setSortableDragging({ id: activeId, w: rect.width, h: rect.height });
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setCatalogDragging(null);
      setSortableDragging(null);
      const { active, over } = event;
      if (!over) return;
      const activeId = String(active.id);
      const overId = String(over.id);

      if (activeId.startsWith('catalog:')) {
        // Catalog → grid: insert at overId's position, or append if over the
        // grid sentinel.
        const data = active.data.current as CatalogDragPayload | undefined;
        if (!data) return;
        const def = getWidget(data.widgetId);
        if (!def) return;
        const insertIndex =
          overId === GRID_DROPPABLE_ID ? slots.length : slots.findIndex((s) => s.id === overId);
        if (insertIndex < 0) return;
        addWidgetAt(data.widgetId, insertIndex);
        announce(`Added ${def.name}`);
        setRecentlyAddedId(data.widgetId);
        return;
      }

      // Sortable reorder.
      if (activeId === overId) return;
      const ids = slots.map((s) => s.id);
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return;
      reorderWidgets(arrayMove(ids, oldIndex, newIndex));
    },
    [slots, addWidgetAt, reorderWidgets, announce],
  );

  const handleDragCancel = useCallback(() => {
    setCatalogDragging(null);
    setSortableDragging(null);
  }, []);

  // Stable render callback for WidgetGrid. Without useCallback, this arrow
  // is a new reference on every render, which busts WidgetGrid's outer
  // memo and re-creates every WidgetRenderer JSX wrapper inside.
  // WidgetRenderer itself is memo'd, so what actually matters is whether
  // its props change reference — which they don't, as long as the data
  // hooks (analytics, conversationData, liveAgents, sortedSummaries)
  // memoize their outputs. OVERVIEW_LOCKS is shared at module scope for
  // the same reason — `[]` literal would re-bust memo every render.
  const truncated = dashboardData?.truncated ?? false;
  const renderWidget = useCallback(
    (id: string) => (
      <WidgetRenderer
        widgetId={id}
        analytics={analytics}
        conversationData={conversationData}
        summaries={sortedSummaries as Array<Record<string, unknown>>}
        liveAgents={liveAgents}
        locks={demoLocks}
        truncated={truncated}
        selectTeam={selectTeam}
      />
    ),
    [analytics, conversationData, sortedSummaries, liveAgents, demoLocks, truncated, selectTeam],
  );

  // Cmd/Ctrl-Z to undo layout changes (drag, resize, add, remove, reset).
  // Skips when typing in inputs or contenteditable elements so it doesn't
  // hijack form-field undo.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'z' || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.isContentEditable) return;
      }
      const undone = undo();
      if (undone) {
        e.preventDefault();
        announce('Undid last layout change');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, announce]);

  // `c` opens the customize menu when the dashboard is the focus surface.
  // `r` toggles rearrange mode — both work whether the catalog is open
  // or closed (the catalog's own handler covers the open case; this
  // covers the closed case so rearrange is a first-class action that
  // doesn't require browsing the catalog first). `Esc` exits rearrange
  // when the user is stranded in edit mode without the catalog open;
  // when the catalog IS open, its own Esc handler closes it instead.
  //
  // Refs (not deps) for `catalogOpen` / `editing` so toggling either
  // doesn't re-mount the window listener — listener churn during a drag
  // (e.g., the user hits R mid-flow) was a candidate jank source.
  const catalogOpenRef = useRef(catalogOpen);
  const editingRef = useRef(editing);
  useEffect(() => {
    catalogOpenRef.current = catalogOpen;
  }, [catalogOpen]);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  useEffect(() => {
    if (isMobile || liveShifted || usageShifted) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.isContentEditable) return;
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setCatalogOpen((p) => !p);
        return;
      }
      if (!catalogOpenRef.current && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        setEditing((p) => !p);
        return;
      }
      if (!catalogOpenRef.current && editingRef.current && e.key === 'Escape') {
        e.preventDefault();
        setEditing(false);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMobile, liveShifted, usageShifted]);

  // ── Guards ──────────────────────────────────────
  const isLoading = !dashboardData && (dashboardStatus === 'idle' || dashboardStatus === 'loading');
  const isUnavailable =
    dashboardStatus === 'error' || (!pollError && hasKnownProjects && summaries.length === 0);
  const unavailableHint =
    knownTeamCount === 0
      ? 'We could not load your project overview right now.'
      : knownTeamCount === 1
        ? `We found ${teams[0]?.team_name || teams[0]?.team_id || 'a connected project'}, but its overview data is unavailable right now.`
        : `We found ${knownTeamCount} connected projects, but none of their overview data could be loaded.`;
  const unavailableDetail =
    pollError ||
    (failedLabel
      ? `Unavailable now: ${failedLabel}`
      : 'Project summaries are temporarily unavailable.');

  if (isLoading) {
    return (
      <div className={styles.overview}>
        <section className={styles.header}>
          <span className={styles.eyebrow}>Overview</span>
          <ShimmerText as="h1" className={styles.loadingTitle}>
            Loading your projects
          </ShimmerText>
          <SkeletonStatGrid count={4} />
        </section>
        <SkeletonRows count={3} columns={4} />
      </div>
    );
  }

  if (isUnavailable) {
    return (
      <div className={styles.overview}>
        <StatusState
          tone="danger"
          eyebrow="Overview unavailable"
          title="Could not load project overview"
          hint={unavailableHint}
          detail={unavailableDetail}
          meta={
            knownTeamCount > 0
              ? `${knownTeamCount} connected ${knownTeamCount === 1 ? 'project' : 'projects'}`
              : 'Overview'
          }
          actionLabel="Retry"
          onAction={forceRefresh}
        />
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div className={styles.overview}>
        <EmptyState
          large
          title={teamsError ? 'Could not load projects' : 'No projects yet'}
          hint={
            teamsError || (
              <>
                Run <code>npx chinwag init</code> in a repo to add one.
              </>
            )
          }
        />
      </div>
    );
  }

  // Active widgets with valid definitions. `projects` is gated to N ≥ 2
  // projects: at N = 1 the entire Overview already aggregates that single
  // team, so a one-row project list would duplicate on-screen data. First
  // use of data-driven default-layout filtering; extract to a shared helper
  // if this pattern picks up more widgets.
  const activeSlots = slots.filter((s) => {
    if (!getWidget(s.id)) return false;
    if (s.id === 'projects' && summaries.length < 2) return false;
    return true;
  });

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={styles.overview}>
        {liveShifted ? (
          <LiveNowView
            liveAgents={liveAgents}
            locks={demoLocks}
            focusAgentId={focusAgentId}
            initialTab={liveTabParam}
            onBack={closeLive}
            onOpenProject={(teamId) => {
              closeLive();
              selectTeam(teamId);
              navigate('project', teamId);
            }}
            onOpenTools={() => {
              closeLive();
              navigate('tools');
            }}
          />
        ) : usageShifted ? (
          <UsageDetailView
            analytics={analytics}
            initialTab={usage.param}
            onBack={usage.close}
            rangeDays={rangeDays}
            onRangeChange={setRangeDays}
          />
        ) : (
          <>
            {/* ── Header ── */}
            <section className={styles.header}>
              <ViewHeader
                eyebrow="Overview"
                title={
                  <>
                    Welcome back
                    {user?.handle ? (
                      <>
                        {', '}
                        <span style={{ color: userColor }}>{user.handle}</span>
                      </>
                    ) : null}
                    .
                  </>
                }
              />

              {failedTeams.length > 0 && (
                <div className={styles.summaryNotice}>
                  <span className={styles.summaryNoticeLabel}>
                    {failedTeams.length} {failedTeams.length === 1 ? 'project' : 'projects'}{' '}
                    unavailable
                  </span>
                  <span className={styles.summaryNoticeText}>{failedLabel}</span>
                </div>
              )}

              <div className={styles.rangeRow}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <ProjectFilter
                    teams={teams}
                    projectFilter={projectFilter}
                    selectTeam={selectTeam}
                  />
                  {!isMobile && (
                    <CustomizeButton
                      active={catalogOpen}
                      onClick={() => setCatalogOpen(!catalogOpen)}
                      kbd="c"
                    />
                  )}
                  <RangePills value={rangeDays} onChange={setRangeDays} options={RANGES} />
                </div>
              </div>
            </section>

            {analytics.degraded && (
              <div className={styles.summaryNotice}>
                <span className={styles.summaryNoticeLabel}>Partial data</span>
                <span className={styles.summaryNoticeText}>
                  Analytics from {analytics.teams_included} of your projects. Some projects could
                  not be reached.
                </span>
              </div>
            )}

            {/* ── Widget Grid ── */}
            <div className={styles.gridBleed}>
              <WidgetGrid
                slots={activeSlots}
                editing={editing && !isMobile}
                recentlyAddedId={recentlyAddedId}
                renderWidget={renderWidget}
                onReorder={reorderWidgets}
                onRemove={removeWidget}
                onSlotSize={setSlotSize}
              />
            </div>

            {/* ── Single-project hint (floating, bottom-center of content column) ── */}
            {teams.length === 1 &&
              !catalogOpen &&
              !editing &&
              !singleProjectHint.isDismissed(teams[0].team_id) && (
                <InlineHint
                  actionLabel="Open dashboard"
                  onAction={() => {
                    selectTeam(teams[0].team_id);
                    navigate('project', teams[0].team_id);
                  }}
                  onDismiss={() => singleProjectHint.dismiss(teams[0].team_id)}
                >
                  For a single project, the project dashboard has deeper detail.
                </InlineHint>
              )}
          </>
        )}

        {/* Visually-hidden live region for layout-change announcements. */}
        <div role="status" aria-live="polite" aria-atomic="true" className={styles.srOnly}>
          {announcement}
        </div>

        {/* ── Widget catalog ── */}
        <WidgetCatalog
          open={catalogOpen}
          onClose={() => setCatalogOpen(false)}
          widgetIds={widgetIds}
          toggleWidget={toggleWidget}
          editing={editing}
          setEditing={setEditing}
          resetToDefault={resetToDefault}
          clearAll={clearAll}
          viewScope="overview"
        />

        {/* Floating exit affordance when rearranging without the catalog. */}
        {editing && !catalogOpen && !isMobile && !liveShifted && !usageShifted && (
          <EditModePill onDone={() => setEditing(false)} />
        )}
      </div>
      <DragOverlay
        dropAnimation={null}
        modifiers={catalogDragging ? [snapChipToCursor] : undefined}
      >
        {catalogDragging ? (
          <div className={styles.dragOverlayCard}>
            <span className={styles.dragOverlayName}>{catalogDragging.name}</span>
          </div>
        ) : sortableDragging ? (
          <div
            className={styles.dragOverlayWidget}
            style={{ width: sortableDragging.w, height: sortableDragging.h }}
          >
            {renderWidget(sortableDragging.id)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
