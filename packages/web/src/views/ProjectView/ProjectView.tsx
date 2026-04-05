import { type CSSProperties, useCallback } from 'react';
import clsx from 'clsx';
import { forceRefresh } from '../../lib/stores/polling.js';
import { teamActions } from '../../lib/stores/teams.js';
import ActivityTimeline from '../../components/ActivityTimeline/ActivityTimeline.jsx';
import StatusState from '../../components/StatusState/StatusState.jsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import {
  ShimmerText,
  SkeletonStatGrid,
  SkeletonRows,
  SkeletonLine,
} from '../../components/Skeleton/Skeleton.jsx';
import KeyboardHint from '../../components/KeyboardHint/KeyboardHint.jsx';
import { useTabs } from '../../hooks/useTabs.js';
import ProjectOverviewTab from './ProjectOverviewTab.jsx';
import ProjectLiveTab from './ProjectLiveTab.jsx';
import ProjectMemoryTab from './ProjectMemoryTab.jsx';
import { useProjectData } from './useProjectData.js';
import styles from './ProjectView.module.css';

const PROJECT_TABS = ['overview', 'agents', 'memory'] as const;
type ProjectTab = (typeof PROJECT_TABS)[number];

interface StatEntry {
  id: ProjectTab;
  label: string;
  value: string | number;
  tone: string;
}

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
    members,
    activeAgents,
    offlineAgents,
    sortedAgents,
    liveToolMix,
    allSessions,
    sessions,
    filesTouchedCount,
    sessionEditCount,
    liveSessionCount,
    locks,
    conflicts,
    filesInPlay,
    toolSummaries,
    memories,
    memoryBreakdown,
  } = useProjectData();

  const handleUpdateMemory = useCallback(
    async (id: string, text?: string, tags?: string[]) => {
      if (!activeTeamId) return;
      await teamActions.updateMemory(activeTeamId, id, text, tags);
    },
    [activeTeamId],
  );

  const handleDeleteMemory = useCallback(
    async (id: string) => {
      if (!activeTeamId) return;
      await teamActions.deleteMemory(activeTeamId, id);
    },
    [activeTeamId],
  );

  const {
    activeTab: activeViz,
    setActiveTab: setActiveViz,
    hint,
    ref: statsRef,
  } = useTabs(PROJECT_TABS);

  const stats: StatEntry[] = [
    { id: 'overview', label: 'Overview', value: '\u2014', tone: '' },
    {
      id: 'agents',
      label: 'Agents',
      value: activeAgents.length,
      tone: activeAgents.length > 0 ? 'accent' : '',
    },
    { id: 'memory', label: 'Memory', value: memories.length, tone: '' },
  ];

  if (isLoading) {
    return (
      <div className={styles.page}>
        <header style={{ marginBottom: 28 }}>
          <span className={styles.loadingEyebrow}>Project</span>
          <ShimmerText as="h1" className={styles.loadingTitle}>
            {`Loading ${projectLabel}`}
          </ShimmerText>
        </header>
        <SkeletonStatGrid count={3} />
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

  return (
    <div className={styles.page}>
      <ViewHeader eyebrow="Project" title={activeTeam?.team_name || 'Project'} />

      {conflicts.length > 0 && (
        <button
          type="button"
          className={styles.conflictBanner}
          onClick={() => setActiveViz('agents')}
        >
          <span className={styles.conflictText}>
            {conflicts.length} {conflicts.length === 1 ? 'file' : 'files'} with overlapping edits
          </span>
          <span className={styles.conflictAction}>View</span>
        </button>
      )}

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
              aria-selected={activeViz === s.id}
              aria-controls={`panel-${s.id}`}
              data-tab={s.id}
              tabIndex={activeViz === s.id ? 0 : -1}
              className={clsx(styles.statButton, activeViz === s.id && styles.statActive)}
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
              <span className={clsx(styles.statValue, s.tone === 'accent' && styles.statAccent)}>
                {s.value}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.activitySection}>
        <ActivityTimeline sessions={allSessions} liveCount={activeAgents.length} />
      </section>

      <section className={styles.vizArea}>
        {activeViz === 'overview' && (
          <div className={styles.vizPanel} role="tabpanel" id="panel-overview">
            <ProjectOverviewTab
              members={members}
              activeAgents={activeAgents}
              conflicts={conflicts}
              locks={locks}
              sessionEditCount={sessionEditCount}
              liveSessionCount={liveSessionCount}
              filesTouchedCount={filesTouchedCount}
              toolSummaries={toolSummaries}
            />
          </div>
        )}

        {activeViz === 'agents' && (
          <div className={styles.vizPanel} role="tabpanel" id="panel-agents">
            <ProjectLiveTab
              sortedAgents={sortedAgents}
              offlineAgents={offlineAgents}
              conflicts={conflicts}
              filesInPlay={filesInPlay}
              locks={locks}
              liveToolMix={liveToolMix}
              sessions={sessions as never[]}
            />
          </div>
        )}

        {activeViz === 'memory' && (
          <div className={styles.vizPanel} role="tabpanel" id="panel-memory">
            <ProjectMemoryTab
              memories={memories}
              memoryBreakdown={memoryBreakdown}
              onUpdateMemory={handleUpdateMemory}
              onDeleteMemory={handleDeleteMemory}
            />
          </div>
        )}
      </section>
    </div>
  );
}
