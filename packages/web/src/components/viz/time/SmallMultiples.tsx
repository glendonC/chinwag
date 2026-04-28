import type { CSSProperties, ReactNode } from 'react';
import styles from './SmallMultiples.module.css';

export interface SmallMultipleItem {
  key: string;
  /** Left-aligned primary label (typically a handle or team name). */
  label: ReactNode;
  /** Right-aligned mono meta (e.g. "+123 / −45"). */
  meta?: ReactNode;
  /** The chart body - usually a compact DivergingColumns. */
  body: ReactNode;
}

/**
 * Responsive grid of small chart cells. Each cell: header (label + meta)
 * above a body chart. Used for per-member / per-project timelines where
 * a single aggregate loses the cross-entity story. Cells stagger via
 * `--row-index` and the grid collapses to one column below 720px.
 */
export default function SmallMultiples({ items }: { items: ReadonlyArray<SmallMultipleItem> }) {
  return (
    <div className={styles.grid}>
      {items.map((item, i) => (
        <div key={item.key} className={styles.item} style={{ '--row-index': i } as CSSProperties}>
          <div className={styles.header}>
            <span className={styles.label}>{item.label}</span>
            {item.meta && <span className={styles.meta}>{item.meta}</span>}
          </div>
          {item.body}
        </div>
      ))}
    </div>
  );
}
