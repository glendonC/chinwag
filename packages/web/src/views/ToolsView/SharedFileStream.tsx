// Shared files — the cross-tool coordination view at file grain.
// Every file that more than one tool has touched, rendered as a
// left-to-right edit timeline. Reading a row left-to-right reveals the
// actual handoff sequence — the one unique thing chinwag can show that
// no single-vendor analytics product can.
//
// Deliberate cuts per the design spec:
//   - No headline stat row. Tool-pair signals are SOFT at best; any
//     aggregated metric would dress inference up as fact.
//   - No filter chips in v1. Research on Linear / Sentry / Vercel shows
//     combined filter/legend controls confuse users. A non-interactive
//     color legend is shipped instead. A separate labeled filter control
//     can come in v2.
//   - Whole row is the click target with a hover-only chevron. No "View"
//     pill — industry convergence (Linear, Vercel, Figma, Sentry) is
//     row-as-button with a hover affordance.

import { type CSSProperties } from 'react';
import { getToolMeta, normalizeToolId } from '../../lib/toolMeta.js';
import { PREVIEW_SHARED_FILES, type SharedFile, type FileEditEvent } from './previewData.js';
import styles from './SharedFileStream.module.css';

interface Props {
  files?: SharedFile[];
  onFileClick?: (filePath: string) => void;
}

interface FileStats {
  file: SharedFile;
  toolCount: number;
  span: { from: number; to: number };
  editCount: number;
}

function computeFileStats(file: SharedFile): FileStats {
  const toolSet = new Set(file.edits.map((e) => normalizeToolId(e.tool)));
  const timestamps = file.edits.map((e) => new Date(e.timestamp).getTime());
  return {
    file,
    toolCount: toolSet.size,
    span: {
      from: timestamps.length > 0 ? Math.min(...timestamps) : 0,
      to: timestamps.length > 0 ? Math.max(...timestamps) : 0,
    },
    editCount: file.edits.length,
  };
}

function compareByOverlap(a: FileStats, b: FileStats): number {
  if (a.toolCount !== b.toolCount) return b.toolCount - a.toolCount;
  return b.editCount - a.editCount;
}

function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function buildTooltip(edit: FileEditEvent): string {
  const meta = getToolMeta(edit.tool);
  const when = new Date(edit.timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const outcomeLabel = edit.outcome.charAt(0).toUpperCase() + edit.outcome.slice(1);
  return `${meta.label} · ${edit.handle} · ${when}\n${edit.summary}\n${outcomeLabel}`;
}

export default function SharedFileStream({ files, onFileClick }: Props) {
  const liveHasData = files && files.length > 0;
  const source: SharedFile[] = liveHasData ? files : PREVIEW_SHARED_FILES;
  const isPreview = !liveHasData;

  // Every tool that appears in any file, sorted alphabetically — the
  // non-interactive color legend that tells the reader what the timeline
  // dots represent. The legend is also the implicit filter for which
  // files qualify as "shared": any file whose tool set contains at least
  // two distinct tools.
  const allTools = new Set<string>();
  for (const f of source) for (const e of f.edits) allTools.add(normalizeToolId(e.tool));
  const legendTools = [...allTools].sort();

  // Drop files that only involve a single tool — they aren't "shared"
  // under this section's definition. Then sort by tool count desc, edits desc.
  const rows = source
    .map(computeFileStats)
    .filter((r) => r.toolCount >= 2)
    .sort(compareByOverlap);

  // Overall date range across the visible rows, for the context line.
  const allStartTs = rows.length > 0 ? Math.min(...rows.map((r) => r.span.from)) : 0;
  const allEndTs = rows.length > 0 ? Math.max(...rows.map((r) => r.span.to)) : 0;

  const isSolo = legendTools.length < 2;
  const soloToolLabel = isSolo && legendTools[0] ? getToolMeta(legendTools[0]).label : null;

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div className={styles.eyebrowRow}>
          <span className={styles.eyebrow}>Shared files</span>
          {isPreview && <span className={styles.previewBadge}>Preview</span>}
        </div>
        <h2 className={styles.title}>Files touched by more than one tool</h2>
        {!isSolo && rows.length > 0 && (
          <p className={styles.contextLine}>
            {rows.length} file{rows.length === 1 ? '' : 's'} · {formatShortDate(allStartTs)}–
            {formatShortDate(allEndTs)}
          </p>
        )}
      </header>

      {isSolo ? (
        <p className={styles.soloCopy}>
          Overlap lights up once a second tool reports sessions. You&apos;re running{' '}
          {soloToolLabel ?? 'one tool'} alone for now.
        </p>
      ) : (
        <>
          {/* Non-interactive color legend. Tells the reader what each
              dot in the timeline represents. Deliberately not a filter
              control — research shows combined legend+filter confuses
              users. A labeled filter can ship in v2. */}
          <div className={styles.legend} aria-label="Tool color legend">
            {legendTools.map((tool) => {
              const meta = getToolMeta(tool);
              return (
                <span key={tool} className={styles.legendItem}>
                  <span
                    className={styles.legendDot}
                    style={{ background: meta.color }}
                    aria-hidden="true"
                  />
                  <span className={styles.legendLabel}>{meta.label}</span>
                </span>
              );
            })}
          </div>

          {rows.length === 0 ? (
            <p className={styles.empty}>
              No files have been touched by more than one tool yet. Connect another tool or widen
              the time range to see overlap.
            </p>
          ) : (
            <ul className={styles.fileList}>
              {rows.map((row, rowIndex) => (
                <FileRow
                  key={row.file.filePath}
                  stats={row}
                  rowIndex={rowIndex}
                  onClick={() => onFileClick?.(row.file.filePath)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function FileRow({
  stats,
  rowIndex,
  onClick,
}: {
  stats: FileStats;
  rowIndex: number;
  onClick: () => void;
}) {
  const { file, span, editCount } = stats;
  const spanMs = Math.max(span.to - span.from, 1);
  const fileName = file.filePath.split('/').pop() ?? file.filePath;
  const parentPath = file.filePath.slice(0, file.filePath.length - fileName.length - 1);

  return (
    <li className={styles.fileRow} style={{ '--row-index': rowIndex } as CSSProperties}>
      <button type="button" className={styles.fileButton} onClick={onClick}>
        <div className={styles.fileHeadline}>
          <span className={styles.fileName}>{fileName}</span>
          <span className={styles.fileProject}>{file.projectLabel}</span>
          <span className={styles.chevron} aria-hidden="true">
            ›
          </span>
        </div>
        <div className={styles.fileMeta}>
          <span className={styles.fileParent}>{parentPath}</span>
          <span className={styles.metaDot} aria-hidden="true">
            ·
          </span>
          <span>
            {editCount} edit{editCount === 1 ? '' : 's'}
          </span>
          <span className={styles.metaDot} aria-hidden="true">
            ·
          </span>
          <span>last {formatShortDate(span.to)}</span>
        </div>

        <div className={styles.stream}>
          <div className={styles.streamTrack}>
            {file.edits.map((edit, i) => {
              const meta = getToolMeta(edit.tool);
              const t = new Date(edit.timestamp).getTime();
              const leftPct = ((t - span.from) / spanMs) * 100;
              const dimmed = edit.outcome !== 'completed';
              return (
                <span
                  key={`${edit.sessionId}-${i}`}
                  className={`${styles.pill} ${dimmed ? styles.pillDim : ''}`}
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
      </button>
    </li>
  );
}
