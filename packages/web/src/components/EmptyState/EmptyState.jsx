import styles from './EmptyState.module.css';

export default function EmptyState({ title, hint = '', large = false }) {
  const cls = [styles.emptyState, large ? styles.large : ''].filter(Boolean).join(' ');

  return (
    <div className={cls} role="status">
      <p className={styles.emptyTitle}>{title}</p>
      {hint && (
        <p className={styles.emptyHint}>{hint}</p>
      )}
    </div>
  );
}
