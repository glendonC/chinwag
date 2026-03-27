import styles from './StatCard.module.css';

export default function StatCard({ value, label, hint = '', tone = 'default' }) {
  const cls = [
    styles.stat,
    tone === 'accent' ? styles.accent : '',
    tone === 'danger' ? styles.danger : '',
    tone === 'success' ? styles.success : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} role="group" aria-label={`${value} ${label}`}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {hint ? <span className={styles.statHint}>{hint}</span> : null}
    </div>
  );
}
