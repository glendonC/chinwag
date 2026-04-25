import type { CSSProperties, ReactNode } from 'react';
import styles from './FileFrictionRow.module.css';

interface Props {
  /** Filename or path. Renders left-aligned in the row's primary column. */
  label: ReactNode;
  /** 0-1 severity fill. Values outside the range are clamped. */
  barFill: number;
  /** Bar fill color. Defaults to `var(--warn)` — the canonical friction
   *  tint. Pass `var(--danger)` for hard-failure rows or
   *  `var(--soft)` for muted-tone rows. */
  barColor?: string;
  /** Dimmed trailing facts (e.g. `"6 reworks · 3 sessions"`). */
  meta: ReactNode;
  /** Optional click handler. When set, the row renders as a button and
   *  paints a trailing `↗` on hover/focus. When unset, the row renders
   *  as a div with the arrow column reserved (so list gutters stay
   *  aligned with adjacent clickable rows). */
  onClick?: () => void;
  /** Hover tooltip — typically the full path when `label` is truncated. */
  title?: string;
  /** Animation index for cascade reveal. Caller passes the index from
   *  a `.map((row, i) => ...)`. */
  index?: number;
  /** Override the aria-label on the button form. Defaults to the label
   *  text + " — open detail". */
  ariaLabel?: string;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Canonical row primitive for the file-friction widget family. Five
 * widgets converge on this shape (`confused-files`, `file-rework`,
 * `concurrent-edits`, `audit-staleness`, `memory-bus-factor`); the
 * primitive standardizes the visuals so they read as variants of one
 * pattern rather than five reinventions.
 *
 * Phase 1 lands the primitive; Phase 3 migrates the existing widget
 * bodies onto it.
 */
export default function FileFrictionRow({
  label,
  barFill,
  barColor = 'var(--warn)',
  meta,
  onClick,
  title,
  index = 0,
  ariaLabel,
}: Props) {
  const fill = clamp01(barFill);
  const style = { '--row-index': index } as CSSProperties;
  const inner = (
    <>
      <span className={styles.label}>{label}</span>
      <div className={styles.barTrack}>
        <div className={styles.barFill} style={{ width: `${fill * 100}%`, background: barColor }} />
      </div>
      <span className={styles.meta}>{meta}</span>
      <span className={styles.arrow} aria-hidden="true">
        {onClick ? '↗' : ''}
      </span>
    </>
  );

  if (onClick) {
    const labelText = typeof label === 'string' ? label : typeof title === 'string' ? title : '';
    return (
      <button
        type="button"
        className={styles.row}
        style={style}
        onClick={onClick}
        title={title}
        aria-label={ariaLabel ?? (labelText ? `${labelText} — open detail` : undefined)}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={styles.row} style={style} title={title}>
      {inner}
    </div>
  );
}
