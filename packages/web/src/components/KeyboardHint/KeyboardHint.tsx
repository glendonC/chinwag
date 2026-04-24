import { useState } from 'react';
import clsx from 'clsx';
import { useDismissible } from '../../hooks/useDismissible.js';
import styles from './KeyboardHint.module.css';

// Storage keys split by axis so dismissing the horizontal hint doesn't
// dismiss the vertical one (the two navs are independent — a user who
// learned ←/→ may still benefit from seeing ↑/↓). Keeping the
// horizontal key at its existing value preserves dismissal state for
// users who've already clicked through the legacy hint.
const STORAGE_KEY_HORIZONTAL = 'chinmeister:hint:arrow-nav-v2';
const STORAGE_KEY_VERTICAL = 'chinmeister:hint:arrow-nav-vertical-v1';

export type HintAxis = 'horizontal' | 'vertical';

interface Props {
  dismissed: boolean;
  open: boolean;
  onOpen: () => void;
  onDismiss: () => void;
  /** Which arrow axis the hint describes. Defaults to horizontal for
   *  backward compatibility with the stat-tab caller. */
  axis?: HintAxis;
}

export default function KeyboardHint({
  dismissed,
  open,
  onOpen,
  onDismiss,
  axis = 'horizontal',
}: Props) {
  if (dismissed) return null;

  const glyphFirst = axis === 'vertical' ? '↑' : '←';
  const glyphSecond = axis === 'vertical' ? '↓' : '→';

  return (
    <span
      className={clsx(
        styles.wrapper,
        axis === 'vertical' && styles.wrapperVertical,
        open && styles.wrapperOpen,
      )}
    >
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
            <kbd className={styles.key}>{glyphFirst}</kbd>
            <kbd className={styles.key}>{glyphSecond}</kbd>
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

/**
 * Hook version of the hint's dismissible state. Pass an axis to keep
 * horizontal and vertical hints on independent dismiss tracks.
 */
export function useKeyboardHint(axis: HintAxis = 'horizontal'): KeyboardHintState {
  const [open, setOpen] = useState(false);
  const storageKey = axis === 'vertical' ? STORAGE_KEY_VERTICAL : STORAGE_KEY_HORIZONTAL;
  const { isDismissed, dismiss } = useDismissible(storageKey);
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
