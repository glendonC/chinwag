import type { CSSProperties } from 'react';
import styles from './DivergingColumns.module.css';

export interface DivergingSeries {
  /** Label for the axis tick (typically YYYY-MM-DD). */
  day: string;
  /** Value rendered above the midline. */
  added: number;
  /** Value rendered below the midline. */
  removed: number;
}

interface Props {
  data: ReadonlyArray<DivergingSeries>;
  /** Plot height in px. Defaults to 140. Smaller values make this usable
   *  as a sparkline inside small-multiples cells. */
  height?: number;
  /** Render axis tick labels beneath the plot. Disable for compact
   *  small-multiples where the parent header carries context. */
  showAxis?: boolean;
  /** Format an axis tick. Defaults to "MM-DD" extraction from a YYYY-MM-DD
   *  string. */
  formatAxis?: (day: string) => string;
}

function defaultFormatAxis(iso: string): string {
  if (iso.length >= 10) return iso.slice(5);
  return iso;
}

/**
 * Above-midline = added, below = removed. Height is shared between both
 * halves and normalized to the busiest day in either direction so the
 * add/remove ratio on any given day is legible at a glance. One viz
 * instead of two separate sparklines with an implicit difference.
 */
export default function DivergingColumns({
  data,
  height = 140,
  showAxis = true,
  formatAxis = defaultFormatAxis,
}: Props) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.added, d.removed)));
  const labelSpacing = Math.max(1, Math.floor(data.length / 6));
  return (
    <div className={styles.diverging} style={{ '--diverging-h': `${height}px` } as CSSProperties}>
      <div className={styles.grid}>
        {data.map((d, i) => {
          const addPct = (d.added / max) * 100;
          const remPct = (d.removed / max) * 100;
          return (
            <div
              key={d.day}
              className={styles.col}
              style={{ '--col-index': i } as CSSProperties}
              title={`${d.day} · +${d.added} / −${d.removed}`}
            >
              <div className={styles.halfTop}>
                <div className={styles.barAdd} style={{ height: `${addPct}%` }} />
              </div>
              <div className={styles.midline} />
              <div className={styles.halfBottom}>
                <div className={styles.barRemove} style={{ height: `${remPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      {showAxis && (
        <div className={styles.axis}>
          {data.map((d, i) => (
            <span
              key={d.day}
              className={styles.axisLabel}
              data-visible={
                i === 0 || i === data.length - 1 || i % labelSpacing === 0 ? 'true' : 'false'
              }
            >
              {formatAxis(d.day)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
