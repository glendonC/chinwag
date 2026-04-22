import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';
import KeyboardHint from '../KeyboardHint/KeyboardHint.jsx';
import type { TabControl } from '../DetailView/DetailView.js';
import styles from './StatTabs.module.css';

export interface StatTabDef<T extends string> {
  id: T;
  label: string;
  /** Large stat value rendered beneath the label. */
  value: ReactNode;
  /** Opt-in accent color for live data. Omit for historical views. */
  tone?: 'accent' | '';
}

interface Props<T extends string> {
  tabs: ReadonlyArray<StatTabDef<T>>;
  /** Returned by `useTabs(...)` at the call site. */
  tabControl: TabControl<T>;
  /** aria-label for the tablist (e.g. "Project sections"). */
  tablistLabel: string;
  /** Optional id prefix for `aria-controls` wiring. When provided each
   *  tab points at `${idPrefix}-panel-${tab.id}`. */
  idPrefix?: string;
}

/**
 * Canonical "uppercase mono label / large display value" tab row.
 * Single source of truth for ProjectView's hero strip and DetailView's
 * stat strip — both surfaces render the same shape at the same scale.
 *
 * Value font-size is locked at 2.25rem regardless of tab count. Density
 * on narrow viewports is solved by grid wrapping in CSS, not by
 * shrinking typography per count.
 */
export default function StatTabs<T extends string>({
  tabs,
  tabControl,
  tablistLabel,
  idPrefix,
}: Props<T>) {
  const { activeTab, setActiveTab, hint, ref } = tabControl;
  const count = tabs.length;

  return (
    <div
      className={styles.row}
      ref={ref}
      role="tablist"
      aria-label={tablistLabel}
      data-count={count}
    >
      {tabs.map((t, i) => {
        const isActive = activeTab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={idPrefix ? `${idPrefix}-panel-${t.id}` : undefined}
            data-tab={t.id}
            tabIndex={isActive ? 0 : -1}
            className={clsx(styles.button, isActive && styles.active)}
            style={{ '--idx': i } as CSSProperties}
            onClick={(e) => {
              e.currentTarget.focus();
              setActiveTab(t.id);
            }}
          >
            <span className={styles.label}>
              {t.label}
              {isActive && <KeyboardHint {...hint} />}
            </span>
            <span className={clsx(styles.value, t.tone === 'accent' && styles.accent)}>
              {t.value}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export type { TabControl };
