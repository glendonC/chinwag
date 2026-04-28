import styles from './DeltaChip.module.css';

interface Props {
  /** Current-period value. */
  current: number;
  /** Previous-period value. Nullable - renders nothing if null/zero. */
  previous: number | null | undefined;
  /** 'up'=higher is better (default), 'down'=lower is better (e.g. warmup time). */
  sense?: 'up' | 'down';
  /** Optional trailing context, e.g. "vs prev 30d". */
  suffix?: string;
  /** Decimal places for the percentage. Default 0. */
  decimals?: number;
}

/**
 * Inline delta pill - arrow + signed percentage + optional suffix. Color
 * token reflects semantic good/bad given `sense`. Returns null when the
 * previous-period value is missing or zero (can't compute a % change).
 */
export default function DeltaChip({
  current,
  previous,
  sense = 'up',
  suffix,
  decimals = 0,
}: Props) {
  if (previous == null || previous === 0 || !Number.isFinite(previous)) return null;
  if (!Number.isFinite(current)) return null;

  const pct = ((current - previous) / previous) * 100;
  const magnitude = Math.abs(pct);
  if (magnitude < 0.5) {
    return (
      <span className={styles.chip} data-tone="neutral">
        <span className={styles.glyph}>·</span>
        <span>flat</span>
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </span>
    );
  }
  const up = pct > 0;
  const good = sense === 'up' ? up : !up;
  const tone = good ? 'good' : 'bad';
  const arrow = up ? '↑' : '↓';
  return (
    <span className={styles.chip} data-tone={tone}>
      <span className={styles.glyph}>{arrow}</span>
      <span>{magnitude.toFixed(decimals)}%</span>
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </span>
  );
}
