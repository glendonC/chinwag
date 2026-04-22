import type { CSSProperties } from 'react';
import styles from './DotMatrix.module.css';

interface Props {
  /** Total slots. Caps visible dots at MAX to keep the viz compact on huge
   *  periods — the aria label still reports the true total. */
  total: number;
  /** Slots filled (`filled <= total`). */
  filled: number;
  /** Color for filled dots. Empty dots render as hollow rings. */
  color: string;
  /** Overrides the default 15-column grid (Sessions uses 15; tighter
   *  layouts can pass fewer). */
  cols?: number;
  /** Cap on rendered dots. Defaults to 200. */
  max?: number;
}

/**
 * One dot per item, filled = "hits the condition." Grid wraps downward,
 * so dense periods still occupy compact horizontal space. At the cap the
 * big number carries the signal; the matrix becomes a density indicator
 * rather than a literal 1:1 count.
 */
export default function DotMatrix({ total, filled, color, cols = 15, max = 200 }: Props) {
  const safeTotal = Math.min(total, max);
  const safeFilled = Math.min(filled, safeTotal);
  const capped = total > max;
  const dots = Array.from({ length: safeTotal }, (_, i) => i < safeFilled);
  const ariaLabel = capped
    ? `${filled} of ${total} (showing first ${max})`
    : `${filled} of ${total}`;
  return (
    <div
      className={styles.matrix}
      style={{ gridTemplateColumns: `repeat(${cols}, 9px)` } as CSSProperties}
      aria-label={ariaLabel}
      role="img"
    >
      {dots.map((isFilled, i) => (
        <span
          key={i}
          className={styles.dot}
          style={{
            background: isFilled ? color : 'transparent',
            borderColor: isFilled ? 'transparent' : 'var(--soft)',
          }}
        />
      ))}
    </div>
  );
}
