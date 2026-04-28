import type { CSSProperties, ReactNode } from 'react';
import styles from './DivergingRows.module.css';

export interface DivergingRowEntry {
  key: string;
  label: ReactNode;
  added: number;
  removed: number;
}

interface Props {
  entries: ReadonlyArray<DivergingRowEntry>;
  /** Format a numeric value with its sign prefix. Defaults to locale
   *  thousands-separated with + / − prefixes. */
  formatAdded?: (n: number) => string;
  formatRemoved?: (n: number) => string;
}

function defaultAdded(n: number): string {
  return n > 0 ? `+${n.toLocaleString()}` : '-';
}

function defaultRemoved(n: number): string {
  return n > 0 ? `−${n.toLocaleString()}` : '-';
}

/**
 * Horizontal diverging bars. Removed bar extends left of a center axis,
 * added bar extends right. Shared max across all rows so magnitudes
 * compare. The center axis is load-bearing - it tells the story.
 */
export default function DivergingRows({
  entries,
  formatAdded = defaultAdded,
  formatRemoved = defaultRemoved,
}: Props) {
  const max = Math.max(1, ...entries.map((e) => Math.max(e.added, e.removed)));
  return (
    <div className={styles.rows}>
      {entries.map((e, i) => {
        const addPct = (e.added / max) * 100;
        const remPct = (e.removed / max) * 100;
        return (
          <div key={e.key} className={styles.row} style={{ '--row-index': i } as CSSProperties}>
            <span className={styles.rowLabel}>{e.label}</span>
            <div className={styles.tracks}>
              <div className={styles.left}>
                <span className={styles.removeVal}>{formatRemoved(e.removed)}</span>
                <div className={styles.barRemoveH} style={{ width: `${remPct}%` }} />
              </div>
              <div className={styles.right}>
                <div className={styles.barAddH} style={{ width: `${addPct}%` }} />
                <span className={styles.addVal}>{formatAdded(e.added)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
