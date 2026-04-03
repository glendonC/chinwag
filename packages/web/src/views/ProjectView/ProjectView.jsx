import { useMemo, useState, useRef, useEffect } from 'react';
import { forceRefresh } from '../../lib/stores/polling.js';
import ActivityTimeline from '../../components/ActivityTimeline/ActivityTimeline.jsx';
import StatusState from '../../components/StatusState/StatusState.jsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import {
  ShimmerText,
  SkeletonStatGrid,
  SkeletonRows,
  SkeletonLine,
} from '../../components/Skeleton/Skeleton.jsx';
import KeyboardHint, { useKeyboardHint } from '../../components/KeyboardHint/KeyboardHint.jsx';
import ProjectLiveTab from './ProjectLiveTab.jsx';
import ProjectMemoryTab from './ProjectMemoryTab.jsx';
import ProjectSessionsTab from './ProjectSessionsTab.jsx';
import ProjectToolsTab from './ProjectToolsTab.jsx';
import useProjectStatus from './useProjectStatus.js';
import useProjectMembers from './useProjectMembers.js';
import useProjectSessions from './useProjectSessions.js';
import useProjectAnalytics from './useProjectAnalytics.js';
import useProjectMemories from './useProjectMemories.js';
import styles from './ProjectView.module.css';

export default function ProjectView() {
  const { activeTeam, projectLabel, pollError, lastSynced, isLoading, isUnavailable } =
    useProjectStatus();

  const { activeAgents, offlineAgents, sortedAgents, liveToolMix } = useProjectMembers();

  const {
    allSessions,
    sessions,
    filesTouched,
    filesTouchedCount,
    sessionEditCount,
    liveSessionCount,
  } = useProjectSessions();

  const {
    locks,
    usageEntries,
    conflicts,
    filesInPlay,
    toolSummaries,
    hostSummaries,
    surfaceSummaries,
    modelsSeen,
  } = useProjectAnalytics();

  const { memories, memoryBreakdown, handleUpdateMemory, handleDeleteMemory } =
    useProjectMemories();

  const [activeViz, setActiveViz] = useState('live');
  const hint = useKeyboardHint();

  const stats = [
    {
      id: 'live',
      label: 'Agents',
      value: activeAgents.length,
      tone: activeAgents.length > 0 ? 'accent' : '',
    },
    { id: 'memory', label: 'Memory', value: memories.length, tone: '' },
    { id: 'sessions', label: 'Edits / 24h', value: sessionEditCount, tone: '' },
    { id: 'tools', label: 'Tools', value: toolSummaries.length, tone: '' },
  ];
  const statIds = useMemo(() => stats.map((s) => s.id), [stats]);
  const statsRef = useRef(null);
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      e.preventDefault();
      setActiveViz((prev) => {
        const cur = statIds.indexOf(prev);
        const next =
          e.key === 'ArrowRight'
            ? statIds[(cur + 1) % statIds.length]
            : statIds[(cur - 1 + statIds.length) % statIds.length];
        statsRef.current?.querySelector(`[data-tab="${next}"]`)?.focus();
        return next;
      });
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [statIds]);

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

  return (
    <div className={styles.page}>
      <ViewHeader eyebrow="Project" title={activeTeam?.team_name || 'Project'} />

      {conflicts.length > 0 && (
        <button
          type="button"
          className={styles.conflictBanner}
          onClick={() => setActiveViz('live')}
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
              className={`${styles.statButton} ${activeViz === s.id ? styles.statActive : ''}`}
              style={{ '--stat-index': i }}
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

      <section className={styles.activitySection}>
        <ActivityTimeline sessions={allSessions} liveCount={activeAgents.length} />
      </section>

      <section className={styles.vizArea}>
        {activeViz === 'live' && (
          <div className={styles.vizPanel} role="tabpanel" id="panel-live">
            <ProjectLiveTab
              sortedAgents={sortedAgents}
              offlineAgents={offlineAgents}
              conflicts={conflicts}
              filesInPlay={filesInPlay}
              locks={locks}
              liveToolMix={liveToolMix}
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

        {activeViz === 'sessions' && (
          <div className={styles.vizPanel} role="tabpanel" id="panel-sessions">
            <ProjectSessionsTab
              sessions={sessions}
              sessionEditCount={sessionEditCount}
              filesTouched={filesTouched}
              filesTouchedCount={filesTouchedCount}
              liveSessionCount={liveSessionCount}
            />
          </div>
        )}

        {activeViz === 'tools' && (
          <div className={styles.vizPanel} role="tabpanel" id="panel-tools">
            <ProjectToolsTab
              toolSummaries={toolSummaries}
              hostSummaries={hostSummaries}
              surfaceSummaries={surfaceSummaries}
              modelsSeen={modelsSeen}
              conflicts={conflicts}
              filesInPlay={filesInPlay}
              locks={locks}
              usageEntries={usageEntries}
            />
          </div>
        )}
      </section>
    </div>
  );
}
