import styles from './ScopeChip.module.css';

export type ScopeKind = 'live' | 'period' | 'all-time';

interface Props {
  scope: ScopeKind;
  /** Override the rendered text. Defaults to the scope's canonical label
   *  (`live` / `period` / `all-time`). Pass a more specific label like
   *  `since signup` when the bare scope key is too generic for the
   *  surrounding section. */
  label?: string;
}

const DEFAULT_LABELS: Record<ScopeKind, string> = {
  live: 'live',
  period: 'period',
  'all-time': 'all-time',
};

/**
 * Tiny scope-attribution chip. Used in MemoryDetailView section headers
 * where a single surface mixes live (active sessions), period (selected
 * rolling window), and all-time (since first capture) scopes. Rendering
 * the scope inline answers "which clock does this section run on" without
 * drowning the section in prose.
 *
 * Other detail views (Activity, Codebase, Tools) are period-only and do
 * not render this chip.
 */
export default function ScopeChip({ scope, label }: Props) {
  return (
    <span className={styles.chip} data-scope={scope}>
      <span className={styles.dot} aria-hidden="true" />
      {label ?? DEFAULT_LABELS[scope]}
    </span>
  );
}
