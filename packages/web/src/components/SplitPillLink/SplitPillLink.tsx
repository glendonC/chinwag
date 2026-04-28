import type { CSSProperties, ReactNode } from 'react';
import styles from './SplitPillLink.module.css';

/**
 * Shared "split pill" button primitive.
 *
 * Anatomy: a compact button with two visually separate rounded-rect segments -
 * one square "icon" segment and one wider "label" segment. Both segments share
 * a height of 32px and `--radius-md` corners. The order of segments is driven
 * by `iconPosition`; colors by `tone` and the optional `accentColor`.
 *
 * Used by the existing `BackLink` (muted, icon-leading) and `LaunchLink`
 * (accent, icon-trailing) components. Prefer those named wrappers at call
 * sites so the semantic intent is explicit; reach for this primitive only
 * when a new split-pill-shaped link is needed that doesn't fit either role.
 */
export type SplitPillTone = 'muted' | 'accent';
export type SplitPillIconPosition = 'leading' | 'trailing';

interface Props {
  label: string;
  icon: ReactNode;
  iconPosition: SplitPillIconPosition;
  tone: SplitPillTone;
  /** Accent background color (CSS value, incl. `var(...)`). Only consulted when `tone="accent"`. */
  accentColor?: string;
  onClick: () => void;
  ariaLabel: string;
}

export default function SplitPillLink({
  label,
  icon,
  iconPosition,
  tone,
  accentColor,
  onClick,
  ariaLabel,
}: Props) {
  const rootStyle: CSSProperties | undefined =
    tone === 'accent' && accentColor
      ? ({ ['--split-pill-accent' as string]: accentColor } as CSSProperties)
      : undefined;

  const iconEl = (
    <span className={styles.icon} aria-hidden="true">
      {icon}
    </span>
  );
  const labelEl = <span className={styles.label}>{label}</span>;

  return (
    <button
      type="button"
      className={`${styles.root} ${tone === 'accent' ? styles.accent : styles.muted}`}
      onClick={onClick}
      aria-label={ariaLabel}
      style={rootStyle}
    >
      {iconPosition === 'leading' ? iconEl : labelEl}
      {iconPosition === 'leading' ? labelEl : iconEl}
    </button>
  );
}
