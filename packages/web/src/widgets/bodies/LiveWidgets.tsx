import { useMemo, type CSSProperties } from 'react';
import clsx from 'clsx';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import SectionOverflow from '../../components/SectionOverflow/SectionOverflow.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { formatDuration } from '../../lib/utils.js';
import { setQueryParam, setQueryParams } from '../../lib/router.js';
import shared from '../widget-shared.module.css';
import styles from './LiveWidgets.module.css';
import { groupFilesByTeam, type FileGroup } from '../live-data.js';
import type { LiveAgent } from '../types.js';
import type { Lock } from '../../lib/schemas/common.js';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { FilePath } from './shared.js';

// Simultaneous-visibility cap per the 04-19 audit: cap-at-3 hid 70% of a
// 10-agent team behind a "+N more" link, which defeated the cockpit thesis
// (cross-tool presence at a glance). 8 matches the 2026-04-13 worked-
// example threshold where horizontal overflow was first surfaced; beyond
// that the SectionOverflow link is the honest fallback. Widget body scrolls
// if the cap exceeds the current rowSpan height.
const LIVE_AGENTS_CAP = 8;

// files-in-play is preemptive coordination ("don't touch what's in flight"),
// so the cap trades list length for glanceability. 12 rows covers the Activity
// tab's 12-col full-width rendering at rowSpan 3 without scroll; beyond that
// the SectionOverflow link is the honest fallback. Silent truncation of the
// 13th most-contested file would hide the exact signal the widget exists for.
const ACTIVE_FILES_CAP = 12;

// Max tool-colored handles rendered inline in the Editors column before the
// row overflows into `+N`. Three keeps the cell narrow enough that 2-way
// rows sit beside 6-way rows without the column ballooning.
const EDITOR_CAP = 3;

// Seconds past which an editor's handle fades in the Editors cell. The
// active-member heartbeat window is 60s; halfway through it (30s) an agent
// is still present but visibly cooling off, which is itself a coordination
// signal — a conflict where one party is idle reads differently from one
// where both are actively typing.
const STALE_AFTER_SECONDS = 30;

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
        <span className={styles.liveTableHeaderNum}>Session</span>
        <span aria-hidden="true" />
      </div>
      <div className={styles.liveTableBody}>
        {visible.map((a, i) => {
          const meta = getToolMeta(a.host_tool);
          const sessionLabel = formatDuration(a.session_minutes);
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
              <span
                className={clsx(styles.liveCell, styles.liveCellNum)}
                title={`Session ${sessionLabel}`}
              >
                {sessionLabel}
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

// Sort editors longest-session-first so the first-mover renders at the
// left of the row. Handle tie-break keeps the order stable between polls
// when two editors share a session_minutes value.
function sortEditors(agents: LiveAgent[]): LiveAgent[] {
  return [...agents].sort((a, b) => {
    const am = a.session_minutes ?? 0;
    const bm = b.session_minutes ?? 0;
    if (bm !== am) return bm - am;
    return a.handle.localeCompare(b.handle);
  });
}

// Severity weight: 2 editors → baseline (400), 3 → 500, 4+ → 600. Hierarchy
// through Manrope weight alone so a glance at the column tells the reader
// which rows are the worst offenders.
function editorWeight(count: number): number {
  if (count >= 4) return 600;
  if (count === 3) return 500;
  return 400;
}

interface FileRowProps {
  group: FileGroup;
  lock: Lock | undefined;
  index: number;
  onClick: () => void;
}

// Shared row for live-conflicts and files-in-play. Four-column subgrid:
//   File      — filename (Manrope 500) + immediate parent dir (mono soft).
//               Parent is always rendered when present.
//   Status    — `claimed` / `unclaimed` / `mismatch @handle`. State word,
//               not a person; the handle only appears on mismatch because
//               that's the one case where the claim holder isn't already
//               visible in Editors.
//   Duration  — how long the claim has been held; `—` when no claim.
//               The claim's age (not the conflict's) — stale claims are
//               the coordination signal.
//   Editors   — up to 3 tool-colored handles + `+N` overflow. Cell font-
//               weight scales with editor count for at-a-glance severity.
function FileRow({ group, lock, index, onClick }: FileRowProps) {
  const editors = sortEditors(group.agents);
  const visibleEditors = editors.slice(0, EDITOR_CAP);
  const extra = editors.length - visibleEditors.length;

  const editorHandles = new Set(editors.map((a) => a.handle));
  const isMismatch = lock != null && !!lock.handle && !editorHandles.has(lock.handle);

  // Solo + unclaimed = no coordination signal to surface. Rendering
  // "unclaimed" on every single-editor row is chart-junk; the word only
  // carries meaning when 2+ editors are present. Em-dash keeps the column
  // aligned without adding noise.
  const statusIsNone = lock == null && editors.length <= 1;

  return (
    <button
      type="button"
      className={styles.conflictTableRow}
      style={{ '--row-index': index } as CSSProperties}
      onClick={onClick}
    >
      <FilePath path={group.file} order="name-first" />

      <span className={styles.conflictStatusCell}>
        {statusIsNone ? (
          <span className={styles.conflictStatusNone}>—</span>
        ) : lock == null ? (
          <span className={styles.conflictStatusUnclaimed}>unclaimed</span>
        ) : isMismatch ? (
          <span className={styles.conflictStatusMismatch}>mismatch</span>
        ) : (
          <span className={styles.conflictStatusClaimed}>claimed</span>
        )}
      </span>
      <span className={styles.conflictDurationCell}>
        {lock && lock.minutes_held != null ? (
          <span className={styles.conflictDurationValue}>{formatDuration(lock.minutes_held)}</span>
        ) : (
          <span className={styles.conflictDurationNone}>—</span>
        )}
      </span>
      <span
        className={styles.conflictEditorsCell}
        style={{ fontWeight: editorWeight(editors.length) }}
      >
        {visibleEditors.map((a) => {
          const meta = getToolMeta(a.host_tool);
          // Fade editors whose heartbeat is cooling. `seconds_since_update`
          // null means the heartbeat hasn't been measured yet — default to
          // not-stale rather than fade on unknown data.
          const isStale = (a.seconds_since_update ?? 0) > STALE_AFTER_SECONDS;
          return (
            <span
              key={a.agent_id}
              className={clsx(
                styles.conflictEditorHandle,
                isStale && styles.conflictEditorHandleStale,
              )}
              style={{ color: meta.color }}
            >
              {a.handle}
            </span>
          );
        })}
        {extra > 0 && <span className={styles.conflictEditorsOverflow}>+{extra}</span>}
      </span>
    </button>
  );
}

function LiveConflictsWidget({ liveAgents, locks }: WidgetBodyProps) {
  const conflicts = useMemo(
    () => groupFilesByTeam(liveAgents).filter((g) => g.agents.length > 1),
    [liveAgents],
  );
  const locksByFile = useMemo(() => {
    const map = new Map<string, (typeof locks)[number]>();
    for (const l of locks) map.set(l.file_path, l);
    return map;
  }, [locks]);

  if (conflicts.length === 0) {
    return (
      <SectionEmpty>
        {liveAgents.length === 0 ? 'No agents active right now' : 'No collisions right now'}
      </SectionEmpty>
    );
  }

  return (
    <div className={styles.conflictTable}>
      <div className={styles.conflictTableHeader}>
        <span>File</span>
        <span>Status</span>
        <span className={styles.conflictDurationHeader}>Duration</span>
        <span>Editors</span>
      </div>
      <div className={styles.conflictTableBody}>
        {conflicts.map((c, i) => (
          <FileRow
            key={`${c.teamId}\u0000${c.file}`}
            group={c}
            lock={locksByFile.get(c.file)}
            index={i}
            onClick={() => setQueryParams({ live: '', 'live-tab': 'conflicts' })}
          />
        ))}
      </div>
    </div>
  );
}

function FilesInPlayWidget({ liveAgents, locks }: WidgetBodyProps) {
  const allFiles = useMemo(
    () =>
      // Tie-break by file path so the visible order is deterministic between
      // polls when multiple files share the same agent count — otherwise the
      // 5-10s poll rerender flickers the list.
      groupFilesByTeam(liveAgents).sort((a, b) => {
        if (b.agents.length !== a.agents.length) return b.agents.length - a.agents.length;
        return a.file.localeCompare(b.file);
      }),
    [liveAgents],
  );
  const visible = allFiles.slice(0, ACTIVE_FILES_CAP);
  const overflow = allFiles.length - visible.length;
  const locksByFile = useMemo(() => {
    const map = new Map<string, (typeof locks)[number]>();
    for (const l of locks) map.set(l.file_path, l);
    return map;
  }, [locks]);

  if (visible.length === 0) {
    return (
      <SectionEmpty>
        {liveAgents.length === 0 ? 'No agents active right now' : 'No files being edited'}
      </SectionEmpty>
    );
  }

  return (
    <div className={styles.conflictTable}>
      <div className={styles.conflictTableHeader}>
        <span>File</span>
        <span>Status</span>
        <span className={styles.conflictDurationHeader}>Duration</span>
        <span>Editors</span>
      </div>
      <div className={styles.conflictTableBody}>
        {visible.map((f, i) => (
          <FileRow
            key={`${f.teamId}\u0000${f.file}`}
            group={f}
            lock={locksByFile.get(f.file)}
            index={i}
            onClick={() => setQueryParams({ live: '', 'live-tab': 'files' })}
          />
        ))}
      </div>
      {overflow > 0 && (
        <div className={styles.conflictTableOverflow}>
          <SectionOverflow
            count={overflow}
            label={overflow === 1 ? 'file' : 'files'}
            onClick={() => setQueryParams({ live: '', 'live-tab': 'files' })}
          />
        </div>
      )}
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
          >
            <FilePath path={lock.file_path} order="name-first" />
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

// Export for reuse in the LiveNowView drill-in, which renders the same
// File | Status | Duration | Editors rows at higher-density on a wider
// surface. Keeping both surfaces on the same component means the widget
// and the drill-in can't drift out of visual sync.
export { FileRow };

export const liveWidgets: WidgetRegistry = {
  'live-agents': LiveAgentsWidget,
  'live-conflicts': LiveConflictsWidget,
  'files-in-play': FilesInPlayWidget,
  'claimed-files': ClaimedFilesWidget,
};
