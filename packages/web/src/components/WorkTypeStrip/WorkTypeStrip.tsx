import type { CSSProperties } from 'react';
import clsx from 'clsx';
import { workTypeColor } from '../../widgets/utils.js';
import styles from './WorkTypeStrip.module.css';

export interface WorkTypeStripEntry {
  work_type: string;
  file_count: number;
}

interface Props {
  entries: readonly WorkTypeStripEntry[];
  /** Card = thin, label-less, lives below a stat value on a widget card
   * (3x2 grid cell). Hero = taller, with an inline legend beneath, used
   * as the opening frame of the files-touched drill. */
  variant?: 'card' | 'hero';
  /** Accessible label describing what the proportions represent. */
  ariaLabel?: string;
  /** When defined, segments render as tab-selectors. Clicking a segment
   * or its legend row fires `onSelect(work_type)`; clicking the current
   * selection fires `onSelect(null)` to clear the filter. Active segment
   * stays in full ink/color, inactive dim toward --soft - matches the
   * design language rule for stat values doubling as tab selectors. */
  activeWorkType?: string | null;
  onSelect?: (workType: string | null) => void;
}

// Segments below this share fold into a single trailing "other"-tinted segment
// so specks don't render at card scale. 3% is the same threshold the tool-ring
// in the Sessions detail uses - matches the project's existing visual tolerance
// for chart-slice legibility.
const MIN_SHARE = 0.03;

interface Segment {
  key: string;
  work_type: string;
  file_count: number;
  color: string;
  share: number;
}

function buildSegments(entries: readonly WorkTypeStripEntry[]): Segment[] {
  const total = entries.reduce((s, e) => s + e.file_count, 0);
  if (total <= 0) return [];

  const sorted = [...entries].sort((a, b) => b.file_count - a.file_count);
  const visible: Segment[] = [];
  let tailCount = 0;

  for (const e of sorted) {
    const share = e.file_count / total;
    if (share < MIN_SHARE) {
      tailCount += e.file_count;
      continue;
    }
    visible.push({
      key: e.work_type,
      work_type: e.work_type,
      file_count: e.file_count,
      color: workTypeColor(e.work_type),
      share,
    });
  }

  if (tailCount > 0) {
    // Folded tail renders in --work-other so multiple under-threshold
    // classes don't read as three indistinguishable gray slivers.
    visible.push({
      key: '__tail__',
      work_type: 'other',
      file_count: tailCount,
      color: workTypeColor('other'),
      share: tailCount / total,
    });
  }

  return visible;
}

export default function WorkTypeStrip({
  entries,
  variant = 'card',
  ariaLabel,
  activeWorkType,
  onSelect,
}: Props) {
  const segments = buildSegments(entries);
  if (segments.length === 0) return null;

  const total = segments.reduce((s, seg) => s + seg.file_count, 0);
  const interactive = typeof onSelect === 'function';
  const hasFilter = activeWorkType != null;

  // Clicking the active segment again clears the filter - same idempotent
  // toggle pattern as the per-tool hero selectors in SessionsPanel.
  const handleSelect = (workType: string) => {
    if (!onSelect) return;
    onSelect(activeWorkType === workType ? null : workType);
  };

  const stripClass = clsx(styles.strip, variant === 'hero' && styles.stripHero);

  return (
    <div
      className={variant === 'hero' ? styles.block : undefined}
      // `data-wts` exposes a stable hook for external pinning rules (see
      // widget-shared.module.css) so the card-variant strip can be anchored
      // above the coverage note without reaching into this module's hashed
      // class names.
      data-wts={variant}
      aria-label={ariaLabel ?? `${total} files by work type`}
      role={interactive ? 'group' : 'img'}
    >
      <div className={stripClass}>
        {segments.map((seg, i) => {
          const isActive = activeWorkType === seg.work_type;
          const dimmed = hasFilter && !isActive;
          const style = {
            flex: seg.file_count,
            background: seg.color,
            '--row-index': i,
          } as CSSProperties;
          if (interactive) {
            return (
              <button
                key={seg.key}
                type="button"
                className={clsx(styles.segment, styles.segmentButton, dimmed && styles.segmentDim)}
                style={style}
                title={`${seg.work_type} · ${seg.file_count}`}
                aria-pressed={isActive}
                aria-label={`Filter to ${seg.work_type}`}
                onClick={() => handleSelect(seg.work_type)}
              />
            );
          }
          return (
            <div
              key={seg.key}
              className={styles.segment}
              style={style}
              title={`${seg.work_type} · ${seg.file_count}`}
            />
          );
        })}
      </div>
      {variant === 'hero' && (
        <ul className={styles.legend}>
          {segments.map((seg, i) => {
            const isActive = activeWorkType === seg.work_type;
            const dimmed = hasFilter && !isActive;
            const rowClass = clsx(
              styles.legendItem,
              interactive && styles.legendItemInteractive,
              dimmed && styles.legendItemDim,
            );
            const content = (
              <>
                <span className={styles.legendDot} style={{ background: seg.color }} />
                <span className={styles.legendLabel}>{seg.work_type}</span>
                <span className={styles.legendValue}>{seg.file_count}</span>
              </>
            );
            return (
              <li key={seg.key} className={rowClass} style={{ '--row-index': i } as CSSProperties}>
                {interactive ? (
                  <button
                    type="button"
                    className={styles.legendButton}
                    onClick={() => handleSelect(seg.work_type)}
                    aria-pressed={isActive}
                    aria-label={`Filter to ${seg.work_type}`}
                  >
                    {content}
                  </button>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
