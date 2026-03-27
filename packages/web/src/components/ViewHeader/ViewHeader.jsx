import styles from './ViewHeader.module.css';

export default function ViewHeader({ eyebrow, title, subtitle, meta = null }) {
  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>

      {meta && (
        <div className={styles.meta}>
          {meta}
        </div>
      )}
    </header>
  );
}
