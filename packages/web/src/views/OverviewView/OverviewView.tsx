import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { Responsive } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';

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
  static?: boolean;
}

type RGLLayouts = { [breakpoint: string]: RGLLayout[] };
import { usePollingStore, forceRefresh } from '../../lib/stores/polling.js';
import { useAuthStore } from '../../lib/stores/auth.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { getColorHex } from '../../lib/utils.js';
import { navigate } from '../../lib/router.js';
import type { UserAnalytics, ConversationAnalytics } from '../../lib/apiSchemas.js';
import { useUserAnalytics } from '../../hooks/useUserAnalytics.js';
import { useConversationAnalytics } from '../../hooks/useConversationAnalytics.js';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import StatusState from '../../components/StatusState/StatusState.jsx';
import {
  ShimmerText,
  SkeletonStatGrid,
  SkeletonRows,
} from '../../components/Skeleton/Skeleton.jsx';
import { useOverviewData, type LiveAgent } from './useOverviewData.js';
import { RANGES, type RangeDays, summarizeNames } from './overview-utils.js';
import { useOverviewLayout } from './useOverviewLayout.js';
import { useProjectFilter } from './useProjectFilter.js';
import { getWidget } from './widget-catalog.js';
import { WidgetRenderer } from './WidgetRenderer.js';
import { WidgetCatalog } from './WidgetCatalog.js';
import { LiveAgentsBar } from './sections/ProjectSections.js';

import styles from './OverviewView.module.css';

const GRID_COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 };
const GRID_BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const GRID_MARGIN: [number, number] = [24, 24];
const GRID_ROW_HEIGHT = 80;

// ── Grid container with width measurement ────────

function GridContainer({
  editing,
  gridLayout,
  onLayoutChange,
  activeWidgets,
  analytics,
  conversationData,
  summaries,
  liveAgents,
  selectTeam,
  removeWidget,
}: {
  editing: boolean;
  gridLayout: RGLLayout[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onLayoutChange: (current: any, all: any) => void;
  activeWidgets: string[];
  analytics: UserAnalytics;
  conversationData: ConversationAnalytics;
  summaries: Array<Record<string, unknown>>;
  liveAgents: LiveAgent[];
  selectTeam: (id: string) => void;
  removeWidget: (id: string) => void;
}) {
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

  return (
    <div ref={containerRef} className={clsx(editing && styles.widgetEditing)}>
      {width > 0 && (
        <Responsive
          {...({
            className: 'overview-grid',
            width,
            layouts: { lg: gridLayout, md: gridLayout },
            breakpoints: GRID_BREAKPOINTS,
            cols: GRID_COLS,
            margin: GRID_MARGIN,
            rowHeight: GRID_ROW_HEIGHT,
            isDraggable: editing,
            isResizable: editing,
            onLayoutChange,
            useCSSTransforms: true,
            compactType: 'vertical',
          } as any)}
        >
          {activeWidgets.map((id) => (
            <div key={id}>
              <div className={styles.widget}>
                {editing && (
                  <>
                    <span className={styles.widgetDragHandle}>&#x2630;</span>
                    <button
                      type="button"
                      className={styles.widgetRemove}
                      onClick={() => removeWidget(id)}
                      title="Remove"
                    >
                      &times;
                    </button>
                  </>
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

  if (teams.length <= 1) return null;

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

  const summaries = useMemo(() => dashboardData?.teams ?? [], [dashboardData?.teams]);
  const failedTeams = useMemo(
    () => dashboardData?.failed_teams ?? pollErrorData?.failed_teams ?? [],
    [dashboardData?.failed_teams, pollErrorData?.failed_teams],
  );

  const knownTeamCount = teams.length;
  const hasKnownProjects = knownTeamCount > 0 || summaries.length > 0;
  const failedLabel = failedTeams.length > 0 ? summarizeNames(failedTeams) : '';

  const { liveAgents, sortedSummaries } = useOverviewData(summaries);
  const projectFilter = useProjectFilter(teams);
  const { analytics } = useUserAnalytics(rangeDays, true, projectFilter.selectedIds);
  const { data: conversationData } = useConversationAnalytics(
    rangeDays,
    true,
    projectFilter.selectedIds,
  );

  const {
    widgetIds,
    gridLayout: storedGridLayout,
    toggleWidget,
    removeWidget,
    updatePositions,
    resetToDefault,
  } = useOverviewLayout();

  const handleLayoutChange = useCallback(
    (currentLayout: RGLLayout[], _allLayouts: RGLLayouts) => {
      updatePositions(currentLayout);
    },
    [updatePositions],
  );

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

  // Active widgets with valid definitions
  const activeWidgets = widgetIds.filter((id) => getWidget(id));

  // Grid layout from unified store (already has constraints applied)
  const gridLayout = storedGridLayout.filter((l) => activeWidgets.includes(l.i));

  return (
    <div className={styles.overview}>
      {/* ── Header ── */}
      <section className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Overview</span>
          <h1 className={styles.title}>
            Welcome back
            {user?.handle ? (
              <>
                {', '}
                <span style={{ color: userColor }}>{user.handle}</span>
              </>
            ) : null}
            .
          </h1>
        </div>

        {failedTeams.length > 0 && (
          <div className={styles.summaryNotice}>
            <span className={styles.summaryNoticeLabel}>
              {failedTeams.length} {failedTeams.length === 1 ? 'project' : 'projects'} unavailable
            </span>
            <span className={styles.summaryNoticeText}>{failedLabel}</span>
          </div>
        )}

        <div className={styles.rangeRow}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ProjectFilter teams={teams} projectFilter={projectFilter} selectTeam={selectTeam} />
            <button
              type="button"
              className={clsx(styles.customizeBtn, catalogOpen && styles.customizeBtnActive)}
              onClick={() => setCatalogOpen(!catalogOpen)}
            >
              Customize
              <svg
                className={styles.customizeIcon}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path
                  d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
                  stroke="none"
                />
                <path d="M20 3v4" fill="none" />
                <path d="M22 5h-4" fill="none" />
                <path d="M4 17v2" fill="none" />
                <path d="M5 18H3" fill="none" />
              </svg>
            </button>
          </div>
          <div className={styles.rangeSelector} role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={clsx(styles.rangeButton, rangeDays === r && styles.rangeActive)}
                onClick={() => setRangeDays(r)}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>
      </section>

      {analytics.degraded && (
        <div className={styles.summaryNotice}>
          <span className={styles.summaryNoticeLabel}>Partial data</span>
          <span className={styles.summaryNoticeText}>
            Analytics from {analytics.teams_included} of your projects. Some projects could not be
            reached.
          </span>
        </div>
      )}

      {/* ── Live Agents ── */}
      {liveAgents.length > 0 && <LiveAgentsBar liveAgents={liveAgents} selectTeam={selectTeam} />}

      {/* ── Widget Grid ── */}
      <GridContainer
        editing={editing}
        gridLayout={gridLayout}
        onLayoutChange={handleLayoutChange}
        activeWidgets={activeWidgets}
        analytics={analytics}
        conversationData={conversationData}
        summaries={sortedSummaries as Array<Record<string, unknown>>}
        liveAgents={liveAgents}
        selectTeam={selectTeam}
        removeWidget={removeWidget}
      />

      {/* ── Widget catalog ── */}
      <WidgetCatalog
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        widgetIds={widgetIds}
        toggleWidget={toggleWidget}
        editing={editing}
        setEditing={setEditing}
        resetToDefault={resetToDefault}
      />
    </div>
  );
}
