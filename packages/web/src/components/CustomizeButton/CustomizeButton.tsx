import clsx from 'clsx';
import styles from './CustomizeButton.module.css';

interface Props {
  active?: boolean;
  onClick: () => void;
  label?: string;
}

export default function CustomizeButton({ active = false, onClick, label = 'Customize' }: Props) {
  return (
    <button
      type="button"
      className={clsx(styles.customizeBtn, active && styles.customizeBtnActive)}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
      <svg
        className={styles.customizeIcon}
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path
          d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
          stroke="none"
        />
        <path d="M20 3v4" fill="none" />
        <path d="M22 5h-4" fill="none" />
        <path d="M4 17v2" fill="none" />
        <path d="M5 18H3" fill="none" />
      </svg>
    </button>
  );
}
