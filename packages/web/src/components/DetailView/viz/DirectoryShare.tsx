import { useMemo, type CSSProperties } from 'react';
import { WORK_TYPES } from '@chinmeister/shared/analytics/work-type.js';
import { workTypeColor } from '../../../widgets/utils.js';
import styles from './DirectoryShare.module.css';

export interface DirectoryShareFile {
  file: string;
  touch_count: number;
  work_type?: string | null;
}

interface Props {
  files: ReadonlyArray<DirectoryShareFile>;
  /** How many path segments to group by. Default 2 → "packages/web". */
  depth?: number;
  /** How many directories to show before "…more". Default 8. */
  limit?: number;
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

/**
 * Horizontal stacked bars — one row per top-level directory. Bar length
 * encodes that directory's share of total touches; the bar itself is
 * segmented by work-type. Pairs with FileHeatgrid (file-level) so Row 4
 * reads "where landed, by directory × work-type".
 */
export default function DirectoryShare({ files, depth = 2, limit = 8 }: Props) {
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
  const maxTotal = Math.max(1, ...visible.map((b) => b.total));
  const presentWorkTypes = Array.from(
    new Set(visible.flatMap((b) => Array.from(b.byWorkType.keys()))),
  ).sort((a, b) => {
    const ai = WORK_TYPES.indexOf(a as (typeof WORK_TYPES)[number]);
    const bi = WORK_TYPES.indexOf(b as (typeof WORK_TYPES)[number]);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return (
    <div className={styles.wrap}>
      <div className={styles.rows}>
        {visible.map((b, i) => {
          const pct = (b.total / maxTotal) * 100;
          const segs = presentWorkTypes
            .map((wt) => ({
              wt,
              edits: b.byWorkType.get(wt) ?? 0,
            }))
            .filter((s) => s.edits > 0);
          return (
            <div
              key={b.directory}
              className={styles.row}
              style={{ '--row-index': i } as CSSProperties}
              title={`${b.directory} · ${b.total.toLocaleString()} touches`}
            >
              <span className={styles.label}>{b.directory}</span>
              <div className={styles.track} style={{ width: `${pct}%` }}>
                {segs.map((s) => (
                  <span
                    key={s.wt}
                    className={styles.seg}
                    style={{
                      flex: s.edits,
                      background: workTypeColor(s.wt),
                    }}
                    title={`${s.wt} · ${s.edits.toLocaleString()} touches`}
                  />
                ))}
              </div>
              <span className={styles.value}>{b.total.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
      {buckets.length > visible.length && (
        <div className={styles.moreNote}>
          {buckets.length - visible.length} more{' '}
          {buckets.length - visible.length === 1 ? 'directory' : 'directories'} below
        </div>
      )}
      <div className={styles.legend}>
        {presentWorkTypes.map((wt) => (
          <span key={wt} className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: workTypeColor(wt) }} />
            {wt}
          </span>
        ))}
      </div>
    </div>
  );
}
