import { useMemo, useState, type CSSProperties } from 'react';
import { WORK_TYPES } from '@chinmeister/shared/analytics/work-type.js';
import { workTypeColor } from '../../../widgets/utils.js';
import styles from './DirectoryColumns.module.css';

export interface DirectoryColumnsFile {
  file: string;
  touch_count: number;
  work_type?: string | null;
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
}

interface DirBucket {
  directory: string;
  total: number;
  byWorkType: Map<string, number>;
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
 * total touches; internal stacks are colored by work-type. Horizontal
 * layout reads as a bar chart, not a list — a clean pair to the treemap
 * on the left half.
 */
export default function DirectoryColumns({
  files,
  depth = 2,
  limit = 8,
  height = 200,
  selectedKey = null,
  onSelect,
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
      };
      bucket.total += f.touch_count;
      const wt = f.work_type || 'other';
      bucket.byWorkType.set(wt, (bucket.byWorkType.get(wt) ?? 0) + f.touch_count);
      map.set(key, bucket);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
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
          const segs = presentWorkTypes
            .map((wt) => ({ wt, value: b.byWorkType.get(wt) ?? 0 }))
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
              <span className={styles.value}>{b.total.toLocaleString()}</span>
              <div className={styles.stack} style={{ height: `${pct}%` }}>
                {segs.map((s) => (
                  <span
                    key={s.wt}
                    className={styles.seg}
                    style={{
                      flex: s.value,
                      background: workTypeColor(s.wt),
                    }}
                    title={`${s.wt} · ${s.value.toLocaleString()}`}
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
          {presentWorkTypes.map((wt) => (
            <span key={wt} className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: workTypeColor(wt) }} />
              {wt}
            </span>
          ))}
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
