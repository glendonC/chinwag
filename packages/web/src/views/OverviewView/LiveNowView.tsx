import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import clsx from 'clsx';
import { getToolMeta } from '../../lib/toolMeta.js';
import { formatDuration } from '../../lib/utils.js';
import BackLink from '../../components/BackLink/BackLink.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.js';
import KeyboardHint from '../../components/KeyboardHint/KeyboardHint.jsx';
import { useTabs } from '../../hooks/useTabs.js';
import type { LiveAgent } from '../../widgets/types.js';
import { groupFilesByTeam } from '../../widgets/live-data.js';
import type { Lock } from '../../lib/apiSchemas.js';
import { FileRow } from '../../widgets/bodies/LiveWidgets.js';
import widgetStyles from '../../widgets/bodies/LiveWidgets.module.css';
import styles from './LiveNowView.module.css';

const LIVE_TABS = ['agents', 'conflicts', 'files'] as const;
type LiveTab = (typeof LIVE_TABS)[number];

function isLiveTab(value: string | null | undefined): value is LiveTab {
  return value === 'agents' || value === 'conflicts' || value === 'files';
}

interface Props {
  liveAgents: LiveAgent[];
  locks: Lock[];
  focusAgentId: string | null;
  initialTab?: string | null;
  onBack: () => void;
  onOpenProject: (teamId: string) => void;
  onOpenTools: () => void;
}

export default function LiveNowView({
  liveAgents,
  locks,
  focusAgentId,
  initialTab,
  onBack,
  onOpenProject,
}: Props) {
  const focusRowRef = useRef<HTMLButtonElement>(null);

  const fileGroups = useMemo(() => groupFilesByTeam(liveAgents), [liveAgents]);

  // Look-up used by FileRow to compute Status (claimed / unclaimed /
  // mismatch) and Duration per file. Same data path the widget uses so
  // the drill-in reads identical claim state.
  const locksByFile = useMemo(() => {
    const map = new Map<string, Lock>();
    for (const l of locks) map.set(l.file_path, l);
    return map;
  }, [locks]);

  const conflicts = useMemo(
    () =>
      fileGroups
        .filter((g) => g.agents.length > 1)
        .sort((a, b) => b.agents.length - a.agents.length),
    [fileGroups],
  );

  const filesInPlay = useMemo(
    () =>
      [...fileGroups].sort((a, b) => {
        if (b.agents.length !== a.agents.length) return b.agents.length - a.agents.length;
        return a.file.localeCompare(b.file);
      }),
    [fileGroups],
  );

  const totalAgents = liveAgents.length;
  const totalConflicts = conflicts.length;
  const totalFilesInPlay = fileGroups.length;

  // Open on the tab the drill-in requested (conflicts/files rows carry it
  // via ?live-tab). Agent rows don't set the param, so they default to the
  // Agents tab — which is also where the focus scroll belongs.
  const resolvedInitialTab: LiveTab = isLiveTab(initialTab)
    ? initialTab
    : focusAgentId
      ? 'agents'
      : 'agents';

  const { activeTab, setActiveTab, hint, ref: statsRef } = useTabs(LIVE_TABS, resolvedInitialTab);

  // Auto-scroll the focused agent row into view when the view opens on the
  // agents tab. Gated on activeTab so switching to another tab doesn't
  // re-trigger the scroll jump.
  useEffect(() => {
    if (!focusAgentId || activeTab !== 'agents') return;
    const el = focusRowRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 260);
    return () => clearTimeout(t);
  }, [focusAgentId, activeTab]);

  if (totalAgents === 0) {
    return (
      <div className={styles.detail}>
        <header className={styles.header}>
          <BackLink label="Overview" onClick={onBack} />
          <h1 className={styles.title}>live</h1>
          <span className={styles.subtitle}>No one working right now across your projects.</span>
        </header>
      </div>
    );
  }

  const tabs: Array<{ id: LiveTab; label: string; value: string | number; tone: '' | 'accent' }> = [
    {
      id: 'agents',
      label: 'Agents',
      value: totalAgents,
      tone: totalAgents > 0 ? 'accent' : '',
    },
    {
      id: 'conflicts',
      label: 'Conflicts',
      value: totalConflicts,
      tone: totalConflicts > 0 ? 'accent' : '',
    },
    {
      id: 'files',
      label: 'Files',
      value: totalFilesInPlay,
      tone: totalFilesInPlay > 0 ? 'accent' : '',
    },
  ];

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <BackLink label="Overview" onClick={onBack} />
        <h1 className={styles.title}>live</h1>
      </header>

      <div className={styles.tabsRow} ref={statsRef} role="tablist" aria-label="Live sections">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            aria-controls={`live-panel-${t.id}`}
            data-tab={t.id}
            tabIndex={activeTab === t.id ? 0 : -1}
            className={clsx(styles.tabButton, activeTab === t.id && styles.tabActive)}
            style={{ '--tab-index': i } as CSSProperties}
            onClick={(e) => {
              e.currentTarget.focus();
              setActiveTab(t.id);
            }}
          >
            <span className={styles.tabLabel}>
              {t.label}
              {activeTab === t.id && <KeyboardHint {...hint} />}
            </span>
            <span className={clsx(styles.tabValue, t.tone === 'accent' && styles.tabAccent)}>
              {t.value}
            </span>
          </button>
        ))}
      </div>

      <div className={styles.panel} role="tabpanel" id={`live-panel-${activeTab}`}>
        {activeTab === 'agents' && (
          <div className={styles.agentsTable}>
            <div className={styles.agentsHeader}>
              <span>Member</span>
              <span>Tool</span>
              <span>Project</span>
              <span className={styles.numHeader}>Files</span>
              <span className={styles.numHeader}>Session</span>
              <span aria-hidden="true" />
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
                  className={styles.agentsRow}
                  style={{ '--row-index': i } as CSSProperties}
                  onClick={() => onOpenProject(a.teamId)}
                >
                  <span className={styles.agentName} style={{ color: meta.color }}>
                    {a.handle}
                  </span>
                  <span className={clsx(styles.agentCell, styles.agentCellTool)}>
                    <ToolIcon tool={a.host_tool} size={16} />
                    <span>{meta.label}</span>
                  </span>
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
                  <span aria-hidden="true" />
                  <span className={styles.agentViewButton}>View</span>
                </button>
              );
            })}
          </div>
        )}

        {activeTab === 'conflicts' && (
          <>
            {conflicts.length === 0 ? (
              <span className={styles.empty}>No collisions right now.</span>
            ) : (
              <div className={widgetStyles.conflictTable}>
                <div className={widgetStyles.conflictTableHeader}>
                  <span>File</span>
                  <span>Status</span>
                  <span className={widgetStyles.conflictDurationHeader}>Duration</span>
                  <span>Editors</span>
                </div>
                <div className={widgetStyles.conflictTableBody}>
                  {conflicts.map((c, i) => (
                    <FileRow
                      key={`${c.teamId}\u0000${c.file}`}
                      group={c}
                      lock={locksByFile.get(c.file)}
                      index={i}
                      onClick={() => onOpenProject(c.teamId)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'files' && (
          <>
            {filesInPlay.length === 0 ? (
              <span className={styles.empty}>No active files right now.</span>
            ) : (
              <div className={widgetStyles.conflictTable}>
                <div className={widgetStyles.conflictTableHeader}>
                  <span>File</span>
                  <span>Status</span>
                  <span className={widgetStyles.conflictDurationHeader}>Duration</span>
                  <span>Editors</span>
                </div>
                <div className={widgetStyles.conflictTableBody}>
                  {filesInPlay.map((f, i) => (
                    <FileRow
                      key={`${f.teamId}\u0000${f.file}`}
                      group={f}
                      lock={locksByFile.get(f.file)}
                      index={i}
                      onClick={() => onOpenProject(f.teamId)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
