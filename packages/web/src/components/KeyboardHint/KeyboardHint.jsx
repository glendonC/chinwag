import { useState } from 'react';
import styles from './KeyboardHint.module.css';

const STORAGE_KEY = 'chinwag:hint:arrow-nav-v2';
const alreadySeen = () => !!localStorage.getItem(STORAGE_KEY);

export default function KeyboardHint({ open, onOpen, onDismiss }) {
  if (alreadySeen()) return null;

  return (
    <span className={styles.wrapper}>
      {!open ? (
        <button
          type="button"
          className={styles.trigger}
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          aria-label="Keyboard shortcut hint"
        >
          ?
        </button>
      ) : (
        <span className={styles.popover}>
          <span className={styles.keys}>
            <kbd className={styles.key}>&larr;</kbd>
            <kbd className={styles.key}>&rarr;</kbd>
          </span>
          <span className={styles.text}>to navigate</span>
          <button type="button" className={styles.dismiss} onClick={(e) => { e.stopPropagation(); onDismiss(); }}>
            Got it
          </button>
        </span>
      )}
    </span>
  );
}

export function useKeyboardHint() {
  const [open, setOpen] = useState(false);
  return {
    open,
    onOpen: () => setOpen(true),
    onDismiss: () => {
      localStorage.setItem(STORAGE_KEY, '1');
      setOpen(false);
    },
  };
}
