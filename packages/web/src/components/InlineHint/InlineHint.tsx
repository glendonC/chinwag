// Reusable floating hint pill — fixed bottom-center of the content column.
// Pairs with the useDismissible hook for one-shot dismissal state.

import type { ReactNode } from 'react';
import styles from './InlineHint.module.css';

interface Props {
  eyebrow?: string;
  children: ReactNode;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
}

export default function InlineHint({
  eyebrow = 'Tip',
  children,
  actionLabel,
  onAction,
  onDismiss,
}: Props) {
  return (
    <div className={styles.hint} role="status" aria-live="polite">
      <div className={styles.body}>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <span className={styles.text}>{children}</span>
      </div>
      <button type="button" className={styles.action} onClick={onAction}>
        {actionLabel}
      </button>
      <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 3l8 8M11 3l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
