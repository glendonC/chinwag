import styles from './Banner.module.css';

/**
 * Squircle notification banner — centered, faint gradient background.
 * Use for errors, announcements, and status messages.
 *
 * @param {'error' | 'info' | 'success'} variant — color palette
 * @param {string} eyebrow — uppercase label (e.g. "Live sync paused")
 * @param {React.ReactNode} children — main message content
 * @param {string} [meta] — secondary muted text
 * @param {{ label: string, onClick: () => void }[]} [actions] — action buttons
 * @param {() => void} [onDismiss] — show close button when provided
 */
export default function Banner({ variant = 'info', eyebrow, children, meta, actions, onDismiss }) {
  return (
    <div className={`${styles.banner} ${styles[variant]}`} role="status" aria-live="polite">
      <div className={styles.body}>
        {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
        <span className={styles.text}>{children}</span>
        {actions?.map(({ label, onClick }) => (
          <button key={label} type="button" className={styles.action} onClick={onClick}>
            {label}
          </button>
        ))}
        {meta && <span className={styles.meta}>{meta}</span>}
      </div>

      {onDismiss && (
        <button className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path
              d="M3 3l8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
