import type { CSSProperties, ReactNode } from 'react';
import styles from './FileList.module.css';

export interface FileListItem {
  key: string;
  /** File path or name. Mono, left-aligned, truncates with ellipsis
   *  when it overflows the row. Pass the full path as `title` for a
   *  hover tooltip. */
  name: ReactNode;
  /** Full path or description shown as native tooltip on hover. */
  title?: string;
  /** Right-aligned metadata — "12 touches", "34% rework · 8 edits". */
  meta: ReactNode;
}

interface Props {
  items: ReadonlyArray<FileListItem>;
}

/**
 * List of files with a mono name on the left and dimmer mono meta on
 * the right. Used for "Most-touched files", "Highest rework ratio",
 * and similar file-centric lists inside detail views.
 */
export default function FileList({ items }: Props) {
  return (
    <ul className={styles.list}>
      {items.map((item, i) => (
        <li key={item.key} className={styles.row} style={{ '--row-index': i } as CSSProperties}>
          <span className={styles.name} title={item.title}>
            {item.name}
          </span>
          <span className={styles.meta}>{item.meta}</span>
        </li>
      ))}
    </ul>
  );
}
