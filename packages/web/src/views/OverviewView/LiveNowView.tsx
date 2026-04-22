import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import clsx from 'clsx';
import { getToolMeta } from '../../lib/toolMeta.js';
import { formatDuration } from '../../lib/utils.js';
import { DetailView, type DetailTabDef } from '../../components/DetailView/index.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.js';
import { useTabs } from '../../hooks/useTabs.js';
import type { LiveAgent } from '../../widgets/types.js';
import { groupFilesByTeam } from '../../widgets/live-data.js';
import type { Lock } from '../../lib/apiSchemas.js';
import { FileRow } from '../../widgets/bodies/LiveWidgets.js';
import widgetStyles from '../../widgets/bodies/LiveWidgets.module.css';
import { formatScope } from './overview-utils.js';
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

  const tabControl = useTabs(LIVE_TABS, resolvedInitialTab);
  const { activeTab } = tabControl;

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
      <DetailView
        backLabel="Overview"
        onBack={onBack}
        title="live"
        subtitle="No one working right now across your projects."
        tabs={[]}
        tabControl={tabControl}
        idPrefix="live"
        tablistLabel="Live sections"
      >
        <span />
      </DetailView>
    );
  }

  // One-line subtitle — shared formatScope keeps it in sync with Usage.
  const teamsRepresented = new Set(liveAgents.map((a) => a.teamId).filter(Boolean)).size;
  const liveSubtitle = formatScope([
    { count: totalAgents, singular: 'agent' },
    { count: totalConflicts, singular: 'conflict' },
    { count: totalFilesInPlay, singular: 'file in play', plural: 'files in play' },
    { count: teamsRepresented, singular: 'project' },
  ]);

  const tabs: Array<DetailTabDef<LiveTab>> = [
    {
      id: 'agents',
      label: 'Agents',
      value: totalAgents,
      ...(totalAgents > 0 ? { tone: 'accent' as const } : {}),
    },
    {
      id: 'conflicts',
      label: 'Conflicts',
      value: totalConflicts,
      ...(totalConflicts > 0 ? { tone: 'accent' as const } : {}),
    },
    {
      id: 'files',
      label: 'Files',
      value: totalFilesInPlay,
      ...(totalFilesInPlay > 0 ? { tone: 'accent' as const } : {}),
    },
  ];

  return (
    <DetailView
      backLabel="Overview"
      onBack={onBack}
      title="live"
      subtitle={liveSubtitle}
      tabs={tabs}
      tabControl={tabControl}
      idPrefix="live"
      tablistLabel="Live sections"
      panelCompact
    >
      <>
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
      </>
    </DetailView>
  );
}
