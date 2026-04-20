// Pair Detail — the drill-in for a tool-pair handoff.
// Opened via ?pair=<from>:<to> from StackHandoffMatrix. Renders into the
// shared detailPanel slot in ToolsView alongside StackToolDetail and
// SharedFileDetail.
//
// Shows the list of files that handed off between this specific pair,
// capped at 20 visible with a progressive-disclosure "Show more" action.
// Clicking a file navigates to ?file= for the full per-file detail.

import { type CSSProperties, useMemo, useState } from 'react';
import clsx from 'clsx';
import { getToolMeta, normalizeToolId } from '../../lib/toolMeta.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import BackLink from '../../components/BackLink/BackLink.js';
import SectionTitle from '../../components/SectionTitle/SectionTitle.js';
import type { ToolHandoff, ToolHandoffRecentFile } from '../../lib/apiSchemas.js';
import { PREVIEW_TOOL_HANDOFFS } from './previewData.js';
import styles from './PairDetail.module.css';

interface Props {
  fromToolId: string;
  toToolId: string;
  handoffs: ToolHandoff[] | undefined;
  onBack: () => void;
  onFileClick: (filePath: string) => void;
}

const BATCH_SIZE = 20;

function formatGap(mins: number): string | null {
  if (!Number.isFinite(mins) || mins <= 0) return null;
  if (mins < 60) return `~${Math.round(mins)} min`;
  if (mins < 1440) return `~${Math.round(mins / 60)} h`;
  return `~${Math.round(mins / 1440)} d`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function splitPath(path: string): { name: string; parent: string } {
  const name = path.split('/').pop() ?? path;
  const parent = path.slice(0, path.length - name.length - 1);
  return { name, parent };
}

export default function PairDetail({ fromToolId, toToolId, handoffs, onBack, onFileClick }: Props) {
  const fromKey = normalizeToolId(fromToolId);
  const toKey = normalizeToolId(toToolId);
  const fromMeta = getToolMeta(fromToolId);
  const toMeta = getToolMeta(toToolId);

  const handoff = useMemo<ToolHandoff | null>(() => {
    const live = (handoffs ?? []).find(
      (h) => normalizeToolId(h.from_tool) === fromKey && normalizeToolId(h.to_tool) === toKey,
    );
    if (live) return live;
    const preview = PREVIEW_TOOL_HANDOFFS.find(
      (h) => normalizeToolId(h.from_tool) === fromKey && normalizeToolId(h.to_tool) === toKey,
    );
    return preview ?? null;
  }, [handoffs, fromKey, toKey]);

  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

  if (!handoff) {
    return (
      <div className={styles.detail}>
        <BackLink label="Tools" onClick={onBack} />
        <div className={styles.notFound}>
          No handoff data for {fromMeta.label} → {toMeta.label}. The link may be stale — try going
          back to the Tools tab and clicking another pair.
        </div>
      </div>
    );
  }

  const files = handoff.recent_files ?? [];
  const shownFiles = files.slice(0, visibleCount);
  const hiddenCount = Math.max(0, files.length - visibleCount);
  const gapLabel = formatGap(handoff.avg_gap_minutes);

  const completionRate = handoff.handoff_completion_rate;
  const isPreview = !(handoffs ?? []).some(
    (h) => normalizeToolId(h.from_tool) === fromKey && normalizeToolId(h.to_tool) === toKey,
  );

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <BackLink label="Tools" onClick={onBack} />
        <div className={styles.titleBlock}>
          <div className={styles.eyebrowRow}>
            <span className={styles.eyebrow}>Handoff pair</span>
            {isPreview && <span className={styles.previewBadge}>Preview</span>}
          </div>
          <div className={styles.pairRow}>
            <span className={styles.pairSide}>
              <ToolIcon tool={fromToolId} size={20} />
              <span>{fromMeta.label}</span>
            </span>
            <span className={styles.pairArrow} aria-hidden="true">
              →
            </span>
            <span className={styles.pairSide}>
              <ToolIcon tool={toToolId} size={20} />
              <span>{toMeta.label}</span>
            </span>
          </div>
          <h1 className={styles.title}>
            Files {fromMeta.label} handed off to {toMeta.label}
          </h1>
          <p className={styles.contextLine}>
            {handoff.file_count} file{handoff.file_count === 1 ? '' : 's'}
            {gapLabel ? ` · typical gap ${gapLabel}` : ''}
            {' · '}last 30 days
          </p>
          {completionRate > 0 && (
            <p className={styles.completionNote}>
              {toMeta.label}&apos;s sessions after picking up {fromMeta.label}&apos;s work completed{' '}
              {completionRate}% of the time. Downstream completion is a proxy, not a direct measure
              of whether the handoff itself succeeded.
            </p>
          )}
        </div>
      </header>

      <section className={styles.section}>
        <SectionTitle>Files in this handoff</SectionTitle>

        {files.length === 0 ? (
          <p className={styles.empty}>
            No file samples came back for this pair. The aggregate counts are intact, but the worker
            didn&apos;t return file-level detail for this window.
          </p>
        ) : (
          <>
            <ul className={styles.fileList}>
              {shownFiles.map((f, i) => (
                <FileRow
                  key={f.file_path}
                  file={f}
                  rowIndex={i}
                  onClick={() => onFileClick(f.file_path)}
                />
              ))}
            </ul>
            {hiddenCount > 0 && (
              <button
                type="button"
                className={styles.showMore}
                onClick={() => setVisibleCount((n) => n + BATCH_SIZE)}
              >
                Show {Math.min(BATCH_SIZE, hiddenCount)} more
                <span className={styles.showMoreRest}>({hiddenCount} remaining)</span>
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function FileRow({
  file,
  rowIndex,
  onClick,
}: {
  file: ToolHandoffRecentFile;
  rowIndex: number;
  onClick: () => void;
}) {
  const { name, parent } = splitPath(file.file_path);
  return (
    <li className={styles.fileRow} style={{ '--row-index': rowIndex } as CSSProperties}>
      <button type="button" className={styles.fileButton} onClick={onClick}>
        <div className={styles.fileHeadline}>
          <span className={styles.fileName}>{name}</span>
          <span className={clsx(styles.fileStatus, file.completed && styles.fileStatusCompleted)}>
            {file.completed ? 'completed' : 'open'}
          </span>
          <span className={styles.chevron} aria-hidden="true">
            ›
          </span>
        </div>
        <div className={styles.fileMeta}>
          {parent && <span className={styles.fileParent}>{parent}</span>}
          <span className={styles.metaDot} aria-hidden="true">
            ·
          </span>
          <span>
            {file.a_edits} + {file.b_edits} edit{file.a_edits + file.b_edits === 1 ? '' : 's'}
          </span>
          <span className={styles.metaDot} aria-hidden="true">
            ·
          </span>
          <span>last {formatWhen(file.last_transition_at)}</span>
        </div>
      </button>
    </li>
  );
}
