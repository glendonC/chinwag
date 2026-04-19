import { useMemo, type CSSProperties } from 'react';
import clsx from 'clsx';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import SectionOverflow from '../../components/SectionOverflow/SectionOverflow.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { formatDuration } from '../../lib/utils.js';
import { setQueryParam } from '../../lib/router.js';
import shared from '../widget-shared.module.css';
import styles from './LiveWidgets.module.css';
import { groupFilesByTeam } from '../live-data.js';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';

// Simultaneous-visibility cap per the 04-19 audit: cap-at-3 hid 70% of a
// 10-agent team behind a "+N more" link, which defeated the cockpit thesis
// (cross-tool presence at a glance). 8 matches the 2026-04-13 worked-
// example threshold where horizontal overflow was first surfaced; beyond
// that the SectionOverflow link is the honest fallback. Widget body scrolls
// if the cap exceeds the current rowSpan height.
const LIVE_AGENTS_CAP = 8;

function LiveAgentsWidget({ liveAgents }: WidgetBodyProps) {
  if (liveAgents.length === 0) {
    return <SectionEmpty>No one working right now</SectionEmpty>;
  }

  const visible = liveAgents.slice(0, LIVE_AGENTS_CAP);
  const overflow = liveAgents.length - visible.length;

  return (
    <div className={styles.liveTable}>
      <div className={styles.liveTableHeader}>
        <span>Member</span>
        <span>Tool</span>
        <span>Project</span>
        <span aria-hidden="true" />
      </div>
      <div className={styles.liveTableBody}>
        {visible.map((a, i) => {
          const meta = getToolMeta(a.host_tool);
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
              <span className={clsx(styles.liveCell, styles.liveCellTool)}>
                <ToolIcon tool={a.host_tool} size={16} />
                <span>{meta.label}</span>
              </span>
              <span className={styles.liveCell} title={a.teamName}>
                {a.teamName || '—'}
              </span>
              <span className={styles.liveViewButton}>View</span>
            </button>
          );
        })}
      </div>
      <div className={styles.liveTableOverflow}>
        <SectionOverflow
          count={overflow}
          label={overflow === 1 ? 'agent' : 'agents'}
          onClick={() => setQueryParam('live', '')}
        />
      </div>
    </div>
  );
}

function LiveConflictsWidget({ liveAgents, locks }: WidgetBodyProps) {
  const conflicts = useMemo(
    () => groupFilesByTeam(liveAgents).filter((g) => g.agents.length > 1),
    [liveAgents],
  );
  // Cross-reference claim state via a pill (per 04-19 audit). The two data
  // sources stay separate — a claim is intent, an active edit is action —
  // but when a file appears in both we surface it so the conflict row
  // signals "claim-backed collision," which escalates review priority.
  const claimedFiles = useMemo(() => new Set(locks.map((l) => l.file_path)), [locks]);

  if (conflicts.length === 0) {
    return <SectionEmpty>No collisions right now</SectionEmpty>;
  }

  return (
    <div className={shared.dataList}>
      {conflicts.map((c, i) => (
        <div
          key={`${c.teamId}\u0000${c.file}`}
          className={shared.dataRow}
          style={{ '--row-index': i } as CSSProperties}
          title={c.file}
        >
          <span className={shared.dataName}>{c.file}</span>
          <div className={shared.dataMeta}>
            {claimedFiles.has(c.file) && <span className={shared.statusPill}>claimed</span>}
            <span className={shared.dataStat}>
              <span className={shared.dataStatDanger}>{c.agents.length}</span> agents
            </span>
            <span className={shared.dataStat}>{c.agents.map((a) => a.handle).join(' · ')}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function FilesInPlayWidget({ liveAgents, locks }: WidgetBodyProps) {
  const files = useMemo(
    () =>
      groupFilesByTeam(liveAgents)
        .sort((a, b) => b.agents.length - a.agents.length)
        .slice(0, 12),
    [liveAgents],
  );
  const claimedFiles = useMemo(() => new Set(locks.map((l) => l.file_path)), [locks]);

  if (files.length === 0) {
    return <SectionEmpty>No active files</SectionEmpty>;
  }

  return (
    <div className={shared.dataList}>
      {files.map((f, i) => {
        const multi = f.agents.length > 1;
        const lead = f.agents[0];
        const extra = f.agents.length - 1;
        return (
          <div
            key={`${f.teamId}\u0000${f.file}`}
            className={shared.dataRow}
            style={{ '--row-index': i } as CSSProperties}
            title={f.file}
          >
            <span className={shared.dataName}>{f.file}</span>
            <div className={shared.dataMeta}>
              {claimedFiles.has(f.file) && <span className={shared.statusPill}>claimed</span>}
              <span className={shared.dataStat}>
                <span className={clsx(multi ? shared.dataStatDanger : shared.dataStatValue)}>
                  {f.agents.length}
                </span>{' '}
                {multi ? 'agents' : 'agent'}
              </span>
              <span className={shared.dataStat}>
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
    <div className={shared.dataList}>
      {sorted.map((lock, i) => {
        const meta = getToolMeta(lock.host_tool ?? 'unknown');
        const minutes = lock.minutes_held ?? 0;
        return (
          <div
            key={`${lock.agent_id ?? lock.handle}\u0000${lock.file_path}`}
            className={shared.dataRow}
            style={{ '--row-index': i } as CSSProperties}
            title={lock.file_path}
          >
            <span className={shared.dataName}>{lock.file_path}</span>
            <div className={shared.dataMeta}>
              <span className={shared.dataStat} style={{ color: meta.color }}>
                {lock.handle}
              </span>
              <span className={shared.dataStat}>{formatDuration(minutes)}</span>
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
