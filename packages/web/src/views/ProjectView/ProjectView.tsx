import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import clsx from 'clsx';
import { Responsive } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';

import { forceRefresh } from '../../lib/stores/polling.js';
import { teamActions } from '../../lib/stores/teams.js';
import { navigate } from '../../lib/router.js';
import StatusState from '../../components/StatusState/StatusState.jsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import KeyboardHint from '../../components/KeyboardHint/KeyboardHint.jsx';
import CustomizeButton from '../../components/CustomizeButton/CustomizeButton.jsx';
import RangePills from '../../components/RangePills/RangePills.jsx';
import {
  ShimmerText,
  SkeletonStatGrid,
  SkeletonRows,
  SkeletonLine,
} from '../../components/Skeleton/Skeleton.jsx';

import { useTabs } from '../../hooks/useTabs.js';
import { useTeamExtendedAnalytics } from '../../hooks/useTeamAnalytics.js';
import { useConversationAnalytics } from '../../hooks/useConversationAnalytics.js';
import { useProjectData } from './useProjectData.js';
import { useProjectTabLayout } from './useProjectTabLayout.js';
import { ACTIVITY_DEFAULT_LAYOUT, TRENDS_DEFAULT_LAYOUT } from './projectTabDefaults.js';
import ProjectMemoryTab from './ProjectMemoryTab.jsx';

import { WidgetRenderer } from '../OverviewView/WidgetRenderer.js';
import { WidgetCatalog } from '../OverviewView/WidgetCatalog.js';
import { getWidget } from '../OverviewView/widget-catalog.js';
import type { LiveAgent } from '../OverviewView/useOverviewData.js';
import type { UserAnalytics, ConversationAnalytics } from '../../lib/apiSchemas.js';

import overviewStyles from '../OverviewView/OverviewView.module.css';
import styles from './ProjectView.module.css';

// ── Grid constants (matched to OverviewView) ──────

const GRID_COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 };
const GRID_BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const GRID_MARGIN: [number, number] = [24, 24];
const GRID_ROW_HEIGHT = 80;
const GRAB_AREA_CLASS = 'widget-grab-area';
const MOBILE_QUERY = '(max-width: 767px)';

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

function deriveStackedLayout(layout: RGLLayout[], cols: number): RGLLayout[] {
  const sorted = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  let y = 0;
  return sorted.map((item) => {
    const stacked: RGLLayout = { ...item, x: 0, w: Math.min(item.w, cols), y };
    y += item.h;
    return stacked;
  });
}

// ── Grid container (mirrors OverviewView GridContainer) ──────

interface ProjectGridContainerProps {
  editing: boolean;
  gridLayout: RGLLayout[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onLayoutChange: (current: any, all: any) => void;
  onInteractionStart: () => void;
  onInteractionStop: () => void;
  activeWidgets: string[];
  analytics: UserAnalytics;
  conversationData: ConversationAnalytics;
  summaries: Array<Record<string, unknown>>;
  liveAgents: LiveAgent[];
  selectTeam: (id: string) => void;
  removeWidget: (id: string) => void;
}

function ProjectGridContainer({
  editing,
  gridLayout,
  onLayoutChange,
  onInteractionStart,
  onInteractionStop,
  activeWidgets,
  analytics,
  conversationData,
  summaries,
  liveAgents,
  selectTeam,
  removeWidget,
}: ProjectGridContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    obs.observe(containerRef.current);
    setWidth(containerRef.current.offsetWidth);
    return () => obs.disconnect();
  }, []);

  const layouts = useMemo(
    () => ({
      lg: gridLayout,
      md: gridLayout,
      sm: deriveStackedLayout(gridLayout, GRID_COLS.sm),
      xs: deriveStackedLayout(gridLayout, GRID_COLS.xs),
      xxs: deriveStackedLayout(gridLayout, GRID_COLS.xxs),
    }),
    [gridLayout],
  );

  const handleDragStart = useCallback(() => {
    if (containerRef.current) containerRef.current.dataset.dragging = 'true';
    onInteractionStart();
  }, [onInteractionStart]);

  const handleDragStop = useCallback(() => {
    if (containerRef.current) delete containerRef.current.dataset.dragging;
    onInteractionStop();
  }, [onInteractionStop]);

  return (
    <div ref={containerRef} className={clsx(editing && overviewStyles.widgetEditing)}>
      {width > 0 && (
        <Responsive
          {...({
            className: 'overview-grid',
            width,
            layouts,
            breakpoints: GRID_BREAKPOINTS,
            cols: GRID_COLS,
            margin: GRID_MARGIN,
            // Zero edge padding so widget content aligns with page text.
            // Inter-widget spacing is still controlled by `margin` above.
            containerPadding: [0, 0] as [number, number],
            rowHeight: GRID_ROW_HEIGHT,
            isDraggable: editing,
            isResizable: editing,
            onLayoutChange,
            onDragStart: handleDragStart,
            onDragStop: handleDragStop,
            onResizeStart: handleDragStart,
            onResizeStop: handleDragStop,
            compactType: 'vertical',
            dragConfig: {
              handle: `.${GRAB_AREA_CLASS}`,
              cancel: 'button, a, input, select, textarea, [role="button"]',
              threshold: 5,
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)}
        >
          {activeWidgets.map((id) => (
            <div key={id}>
              <div className={clsx(overviewStyles.widget, GRAB_AREA_CLASS)}>
                {editing && (
                  <button
                    type="button"
                    className={overviewStyles.widgetRemove}
                    onClick={() => removeWidget(id)}
                    aria-label={`Remove ${getWidget(id)?.name ?? 'widget'}`}
                  >
                    Remove
                  </button>
                )}
                <WidgetRenderer
                  widgetId={id}
                  analytics={analytics}
                  conversationData={conversationData}
                  summaries={summaries}
                  liveAgents={liveAgents}
                  selectTeam={selectTeam}
                />
              </div>
            </div>
          ))}
        </Responsive>
      )}
    </div>
  );
}

// ── Tab definitions ─────────────────────────────

const PROJECT_TABS = ['activity', 'trends', 'memory'] as const;
type ProjectTab = (typeof PROJECT_TABS)[number];

interface StatEntry {
  id: ProjectTab;
  label: string;
  value: string | number;
  tone: '' | 'accent';
}

// ── Main component ──────────────────────────────

interface Props {}

export default function ProjectView(_props: Props) {
  const {
    activeTeam,
    activeTeamId,
    projectLabel,
    pollError,
    lastSynced,
    isLoading,
    isUnavailable,
    activeAgents,
    conflicts,
    memories,
    memoryBreakdown,
  } = useProjectData();

  const { activeTab, setActiveTab, hint, ref: statsRef } = useTabs(PROJECT_TABS);
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30);
  const [editing, setEditing] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const isMobile = useMediaQuery(MOBILE_QUERY);
  const isAnalytical = activeTab === 'activity' || activeTab === 'trends';

  // Analytics fetched only when an analytical tab is active
  const { analytics } = useTeamExtendedAnalytics(activeTeamId, rangeDays, isAnalytical);
  const { data: conversationData } = useConversationAnalytics(
    rangeDays,
    isAnalytical,
    activeTeamId ? [activeTeamId] : undefined,
  );

  // Per-tab layouts. Both hooks called unconditionally for stable hook order.
  const activityLayout = useProjectTabLayout('activity', ACTIVITY_DEFAULT_LAYOUT);
  const trendsLayout = useProjectTabLayout('trends', TRENDS_DEFAULT_LAYOUT);
  const currentLayout = activeTab === 'activity' ? activityLayout : trendsLayout;

  const handleDeleteMemory = useCallback(
    async (id: string) => {
      if (!activeTeamId) return;
      await teamActions.deleteMemory(activeTeamId, id);
    },
    [activeTeamId],
  );

  // Derive LiveAgent shape from project members for widgets that consume it.
  // Empty array is acceptable — analytical widgets don't require it.
  const liveAgents: LiveAgent[] = useMemo(() => {
    if (!activeTeamId) return [];
    return activeAgents.map((m) => ({
      agent_id: m.agent_id,
      handle: m.handle,
      host_tool: m.host_tool || 'unknown',
      agent_surface: (m as { agent_surface?: string | null }).agent_surface ?? null,
      files: (m as { files?: string[] }).files ?? [],
      summary: (m as { summary?: string | null }).summary ?? null,
      session_minutes: (m as { session_minutes?: number | null }).session_minutes ?? null,
      teamName: projectLabel,
      teamId: activeTeamId,
    }));
  }, [activeAgents, activeTeamId, projectLabel]);

  const summaries: Array<Record<string, unknown>> = useMemo(() => [], []);

  const selectTeam = useCallback((id: string) => {
    teamActions.selectTeam(id);
    navigate('project', id);
  }, []);

  const stats: StatEntry[] = [
    {
      id: 'activity',
      label: 'Activity',
      value: activeAgents.length === 0 ? 'quiet' : `${activeAgents.length} active`,
      tone: activeAgents.length > 0 ? 'accent' : '',
    },
    {
      id: 'trends',
      label: 'Trends',
      value: `${rangeDays} days`,
      tone: '',
    },
    {
      id: 'memory',
      label: 'Memory',
      value: memories.length === 0 ? 'no memories' : `${memories.length} memories`,
      tone: '',
    },
  ];

  // Cmd/Ctrl-Z to undo layout changes (matches OverviewView behavior).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'z' || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.isContentEditable) return;
      }
      const undone = currentLayout.undo();
      if (undone) e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentLayout]);

  // ── Loading guard ──
  if (isLoading) {
    return (
      <div className={styles.page}>
        <header style={{ marginBottom: 28 }}>
          <span className={styles.loadingEyebrow}>Project</span>
          <ShimmerText as="h1" className={styles.loadingTitle}>
            {`Loading ${projectLabel}`}
          </ShimmerText>
        </header>
        <SkeletonStatGrid count={4} />
        <div style={{ marginTop: 40 }}>
          <SkeletonLine width="100%" height={32} />
        </div>
        <div style={{ marginTop: 28 }}>
          <SkeletonRows count={4} columns={3} />
        </div>
      </div>
    );
  }

  if (isUnavailable) {
    return (
      <div className={styles.page}>
        <StatusState
          tone="danger"
          eyebrow="Project unavailable"
          title={`Could not load ${projectLabel}`}
          hint="Live coordination for this project is temporarily unavailable."
          detail={pollError}
          meta={lastSynced ? `Last synced ${lastSynced}` : 'No successful sync yet'}
          actionLabel="Retry"
          onAction={forceRefresh}
        />
      </div>
    );
  }

  const activeWidgets = currentLayout.widgetIds.filter((id) => getWidget(id));
  const gridLayout = currentLayout.gridLayout.filter((l) => activeWidgets.includes(l.i));

  return (
    <div className={styles.page}>
      <ViewHeader eyebrow="Project" title={activeTeam?.team_name || 'Project'} />

      {/* Global alert chrome — visible across tabs */}
      {conflicts.length > 0 && (
        <button
          type="button"
          className={styles.conflictBanner}
          onClick={() => setActiveTab('activity')}
        >
          <span className={styles.conflictText}>
            {conflicts.length} {conflicts.length === 1 ? 'file' : 'files'} with overlapping edits
          </span>
          <span className={styles.conflictAction}>View</span>
        </button>
      )}

      {/* Tab nav (preserves the big-number aesthetic from the original) */}
      <section className={styles.header}>
        <div
          className={styles.statsRow}
          ref={statsRef}
          role="tablist"
          aria-label="Project sections"
        >
          {stats.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={activeTab === s.id}
              aria-controls={`panel-${s.id}`}
              data-tab={s.id}
              tabIndex={activeTab === s.id ? 0 : -1}
              className={clsx(styles.statButton, activeTab === s.id && styles.statActive)}
              style={{ '--stat-index': i } as CSSProperties}
              onClick={(e) => {
                e.currentTarget.focus();
                setActiveTab(s.id);
              }}
            >
              <span className={styles.statLabel}>
                {s.label}
                {activeTab === s.id && <KeyboardHint {...hint} />}
              </span>
              <span className={clsx(styles.statValue, s.tone === 'accent' && styles.statAccent)}>
                {s.value}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Customize bar (analytical tabs only) */}
      {isAnalytical && (
        <div className={overviewStyles.rangeRow}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {!isMobile && (
              <CustomizeButton active={catalogOpen} onClick={() => setCatalogOpen(!catalogOpen)} />
            )}
          </div>
          <RangePills value={rangeDays} onChange={setRangeDays} />
        </div>
      )}

      {/* Tab content */}
      <section className={styles.vizArea}>
        {isAnalytical && (
          <div className={styles.vizPanel} role="tabpanel" id={`panel-${activeTab}`}>
            <div className={styles.gridBleed}>
              <ProjectGridContainer
                editing={editing && !isMobile}
                gridLayout={gridLayout}
                activeWidgets={activeWidgets}
                analytics={analytics}
                conversationData={conversationData}
                summaries={summaries}
                liveAgents={liveAgents}
                selectTeam={selectTeam}
                onLayoutChange={(current) => currentLayout.updatePositions(current)}
                onInteractionStart={currentLayout.beginInteraction}
                onInteractionStop={currentLayout.commitLayout}
                removeWidget={currentLayout.removeWidget}
              />
            </div>
          </div>
        )}

        {activeTab === 'memory' && (
          <div className={styles.vizPanel} role="tabpanel" id="panel-memory">
            <ProjectMemoryTab
              memories={memories}
              memoryBreakdown={memoryBreakdown}
              onDeleteMemory={handleDeleteMemory}
            />
          </div>
        )}
      </section>

      {/* Customize panel (analytical tabs only) */}
      {isAnalytical && (
        <WidgetCatalog
          open={catalogOpen}
          onClose={() => setCatalogOpen(false)}
          widgetIds={currentLayout.widgetIds}
          toggleWidget={currentLayout.toggleWidget}
          editing={editing}
          setEditing={setEditing}
          resetToDefault={currentLayout.resetToDefault}
          clearAll={currentLayout.clearAll}
        />
      )}
    </div>
  );
}
