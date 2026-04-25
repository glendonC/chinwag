import { useMemo, useState, type CSSProperties } from 'react';
import { WORK_TYPES } from '@chinmeister/shared/analytics/work-type.js';
import { workTypeColor } from '../../../widgets/utils.js';
import styles from './DirectoryColumns.module.css';

export interface DirectoryColumnsFile {
  file: string;
  touch_count: number;
  /** Used in `mode='work-type'` (default). Drives the N-color stack. */
  work_type?: string | null;
  /** Used in `mode='two-color'`. Share (0–1) of touches attributed to a
   *  single primary author. Per-directory shares are touch-weighted across
   *  the contributing files. Values outside [0, 1] are clamped. */
  primary_share?: number | null;
}

interface Props {
  files: ReadonlyArray<DirectoryColumnsFile>;
  /** How many path segments to collapse into the directory key. Default 2. */
  depth?: number;
  /** Max number of columns to render. Default 8. */
  limit?: number;
  /** Column stack height in px. Default 200. */
  height?: number;
  /** Controlled selection: the currently-active directory key. When set,
   *  that column renders at full opacity; all others dim. */
  selectedKey?: string | null;
  /** Selection handler. Called with the clicked directory key, or null
   *  when the active column is re-clicked (toggle-off). */
  onSelect?: (key: string | null) => void;
  /**
   * Stack semantics:
   *   - 'work-type' (default): N-color stack, one segment per work_type
   *     touched in the directory. Legend lists every work-type present.
   *   - 'two-color': two-segment stack — single-author share on top
   *     (`var(--warn)`) and the remaining share below (`var(--soft)`).
   *     Legend collapses to the two semantic labels. Used by Memory's
   *     authorship tab to read concentration without the work-type axis.
   *
   * Switching modes does NOT change the column-height encoding (still
   * total touches), so the eye keeps the same volume reference.
   */
  mode?: 'work-type' | 'two-color';
  /** Override labels for the two-color legend. Defaults to "Single author"
   *  and "Other authors" — Memory uses this; other callers can rename. */
  twoColorLabels?: { primary: string; other: string };
}

interface DirBucket {
  directory: string;
  total: number;
  byWorkType: Map<string, number>;
  /** Touch-weighted single-author share aggregated across files. Only
   *  populated and consumed in `mode='two-color'`. */
  primaryShare: number;
}

function dirKey(path: string, depth: number): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '(root)';
  return parts.slice(0, Math.max(1, depth)).join('/');
}

// Label the column with the distinguishing last segment — e.g. "web"
// instead of "packages/web" — so neighboring columns don't all read as
// truncated "PACKAGES/…". Full path stays on the hover title.
function dirLabel(key: string): string {
  const parts = key.split('/').filter(Boolean);
  if (parts.length === 0) return key;
  return parts[parts.length - 1];
}

/**
 * Vertical stacked columns per top-level directory. Column height encodes
 * total touches.
 *
 * Two stack modes:
 *   - `mode='work-type'` (default): segments colored by work-type, one
 *     segment per work-type touched in the directory. Reads as a "what
 *     kind of work happens here" lens.
 *   - `mode='two-color'`: single-author share (top, --warn) vs remaining
 *     share (bottom, --soft). Reads as a "how concentrated is authorship"
 *     lens. Driven by `file.primary_share` (touch-weighted aggregate per
 *     directory).
 *
 * Horizontal layout reads as a bar chart, not a list — a clean pair to the
 * treemap on the left half.
 */
export default function DirectoryColumns({
  files,
  depth = 2,
  limit = 8,
  height = 200,
  selectedKey = null,
  onSelect,
  mode = 'work-type',
  twoColorLabels = { primary: 'Single author', other: 'Other authors' },
}: Props) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const selectable = Boolean(onSelect);

  const buckets = useMemo<DirBucket[]>(() => {
    const map = new Map<string, DirBucket>();
    for (const f of files) {
      if (f.touch_count <= 0) continue;
      const key = dirKey(f.file, depth);
      const bucket = map.get(key) ?? {
        directory: key,
        total: 0,
        byWorkType: new Map<string, number>(),
        primaryShare: 0,
      };
      bucket.total += f.touch_count;
      const wt = f.work_type || 'other';
      bucket.byWorkType.set(wt, (bucket.byWorkType.get(wt) ?? 0) + f.touch_count);
      // Touch-weighted aggregate of primary_share. Stored as a numerator
      // (sum of share × touches) and finalized to a 0-1 ratio after the
      // pass — same idea as a weighted mean.
      const share = f.primary_share ?? 0;
      const clamped = Math.max(0, Math.min(1, share));
      bucket.primaryShare += clamped * f.touch_count;
      map.set(key, bucket);
    }
    const out = [...map.values()];
    for (const b of out) {
      b.primaryShare = b.total > 0 ? b.primaryShare / b.total : 0;
    }
    return out.sort((a, b) => b.total - a.total);
  }, [files, depth]);

  if (buckets.length === 0) return null;

  const visible = buckets.slice(0, limit);
  const overflow = buckets.length - visible.length;
  const maxTotal = Math.max(1, ...visible.map((b) => b.total));
  const presentWorkTypes = Array.from(
    new Set(visible.flatMap((b) => Array.from(b.byWorkType.keys()))),
  ).sort((a, b) => {
    // Canonical work types come first in their declared order; unknown
    // keys (if any slip through) sort to the tail.
    const ai = WORK_TYPES.indexOf(a as (typeof WORK_TYPES)[number]);
    const bi = WORK_TYPES.indexOf(b as (typeof WORK_TYPES)[number]);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return (
    <div className={styles.wrap}>
      <div className={styles.cols} style={{ '--col-height': `${height}px` } as CSSProperties}>
        {visible.map((b, i) => {
          const pct = (b.total / maxTotal) * 100;
          // Stack composition. Work-type mode: one segment per work-type
          // touched, colored by `workTypeColor`. Two-color mode: exactly
          // two segments (primary share + remainder), colored from tokens.
          // Both shapes feed the same `<div className={styles.stack}>`
          // flex container — only the segments differ.
          const segs =
            mode === 'two-color'
              ? [
                  { key: 'other', value: 1 - b.primaryShare, color: 'var(--soft)' },
                  { key: 'primary', value: b.primaryShare, color: 'var(--warn)' },
                ].filter((s) => s.value > 0)
              : presentWorkTypes
                  .map((wt) => ({
                    key: wt,
                    value: b.byWorkType.get(wt) ?? 0,
                    color: workTypeColor(wt),
                  }))
                  .filter((s) => s.value > 0);
          const isHover = hoverKey === b.directory;
          const isSelected = selectedKey === b.directory;
          const isDimmed = Boolean(selectedKey) && !isSelected;
          const clickable = selectable;
          const handleClick = clickable
            ? () => onSelect?.(isSelected ? null : b.directory)
            : undefined;
          return (
            <div
              key={b.directory}
              className={clickable ? styles.colClickable : styles.col}
              style={{ '--col-index': i } as CSSProperties}
              onPointerEnter={() => setHoverKey(b.directory)}
              onPointerLeave={() => setHoverKey(null)}
              onClick={handleClick}
              onKeyDown={
                clickable
                  ? (ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        onSelect?.(isSelected ? null : b.directory);
                      }
                    }
                  : undefined
              }
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-pressed={clickable ? isSelected : undefined}
              data-active={isHover || isSelected ? 'true' : undefined}
              data-selected={isSelected ? 'true' : undefined}
              data-dimmed={isDimmed ? 'true' : undefined}
              title={b.directory}
            >
              <span className={styles.value}>
                {mode === 'two-color'
                  ? `${Math.round(b.primaryShare * 100)}%`
                  : b.total.toLocaleString()}
              </span>
              <div className={styles.stack} style={{ height: `${pct}%` }}>
                {segs.map((s) => (
                  <span
                    key={s.key}
                    className={styles.seg}
                    style={{
                      flex: s.value,
                      background: s.color,
                    }}
                    title={
                      mode === 'two-color'
                        ? `${s.key === 'primary' ? twoColorLabels.primary : twoColorLabels.other} · ${Math.round(s.value * 100)}%`
                        : `${s.key} · ${s.value.toLocaleString()}`
                    }
                  />
                ))}
              </div>
              <span className={styles.label}>{dirLabel(b.directory)}</span>
            </div>
          );
        })}
      </div>
      <div className={styles.footer}>
        <div className={styles.legend}>
          {mode === 'two-color' ? (
            <>
              <span className={styles.legendItem}>
                <span className={styles.swatch} style={{ background: 'var(--warn)' }} />
                {twoColorLabels.primary}
              </span>
              <span className={styles.legendItem}>
                <span className={styles.swatch} style={{ background: 'var(--soft)' }} />
                {twoColorLabels.other}
              </span>
            </>
          ) : (
            presentWorkTypes.map((wt) => (
              <span key={wt} className={styles.legendItem}>
                <span className={styles.swatch} style={{ background: workTypeColor(wt) }} />
                {wt}
              </span>
            ))
          )}
        </div>
        {overflow > 0 && (
          <span className={styles.overflow}>
            +{overflow} more {overflow === 1 ? 'directory' : 'directories'}
          </span>
        )}
      </div>
    </div>
  );
}
