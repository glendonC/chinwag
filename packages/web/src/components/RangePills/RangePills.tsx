import clsx from 'clsx';
import styles from './RangePills.module.css';

interface Props<T extends number> {
  value: T;
  onChange: (next: T) => void;
  options?: readonly T[];
  /** Suffix appended to each pill label (default: 'd' for days) */
  suffix?: string;
  ariaLabel?: string;
}

const DEFAULT_OPTIONS = [7, 30, 90] as const;

export default function RangePills<T extends number>({
  value,
  onChange,
  options = DEFAULT_OPTIONS as unknown as readonly T[],
  suffix = 'd',
  ariaLabel = 'Time range',
}: Props<T>) {
  return (
    <div className={styles.rangeSelector} role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={clsx(styles.rangeButton, value === opt && styles.rangeActive)}
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
        >
          {opt}
          {suffix}
        </button>
      ))}
    </div>
  );
}
