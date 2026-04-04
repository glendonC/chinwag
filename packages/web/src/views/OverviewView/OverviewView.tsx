import { useMemo, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePollingStore, forceRefresh } from '../../lib/stores/polling.js';
import { useAuthStore } from '../../lib/stores/auth.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { getColorHex } from '../../lib/utils.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import KeyboardHint from '../../components/KeyboardHint/KeyboardHint.jsx';
import { useTabs } from '../../hooks/useTabs.js';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import StatusState from '../../components/StatusState/StatusState.jsx';
import {
  ShimmerText,
  SkeletonStatGrid,
  SkeletonRows,
} from '../../components/Skeleton/Skeleton.jsx';
import { summarizeList } from '../../lib/summarize.js';
import { useOverviewData } from './useOverviewData.js';
import ProjectsPanel from './ProjectsPanel.jsx';
import AgentsPanel from './AgentsPanel.jsx';
import ToolsPanel from './ToolsPanel.jsx';
import MemoriesPanel from './MemoriesPanel.jsx';
import styles from './OverviewView.module.css';

const OVERVIEW_TABS = ['projects', 'agents', 'tools', 'memories'] as const;
type OverviewTab = (typeof OVERVIEW_TABS)[number];

interface StatEntry {
  id: OverviewTab;
  label: string;
  value: number;
  tone: string;
}

function summarizeNames(items: Array<{ team_id?: string; team_name?: string }>): string {
  const names = items.map((item) => item?.team_name || item?.team_id).filter(Boolean) as string[];
  return summarizeList(names);
}

interface Props {}

export default function OverviewView(_props: Props) {
  const { dashboardData, dashboardStatus, pollError, pollErrorData, lastUpdate } = usePollingStore(
    useShallow((s) => ({
      dashboardData: s.dashboardData,
      dashboardStatus: s.dashboardStatus,
      pollError: s.pollError,
      pollErrorData: s.pollErrorData,
      lastUpdate: s.lastUpdate,
    })),
  );
  const user = useAuthStore((s) => s.user);
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
  const {
    activeTab: activeViz,
    setActiveTab: setActiveViz,
    hint,
    ref: statsRef,
  } = useTabs(OVERVIEW_TABS);
  const [search, setSearch] = useState<string>('');
  const userColor = getColorHex(user?.color ?? '') || '#121317';
  const knownTeamCount = teams.length;
  const hasKnownProjects = knownTeamCount > 0 || summaries.length > 0;
  const lastSynced = formatRelativeTime(lastUpdate);
  const failedLabel = failedTeams.length > 0 ? summarizeNames(failedTeams) : '';

  const {
    totalActive,
    totalMemories,
    hostShare,
    surfaceShare,
    toolUsage,
    uniqueTools,
    arcs,
    agentRows,
  } = useOverviewData(summaries);

  const filteredProjects = useMemo(() => {
    if (!search.trim()) return summaries;
    const q = search.trim().toLowerCase();
    return summaries.filter((t) => (t.team_name || t.team_id).toLowerCase().includes(q));
  }, [summaries, search]);

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
          <div className={styles.welcomeBlock}>
            <span className={styles.eyebrow}>Overview</span>
            <ShimmerText as="h1" className={styles.title}>
              Loading your projects
            </ShimmerText>
          </div>
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
            lastSynced
              ? `Last synced ${lastSynced}`
              : knownTeamCount > 0
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

  const stats: StatEntry[] = [
    { id: 'projects', label: 'Projects', value: knownTeamCount || summaries.length, tone: '' },
    {
      id: 'agents',
      label: 'Agents live',
      value: totalActive,
      tone: totalActive > 0 ? 'accent' : '',
    },
    { id: 'tools', label: 'Stack', value: uniqueTools, tone: '' },
    { id: 'memories', label: 'Memories', value: totalMemories, tone: '' },
  ];

  return (
    <div className={styles.overview}>
      <section className={styles.header}>
        <div className={styles.welcomeBlock}>
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
        <div
          className={styles.statsRow}
          ref={statsRef}
          role="tablist"
          aria-label="Overview sections"
        >
          {stats.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={activeViz === s.id}
              aria-controls={`panel-${s.id}`}
              data-tab={s.id}
              tabIndex={activeViz === s.id ? 0 : -1}
              className={`${styles.statButton} ${activeViz === s.id ? styles.statActive : ''}`}
              style={{ '--stat-index': i } as CSSProperties}
              onClick={(e) => {
                e.currentTarget.focus();
                setActiveViz(s.id);
              }}
            >
              <span className={styles.statLabel}>
                {s.label}
                {activeViz === s.id && <KeyboardHint {...hint} />}
              </span>
              <span
                className={`${styles.statValue} ${s.tone === 'accent' ? styles.statAccent : ''}`}
              >
                {s.value}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.vizArea}>
        {activeViz === 'projects' && (
          <ProjectsPanel
            summaries={summaries}
            filteredProjects={filteredProjects}
            search={search}
            setSearch={setSearch}
            selectTeam={selectTeam}
          />
        )}
        {activeViz === 'agents' && <AgentsPanel agentRows={agentRows} />}
        {activeViz === 'tools' && (
          <ToolsPanel
            arcs={arcs}
            toolUsage={toolUsage}
            uniqueTools={uniqueTools}
            hostShare={hostShare}
            surfaceShare={surfaceShare}
            summaries={summaries}
          />
        )}
        {activeViz === 'memories' && (
          <MemoriesPanel
            summaries={summaries}
            totalMemories={totalMemories}
            selectTeam={selectTeam}
          />
        )}
      </section>
    </div>
  );
}
