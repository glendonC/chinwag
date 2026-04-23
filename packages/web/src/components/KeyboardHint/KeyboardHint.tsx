import { useState } from 'react';
import { useDismissible } from '../../hooks/useDismissible.js';
import styles from './KeyboardHint.module.css';

const STORAGE_KEY = 'chinmeister:hint:arrow-nav-v2';

interface Props {
  dismissed: boolean;
  open: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}

export default function KeyboardHint({ dismissed, open, onOpen, onDismiss }: Props) {
  if (dismissed) return null;

  return (
    <span className={styles.wrapper}>
      {!open ? (
        <button
          type="button"
          className={styles.trigger}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
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
          <button
            type="button"
            className={styles.dismiss}
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
          >
            Got it
          </button>
        </span>
      )}
    </span>
  );
}

interface KeyboardHintState {
  dismissed: boolean;
  open: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}

export function useKeyboardHint(): KeyboardHintState {
  const [open, setOpen] = useState(false);
  const { isDismissed, dismiss } = useDismissible(STORAGE_KEY);
  return {
    dismissed: isDismissed(),
    open,
    onOpen: () => setOpen(true),
    onDismiss: () => {
      dismiss();
      setOpen(false);
    },
  };
}
