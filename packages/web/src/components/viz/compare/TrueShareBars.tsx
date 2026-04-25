import type { CSSProperties, ReactNode } from 'react';
import styles from './TrueShareBars.module.css';

export interface TrueShareEntry {
  key: string;
  /** Label rendered on the left. Can include icons. */
  label: ReactNode;
  /** The quantity the bar length encodes (e.g. edit count). */
  value: number;
  /** Bar fill color. Defaults to ink. */
  color?: string;
  /** Right-aligned meta text (e.g. "48.1/hr · 7.4h"). */
  meta?: ReactNode;
  /** Optional tooltip on hover. */
  title?: string;
}

interface Props {
  entries: ReadonlyArray<TrueShareEntry>;
  /** Format the share percentage. Defaults to `12%`, rounded. */
  formatShare?: (share: number) => string;
  /** Format the absolute value (shown beside the share). */
  formatValue?: (value: number) => string;
  /** Optional click handler per row. */
  onRowClick?: (key: string) => void;
}

/**
 * Horizontal contribution bars. Bar width encodes the entity's TRUE share of
 * the total (sum of all `value`s), not a max-normalized rate. Fill color is
 * the entity's brand/category color.
 */
export default function TrueShareBars({
  entries,
  formatShare = (s) => `${Math.round(s * 100)}%`,
  formatValue,
  onRowClick,
}: Props) {
  const total = entries.reduce((sum, e) => sum + Math.max(0, e.value), 0);
  if (total <= 0) return null;

  return (
    <div className={styles.strip}>
      {entries.map((e, i) => {
        const share = Math.max(0, e.value) / total;
        const pct = Math.min(100, share * 100);
        const clickable = Boolean(onRowClick);
        return (
          <div
            key={e.key}
            className={clickable ? styles.rowClickable : styles.row}
            style={{ '--row-index': i } as CSSProperties}
            onClick={clickable ? () => onRowClick?.(e.key) : undefined}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={
              clickable
                ? (ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      onRowClick?.(e.key);
                    }
                  }
                : undefined
            }
            title={e.title}
          >
            <span className={styles.label}>{e.label}</span>
            <div className={styles.track} aria-hidden="true">
              <div
                className={styles.fill}
                style={{
                  width: `${pct}%`,
                  background: e.color ?? 'var(--ink)',
                }}
              />
            </div>
            <span className={styles.value}>
              <span className={styles.share}>{formatShare(share)}</span>
              {formatValue ? (
                <span className={styles.absolute}> · {formatValue(e.value)}</span>
              ) : null}
              {e.meta ? <span className={styles.meta}> · {e.meta}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
