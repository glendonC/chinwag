// Dedicated detail view for a single shared file.
// Shows the full edit history across every tool that has touched the
// file: a big timeline strip, a tool-share breakdown, and a per-edit log
// with outcome, duration, conflict, and lock information.
//
// Routing: opened via ?file=<path> from the PairDetail panel. Renders into
// the shared detailPanel slot in ToolsView alongside StackToolDetail and
// PairDetail.

import { type CSSProperties } from 'react';
import { getToolMeta, normalizeToolId } from '../../lib/toolMeta.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import BackLink from '../../components/BackLink/BackLink.js';
import SectionTitle from '../../components/SectionTitle/SectionTitle.js';
import { PREVIEW_SHARED_FILES, type FileEditEvent } from './previewData.js';
import styles from './SharedFileDetail.module.css';

interface Props {
  filePath: string;
  onBack: () => void;
}

export default function SharedFileDetail({ filePath, onBack }: Props) {
  const file = PREVIEW_SHARED_FILES.find((f) => f.filePath === filePath) ?? null;

  if (!file) {
    return (
      <div className={styles.detail}>
        <BackLink label="Tools" onClick={onBack} />
        <div className={styles.notFound}>
          That file isn&apos;t in the current handoff view. The link may be stale — try going back
          to the Tools tab.
        </div>
      </div>
    );
  }

  const fileName = file.filePath.split('/').pop() ?? file.filePath;
  const parentPath = file.filePath.slice(0, file.filePath.length - fileName.length - 1);

  const timestamps = file.edits.map((e) => new Date(e.timestamp).getTime());
  const spanFrom = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const spanTo = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  const spanMs = Math.max(spanTo - spanFrom, 1);

  const toolStats = buildToolStats(file.edits);

  // One plain-English context line in place of a stat grid — per the
  // design spec, file-grained aggregate metrics (completion %, conflict
  // count) would dress inference up as fact when the underlying signals
  // are SOFT. The edit log IS the content.
  const contextLine = `${file.edits.length} edit${
    file.edits.length === 1 ? '' : 's'
  } · ${toolStats.length} tool${toolStats.length === 1 ? '' : 's'} · ${formatDate(spanFrom)}–${formatDate(spanTo)}`;

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <BackLink label="Tools" onClick={onBack} />
        <div className={styles.titleBlock}>
          <span className={styles.parentPath}>{parentPath}/</span>
          <h1 className={styles.title}>{fileName}</h1>
          <div className={styles.titleMeta}>
            <span className={styles.projectLabel}>{file.projectLabel}</span>
            <span className={styles.contextLine}>{contextLine}</span>
          </div>
        </div>
      </header>

      <section className={styles.section}>
        <SectionTitle>Edit timeline</SectionTitle>
        <div className={styles.bigStream}>
          <div className={styles.bigStreamTrack}>
            {file.edits.map((edit, i) => {
              const meta = getToolMeta(edit.tool);
              const t = new Date(edit.timestamp).getTime();
              const leftPct = ((t - spanFrom) / spanMs) * 100;
              const dimmed = edit.outcome !== 'completed';
              return (
                <span
                  key={`${edit.sessionId}-${i}`}
                  className={`${styles.bigPill} ${dimmed ? styles.bigPillDim : ''}`}
                  style={{ left: `${leftPct}%`, background: meta.color }}
                  title={buildTooltip(edit)}
                >
                  {edit.hadConflict && (
                    <span className={styles.pillMark} aria-hidden="true">
                      !
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
        <div className={styles.axis}>
          <span>{formatDate(spanFrom)}</span>
          <span>{formatDate(spanTo)}</span>
        </div>
      </section>

      <section className={styles.section}>
        <SectionTitle>Tools that touch this file</SectionTitle>
        <ul className={styles.toolList}>
          {toolStats.map((t) => {
            const meta = getToolMeta(t.tool);
            const sharePct = Math.round((t.count / file.edits.length) * 100);
            return (
              <li key={t.tool} className={styles.toolRow}>
                <ToolIcon tool={t.tool} size={18} />
                <span className={styles.toolName}>{meta.label}</span>
                <div className={styles.toolBarTrack}>
                  <div
                    className={styles.toolBarFill}
                    style={{ width: `${sharePct}%`, background: meta.color }}
                  />
                </div>
                <span className={styles.toolCount}>
                  {t.count} edit{t.count === 1 ? '' : 's'}
                </span>
                <span className={styles.toolLines}>
                  +{t.linesAdded} / −{t.linesRemoved}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={styles.section}>
        <SectionTitle>Every edit, in order</SectionTitle>
        <ul className={styles.editList}>
          {file.edits.map((edit, i) => {
            const meta = getToolMeta(edit.tool);
            return (
              <li
                key={`${edit.sessionId}-${i}`}
                className={styles.editRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <div className={styles.editMarker} style={{ background: meta.color }} />
                <div className={styles.editBody}>
                  <div className={styles.editTopLine}>
                    <span className={styles.editToolName}>{meta.label}</span>
                    <span className={styles.editHandle}>{edit.handle}</span>
                    <span className={styles.editTime}>{formatDateTime(edit.timestamp)}</span>
                    <span className={`${styles.editOutcome} ${styles[`outcome_${edit.outcome}`]}`}>
                      {edit.outcome}
                    </span>
                  </div>
                  <div className={styles.editSummary}>{edit.summary}</div>
                  <div className={styles.editMeta}>
                    <span>
                      +{edit.linesAdded} / −{edit.linesRemoved}
                    </span>
                    <span className={styles.metaDot}>·</span>
                    <span>{edit.sessionMinutes} min session</span>
                    {edit.hadConflict && (
                      <>
                        <span className={styles.metaDot}>·</span>
                        <span className={styles.editConflict}>conflict</span>
                      </>
                    )}
                    {edit.lockContested && (
                      <>
                        <span className={styles.metaDot}>·</span>
                        <span className={styles.editConflict}>lock contested</span>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

interface ToolRollup {
  tool: string;
  count: number;
  linesAdded: number;
  linesRemoved: number;
}

function buildToolStats(edits: FileEditEvent[]): ToolRollup[] {
  const byTool = new Map<string, ToolRollup>();
  for (const edit of edits) {
    const key = normalizeToolId(edit.tool);
    const existing = byTool.get(key) ?? {
      tool: edit.tool,
      count: 0,
      linesAdded: 0,
      linesRemoved: 0,
    };
    existing.count++;
    existing.linesAdded += edit.linesAdded;
    existing.linesRemoved += edit.linesRemoved;
    byTool.set(key, existing);
  }
  return [...byTool.values()].sort((a, b) => b.count - a.count);
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildTooltip(edit: FileEditEvent): string {
  const meta = getToolMeta(edit.tool);
  const when = formatDateTime(edit.timestamp);
  const outcomeLabel = edit.outcome.charAt(0).toUpperCase() + edit.outcome.slice(1);
  const conflictNote = edit.hadConflict ? ' · conflict' : '';
  return `${meta.label} · ${when} · ${outcomeLabel}${conflictNote}\n${edit.summary}`;
}
