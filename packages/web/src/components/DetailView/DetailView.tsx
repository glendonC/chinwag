import type { CSSProperties, Dispatch, ReactNode, RefObject, SetStateAction } from 'react';
import clsx from 'clsx';
import DetailHeader from '../DetailHeader/DetailHeader.js';
import KeyboardHint, { type useKeyboardHint } from '../KeyboardHint/KeyboardHint.jsx';
import styles from './DetailView.module.css';

type KeyboardHintState = ReturnType<typeof useKeyboardHint>;

export interface DetailTabDef<T extends string> {
  id: T;
  label: string;
  /** Large stat value rendered beneath the label. */
  value: ReactNode;
  /** Opt-in accent color for live data. Omit for historical views. */
  tone?: 'accent';
}

export interface TabControl<T extends string> {
  activeTab: T;
  setActiveTab: Dispatch<SetStateAction<T>>;
  hint: KeyboardHintState;
  ref: RefObject<HTMLDivElement | null>;
}

interface Props<T extends string> {
  backLabel: string;
  onBack: () => void;
  title: string;
  subtitle?: string;
  /** Right-aligned slot on the scope row — typically RangePills. */
  actions?: ReactNode;
  tabs: ReadonlyArray<DetailTabDef<T>>;
  /** Returned by `useTabs(...)` at the call site. Keeping the hook at
   *  the parent means parents can run side-effects keyed off the
   *  active tab (focus scroll, deep-link sync) without DetailView
   *  reaching back up. */
  tabControl: TabControl<T>;
  /** Used for aria-controls wiring: `${idPrefix}-panel-${tab.id}`. */
  idPrefix: string;
  /** aria-label for the tablist. e.g. "Usage sections". */
  tablistLabel: string;
  /** Tight panel spacing for views dominated by a single table.
   *  Default (false) gives multi-section historical views 40px between
   *  sections; compact gives 14px. */
  panelCompact?: boolean;
  children: ReactNode;
}

/**
 * Shared shell for drilled-in detail views. Owns the three pieces every
 * detail view duplicates today: header (back link + title + subtitle
 * + optional actions), tab bar (grid of label + big stat value
 * buttons), and the tabpanel wrapper. Callers render panel content
 * as children.
 *
 * Example:
 * ```tsx
 * const TABS = ['sessions', 'edits', 'cost'] as const;
 * const tabControl = useTabs(TABS, initialTab);
 *
 * <DetailView
 *   backLabel="Overview"
 *   onBack={onBack}
 *   title="usage"
 *   subtitle={scopeSubtitle}
 *   actions={<RangePills .../>}
 *   tabs={[
 *     { id: 'sessions', label: 'Sessions', value: '124' },
 *     { id: 'edits',    label: 'Edits',    value: '512' },
 *     { id: 'cost',     label: 'Cost',     value: '$12.40' },
 *   ]}
 *   tabControl={tabControl}
 *   idPrefix="usage"
 *   tablistLabel="Usage sections"
 * >
 *   {tabControl.activeTab === 'sessions' && <SessionsPanel .../>}
 *   {tabControl.activeTab === 'edits' && <EditsPanel .../>}
 *   {tabControl.activeTab === 'cost' && <CostPanel .../>}
 * </DetailView>
 * ```
 */
export default function DetailView<T extends string>({
  backLabel,
  onBack,
  title,
  subtitle,
  actions,
  tabs,
  tabControl,
  idPrefix,
  tablistLabel,
  panelCompact = false,
  children,
}: Props<T>) {
  const { activeTab, setActiveTab, hint, ref } = tabControl;
  const count = tabs.length;

  return (
    <div className={styles.detail}>
      <DetailHeader
        backLabel={backLabel}
        onBack={onBack}
        title={title}
        subtitle={subtitle}
        actions={actions}
      />

      <div
        className={styles.tabsRow}
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
              aria-controls={`${idPrefix}-panel-${t.id}`}
              data-tab={t.id}
              tabIndex={isActive ? 0 : -1}
              className={clsx(styles.tabButton, isActive && styles.tabActive)}
              style={{ '--tab-index': i } as CSSProperties}
              onClick={(e) => {
                e.currentTarget.focus();
                setActiveTab(t.id);
              }}
            >
              <span className={styles.tabLabel}>
                {t.label}
                {isActive && <KeyboardHint {...hint} />}
              </span>
              <span className={clsx(styles.tabValue, t.tone === 'accent' && styles.tabAccent)}>
                {t.value}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={clsx(styles.panel, panelCompact && styles.panelCompact)}
        role="tabpanel"
        id={`${idPrefix}-panel-${activeTab}`}
      >
        {children}
      </div>
    </div>
  );
}

export { styles as detailViewStyles };
