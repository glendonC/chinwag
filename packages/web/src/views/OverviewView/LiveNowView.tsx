import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import clsx from 'clsx';
import { getToolMeta } from '../../lib/toolMeta.js';
import { formatDuration } from '../../lib/utils.js';
import BackLink from '../../components/BackLink/BackLink.js';
import SectionTitle from '../../components/SectionTitle/SectionTitle.js';
import type { LiveAgent } from '../../widgets/types.js';
import { groupFilesByTeam } from '../../widgets/live-data.js';
import styles from './LiveNowView.module.css';

interface Props {
  liveAgents: LiveAgent[];
  focusAgentId: string | null;
  onBack: () => void;
  onOpenProject: (teamId: string) => void;
  onOpenTools: () => void;
}

export default function LiveNowView({ liveAgents, focusAgentId, onBack, onOpenProject }: Props) {
  const focusRowRef = useRef<HTMLButtonElement>(null);

  const fileGroups = useMemo(() => groupFilesByTeam(liveAgents), [liveAgents]);

  const totalProjects = useMemo(() => {
    const seen = new Set<string>();
    for (const a of liveAgents) seen.add(a.teamId || '');
    return seen.size;
  }, [liveAgents]);

  const totalTools = useMemo(() => {
    const seen = new Set<string>();
    for (const a of liveAgents) seen.add(getToolMeta(a.host_tool).id);
    return seen.size;
  }, [liveAgents]);

  const conflicts = useMemo(
    () =>
      fileGroups
        .filter((g) => g.agents.length > 1)
        .sort((a, b) => b.agents.length - a.agents.length),
    [fileGroups],
  );

  const filesInPlay = useMemo(
    () => [...fileGroups].sort((a, b) => b.agents.length - a.agents.length).slice(0, 20),
    [fileGroups],
  );

  const totalFilesInPlay = fileGroups.length;
  const totalAgents = liveAgents.length;
  const totalConflicts = conflicts.length;

  // Auto-scroll the focused row into view when the view opens.
  useEffect(() => {
    if (!focusAgentId) return;
    const el = focusRowRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 260);
    return () => clearTimeout(t);
  }, [focusAgentId]);

  if (totalAgents === 0) {
    return (
      <div className={styles.detail}>
        <header className={styles.header}>
          <BackLink label="Overview" onClick={onBack} />
          <h1 className={styles.title}>live agents</h1>
          <span className={styles.subtitle}>No one working right now across your projects.</span>
        </header>
      </div>
    );
  }

  const subtitleParts = [
    `${totalAgents} ${totalAgents === 1 ? 'agent' : 'agents'}`,
    `${totalProjects} ${totalProjects === 1 ? 'project' : 'projects'}`,
    `${totalTools} ${totalTools === 1 ? 'tool' : 'tools'}`,
  ];
  if (totalConflicts > 0) {
    subtitleParts.push(`${totalConflicts} ${totalConflicts === 1 ? 'conflict' : 'conflicts'}`);
  }

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <BackLink label="Overview" onClick={onBack} />
        <h1 className={styles.title}>live agents</h1>
        <span className={styles.subtitle}>{subtitleParts.join(' · ')}</span>
      </header>

      <section className={styles.statGrid}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Agents</span>
          <span className={styles.statValue}>{totalAgents}</span>
          <span className={styles.statHint}>live sessions</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Projects</span>
          <span className={styles.statValue}>{totalProjects}</span>
          <span className={styles.statHint}>with agents</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Open files</span>
          <span className={styles.statValue}>{totalFilesInPlay}</span>
          <span className={styles.statHint}>in use</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Conflicts</span>
          <span className={clsx(styles.statValue, totalConflicts > 0 && styles.statValueDanger)}>
            {totalConflicts}
          </span>
          <span className={styles.statHint}>contested files</span>
        </div>
      </section>

      <section className={styles.section}>
        <SectionTitle>Active agents</SectionTitle>
        <div className={styles.agentsTable}>
          <div className={styles.agentsHeader}>
            <span>Member</span>
            <span>Tool</span>
            <span>Project</span>
            <span className={styles.numHeader}>Files</span>
            <span className={styles.numHeader}>Session</span>
            <span aria-hidden="true" />
          </div>
          {liveAgents.map((a, i) => {
            const meta = getToolMeta(a.host_tool);
            const sessionLabel =
              a.session_minutes != null && a.session_minutes > 0
                ? formatDuration(a.session_minutes)
                : '—';
            const isFocused = a.agent_id === focusAgentId;
            return (
              <button
                ref={isFocused ? focusRowRef : undefined}
                key={a.agent_id}
                type="button"
                className={clsx(styles.agentsRow, isFocused && styles.agentsRowFocused)}
                style={{ '--row-index': i } as CSSProperties}
                onClick={() => onOpenProject(a.teamId)}
              >
                <span className={styles.agentName} style={{ color: meta.color }}>
                  {a.handle}
                </span>
                <span className={styles.agentCell}>{meta.label}</span>
                <span className={styles.agentCell} title={a.teamName}>
                  {a.teamName || '—'}
                </span>
                <span
                  className={clsx(
                    styles.agentCellNum,
                    a.files.length === 0 && styles.agentCellMuted,
                  )}
                >
                  {a.files.length}
                </span>
                <span
                  className={clsx(
                    styles.agentCellNum,
                    sessionLabel === '—' && styles.agentCellMuted,
                  )}
                >
                  {sessionLabel}
                </span>
                <span className={styles.agentViewButton}>View</span>
              </button>
            );
          })}
        </div>
      </section>

      {conflicts.length > 0 && (
        <section className={styles.section}>
          <SectionTitle>Conflicts</SectionTitle>
          <ul className={styles.fileList}>
            {conflicts.map((c, i) => (
              <li
                key={`${c.teamId}\u0000${c.file}`}
                className={styles.fileRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span className={styles.fileName} title={c.file}>
                  {c.file}
                </span>
                <span className={styles.fileMeta}>
                  <span className={styles.fileCountDanger}>{c.agents.length}</span> agents ·{' '}
                  {c.agents.map((a) => a.handle).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {filesInPlay.length > 0 && (
        <section className={styles.section}>
          <SectionTitle>Open files</SectionTitle>
          <ul className={styles.fileList}>
            {filesInPlay.map((f, i) => {
              const multi = f.agents.length > 1;
              const lead = f.agents[0];
              const extra = f.agents.length - 1;
              return (
                <li
                  key={`${f.teamId}\u0000${f.file}`}
                  className={styles.fileRow}
                  style={{ '--row-index': i } as CSSProperties}
                >
                  <span className={styles.fileName} title={f.file}>
                    {f.file}
                  </span>
                  <span className={styles.fileMeta}>
                    <span className={clsx(multi ? styles.fileCountDanger : styles.fileCountValue)}>
                      {f.agents.length}
                    </span>{' '}
                    {multi ? 'agents' : 'agent'} · {lead.handle}
                    {extra > 0 ? ` +${extra}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
