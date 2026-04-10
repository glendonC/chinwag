import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './StatCard.module.css';

interface Props {
  value: ReactNode;
  label: string;
  hint?: string;
  tone?: 'default' | 'accent' | 'danger' | 'success';
}

export default function StatCard({ value, label, hint = '', tone = 'default' }: Props) {
  const cls = clsx(styles.stat, {
    [styles.accent]: tone === 'accent',
    [styles.danger]: tone === 'danger',
    [styles.success]: tone === 'success',
  });

  return (
    <div className={cls} role="group" aria-label={`${value} ${label}`}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {hint ? <span className={styles.statHint}>{hint}</span> : null}
    </div>
  );
}
