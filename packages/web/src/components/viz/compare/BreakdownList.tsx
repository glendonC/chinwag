import type { CSSProperties, ReactNode } from 'react';
import styles from './BreakdownList.module.css';

export interface BreakdownItem {
  key: string;
  label: ReactNode;
  /** 0–100. Clamped at render time. */
  fillPct: number;
  /** Optional fill color — defaults to --ink. Pass a tool meta color
   *  when breaking down by tool so the bar matches the tool brand. */
  fillColor?: string;
  /** Right-aligned value. Wrap a trailing segment in <BreakdownMeta>
   *  for the dimmer mono sub-text. */
  value: ReactNode;
}

interface Props {
  items: ReadonlyArray<BreakdownItem>;
}

/**
 * The dominant viz inside category detail views. Label on the left,
 * thin progress track in the middle, value on the right. Used for
 * "By tool", "By model", "By teammate", "By directory", etc.
 *
 * Design guardrails:
 * - Single bar color per row. The track is a shared neutral.
 * - Rows reveal staggered via --row-index animation.
 * - No sorting logic here: callers pre-sort in the order they want.
 */
export default function BreakdownList({ items }: Props) {
  return (
    <div className={styles.list}>
      {items.map((item, i) => {
        const pct = Math.max(0, Math.min(100, item.fillPct));
        return (
          <div key={item.key} className={styles.row} style={{ '--row-index': i } as CSSProperties}>
            <span className={styles.label}>{item.label}</span>
            <div className={styles.track}>
              <div
                className={styles.fill}
                style={{
                  width: `${pct}%`,
                  ...(item.fillColor ? { background: item.fillColor } : {}),
                }}
              />
            </div>
            <span className={styles.value}>{item.value}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Dimmer mono segment for the trailing meta inside a row's value. */
export function BreakdownMeta({ children }: { children: ReactNode }) {
  return <span className={styles.meta}>{children}</span>;
}
