import { useMemo, type CSSProperties } from 'react';
import clsx from 'clsx';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { formatDuration } from '../../lib/utils.js';
import { setQueryParam } from '../../lib/router.js';
import styles from '../../views/OverviewView/OverviewView.module.css';
import { groupFilesByTeam } from '../live-data.js';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';

function LiveAgentsWidget({ liveAgents }: WidgetBodyProps) {
  if (liveAgents.length === 0) {
    return <SectionEmpty>No one working right now</SectionEmpty>;
  }

  return (
    <div className={styles.liveTable}>
      <div className={styles.liveTableHeader}>
        <span>Member</span>
        <span aria-hidden="true" />
        <span>Tool</span>
        <span>Project</span>
        <span className={styles.liveTableHeaderNum}>Files</span>
        <span className={styles.liveTableHeaderNum}>Session</span>
        <span aria-hidden="true" />
      </div>
      <div className={styles.liveTableBody}>
        {liveAgents.map((a, i) => {
          const meta = getToolMeta(a.host_tool);
          const sessionLabel =
            a.session_minutes != null && a.session_minutes > 0
              ? formatDuration(a.session_minutes)
              : '—';
          return (
            <button
              key={a.agent_id}
              type="button"
              className={styles.liveTableRow}
              style={{ '--row-index': i } as CSSProperties}
              onClick={() => setQueryParam('live', a.agent_id)}
            >
              <span className={styles.liveAgentName} style={{ color: meta.color }}>
                {a.handle}
              </span>
              <span aria-hidden="true" />
              <span className={styles.liveCell}>{meta.label}</span>
              <span className={styles.liveCell} title={a.teamName}>
                {a.teamName || '—'}
              </span>
              <span
                className={clsx(styles.liveCellNum, a.files.length === 0 && styles.liveCellMuted)}
              >
                {a.files.length}
              </span>
              <span
                className={clsx(styles.liveCellNum, sessionLabel === '—' && styles.liveCellMuted)}
              >
                {sessionLabel}
              </span>
              <span className={styles.liveViewButton}>View</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LiveConflictsWidget({ liveAgents }: WidgetBodyProps) {
  const conflicts = useMemo(
    () => groupFilesByTeam(liveAgents).filter((g) => g.agents.length > 1),
    [liveAgents],
  );

  if (conflicts.length === 0) {
    return <SectionEmpty>No collisions right now</SectionEmpty>;
  }

  return (
    <div className={styles.dataList}>
      {conflicts.map((c, i) => (
        <div
          key={`${c.teamId}\u0000${c.file}`}
          className={styles.dataRow}
          style={{ '--row-index': i } as CSSProperties}
          title={c.file}
        >
          <span className={styles.dataName}>{c.file}</span>
          <div className={styles.dataMeta}>
            <span className={styles.dataStat}>
              <span className={styles.dataStatDanger}>{c.agents.length}</span> agents
            </span>
            <span className={styles.dataStat}>{c.agents.map((a) => a.handle).join(' · ')}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function FilesInPlayWidget({ liveAgents }: WidgetBodyProps) {
  const files = useMemo(
    () =>
      groupFilesByTeam(liveAgents)
        .sort((a, b) => b.agents.length - a.agents.length)
        .slice(0, 12),
    [liveAgents],
  );

  if (files.length === 0) {
    return <SectionEmpty>No active files</SectionEmpty>;
  }

  return (
    <div className={styles.dataList}>
      {files.map((f, i) => {
        const multi = f.agents.length > 1;
        const lead = f.agents[0];
        const extra = f.agents.length - 1;
        return (
          <div
            key={`${f.teamId}\u0000${f.file}`}
            className={styles.dataRow}
            style={{ '--row-index': i } as CSSProperties}
            title={f.file}
          >
            <span className={styles.dataName}>{f.file}</span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span className={clsx(multi ? styles.dataStatDanger : styles.dataStatValue)}>
                  {f.agents.length}
                </span>{' '}
                {multi ? 'agents' : 'agent'}
              </span>
              <span className={styles.dataStat}>
                {lead.handle}
                {extra > 0 ? ` +${extra}` : ''}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClaimedFilesWidget({ locks }: WidgetBodyProps) {
  const sorted = useMemo(
    () => [...locks].sort((a, b) => (b.minutes_held ?? 0) - (a.minutes_held ?? 0)),
    [locks],
  );

  if (sorted.length === 0) {
    return <SectionEmpty>No claimed files</SectionEmpty>;
  }

  return (
    <div className={styles.dataList}>
      {sorted.map((lock, i) => {
        const meta = getToolMeta(lock.host_tool ?? 'unknown');
        const minutes = lock.minutes_held ?? 0;
        return (
          <div
            key={`${lock.agent_id ?? lock.handle}\u0000${lock.file_path}`}
            className={styles.dataRow}
            style={{ '--row-index': i } as CSSProperties}
            title={lock.file_path}
          >
            <span className={styles.dataName}>{lock.file_path}</span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat} style={{ color: meta.color }}>
                {lock.handle}
              </span>
              <span className={styles.dataStat}>{formatDuration(minutes)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const liveWidgets: WidgetRegistry = {
  'live-agents': LiveAgentsWidget,
  'live-conflicts': LiveConflictsWidget,
  'files-in-play': FilesInPlayWidget,
  'claimed-files': ClaimedFilesWidget,
};
