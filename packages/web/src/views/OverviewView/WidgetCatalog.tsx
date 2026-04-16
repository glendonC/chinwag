import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import {
  WIDGET_CATALOG,
  CATEGORIES,
  getWidget,
  type WidgetViz,
  type WidgetCategory,
} from './widget-catalog.js';
import styles from './WidgetCatalog.module.css';

// ── Metadata labels ───────────────────────────────

const VIZ_LABELS: Record<WidgetViz, string> = {
  stat: 'Single stat',
  'stat-row': 'Stat row',
  sparkline: 'Trend line',
  'multi-sparkline': 'Multi-line trend',
  heatmap: 'Grid heatmap',
  'bar-chart': 'Bar chart',
  'proportional-bar': 'Proportional bar',
  'data-list': 'Data table',
  'outcome-bar': 'Outcome bar',
  'factual-grid': 'Fact grid',
  'sentiment-bars': 'Sentiment bars',
  'topic-bars': 'Topic bars',
  'project-list': 'Project list',
  'bucket-chart': 'Bucket chart',
  'live-list': 'Live presence',
};

const SIZE_LABELS: Record<number, string> = {
  3: 'Quarter width',
  4: 'Third width',
  6: 'Half width',
  8: 'Two-thirds width',
  12: 'Full width',
};

const DATA_KEY_LABELS: Record<string, string> = {
  daily_trends: 'Daily trends',
  token_usage: 'Token usage',
  completion_summary: 'Outcomes',
  file_heatmap: 'File activity',
  hourly_distribution: 'Hourly patterns',
  work_type_distribution: 'Work types',
  directory_heatmap: 'Directory activity',
  tool_comparison: 'Tool comparison',
  model_outcomes: 'Model outcomes',
  conversation: 'Conversations',
  memory_usage: 'Memory usage',
  member_analytics: 'Team members',
  dashboard: 'Dashboard data',
  stuckness: 'Stuckness',
  edit_velocity: 'Edit velocity',
  first_edit_stats: 'First edit timing',
  duration_distribution: 'Session durations',
  scope_complexity: 'Scope complexity',
  period_comparison: 'Period comparison',
  prompt_efficiency: 'Prompt efficiency',
  hourly_effectiveness: 'Hourly effectiveness',
  work_type_outcomes: 'Work type outcomes',
  file_churn: 'File churn',
  file_rework: 'File rework',
  audit_staleness: 'Audit staleness',
  concurrent_edits: 'Concurrent edits',
  tool_outcomes: 'Tool outcomes',
  tool_handoffs: 'Tool handoffs',
  tool_call_stats: 'Tool calls',
  memory_outcome_correlation: 'Memory vs outcomes',
  top_memories: 'Top memories',
  conflict_correlation: 'Conflict impact',
  retry_patterns: 'Retry patterns',
  conversation_edit_correlation: 'Conversation depth',
  tool_daily: 'Tool daily',
  tool_work_type: 'Tool work mix',
  data_coverage: 'Data coverage',
  file_overlap: 'File overlap',
};

// ── Mini SVG illustrations ────────────────────────

function VizIllustration({ viz }: { viz: WidgetViz }) {
  const fill = 'var(--ghost)';
  const stroke = 'var(--soft)';
  switch (viz) {
    case 'stat':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <rect x="24" y="12" width="52" height="24" rx="4" fill={fill} />
        </svg>
      );
    case 'sparkline':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <path
            d="M8 38 Q20 8, 32 24 T56 16 T80 20 T92 12"
            stroke={stroke}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'bar-chart':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <rect x="12" y="24" width="12" height="20" rx="2" fill={fill} />
          <rect x="28" y="12" width="12" height="32" rx="2" fill={fill} />
          <rect x="44" y="18" width="12" height="26" rx="2" fill={fill} />
          <rect x="60" y="8" width="12" height="36" rx="2" fill={fill} />
          <rect x="76" y="22" width="12" height="22" rx="2" fill={fill} />
        </svg>
      );
    case 'heatmap':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3, 4].map((c) => (
              <rect
                key={`${r}-${c}`}
                x={12 + c * 17}
                y={6 + r * 14}
                width="12"
                height="10"
                rx="2"
                fill={fill}
                opacity={0.3 + ((r * 5 + c) % 7) * 0.1}
              />
            )),
          )}
        </svg>
      );
    case 'data-list':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <rect x="8" y="8" width="84" height="7" rx="2" fill={fill} />
          <rect x="8" y="20" width="68" height="7" rx="2" fill={fill} />
          <rect x="8" y="32" width="76" height="7" rx="2" fill={fill} />
        </svg>
      );
    case 'stat-row':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <rect x="4" y="12" width="26" height="24" rx="4" fill={fill} />
          <rect x="36" y="12" width="26" height="24" rx="4" fill={fill} />
          <rect x="68" y="12" width="26" height="24" rx="4" fill={fill} />
        </svg>
      );
    case 'live-list':
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <circle cx="14" cy="24" r="3" fill={fill} />
          <rect x="22" y="21" width="24" height="6" rx="2" fill={fill} />
          <circle cx="58" cy="24" r="3" fill={fill} />
          <rect x="66" y="21" width="20" height="6" rx="2" fill={fill} />
        </svg>
      );
    default:
      return (
        <svg width="100" height="48" viewBox="0 0 100 48" fill="none">
          <rect x="16" y="8" width="68" height="32" rx="4" fill={fill} />
        </svg>
      );
  }
}

// ── Filter mode: what to show ─────────────────────

type ShowFilter = 'all' | 'active' | 'inactive';
const SHOW_LABELS: Record<ShowFilter, string> = {
  all: 'All',
  active: 'Active',
  inactive: 'Inactive',
};
const SHOW_CYCLE: ShowFilter[] = ['all', 'active', 'inactive'];

// ── Category icons ────────────────────────────────

const CAT_ICONS: Record<string, React.ReactNode> = {
  all: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="11" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="11" width="5" height="5" rx="1" />
      <rect x="11" y="11" width="5" height="5" rx="1" />
    </svg>
  ),
  live: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="9" r="2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="9" r="5" opacity="0.5" />
      <circle cx="9" cy="9" r="8" opacity="0.25" />
    </svg>
  ),
  usage: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="2,14 6,8 10,11 16,4" />
      <polyline points="12,4 16,4 16,8" />
    </svg>
  ),
  outcomes: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="9" r="7" />
      <path d="M6 9l2 2 4-4" />
    </svg>
  ),
  activity: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="1,9 4,9 6,4 8,14 10,7 12,9 17,9" />
    </svg>
  ),
  codebase: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="5,5 2,9 5,13" />
      <polyline points="13,5 16,9 13,13" />
      <line x1="10" y1="3" x2="8" y2="15" />
    </svg>
  ),
  tools: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.4 2.6a5 5 0 0 0-6.2 6.2L2 12l1 3 3 1 3.2-3.2a5 5 0 0 0 6.2-6.2L13 9l-2-1-1-2z" />
    </svg>
  ),
  conversations: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 14l1-3a6 6 0 1 1 3 3z" />
    </svg>
  ),
  memory: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="9" r="3" />
      <path d="M9 2v2" />
      <path d="M9 14v2" />
      <path d="M2 9h2" />
      <path d="M14 9h2" />
      <path d="M4 4l1.5 1.5" />
      <path d="M12.5 12.5L14 14" />
      <path d="M4 14l1.5-1.5" />
      <path d="M12.5 5.5L14 4" />
    </svg>
  ),
  team: (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6.5" cy="5.5" r="2.5" />
      <path d="M2 16v-1a4 4 0 0 1 4-4h1a4 4 0 0 1 4 4v1" />
      <circle cx="13" cy="6.5" r="2" />
      <path d="M13.5 11a3.5 3.5 0 0 1 3.5 3.5V16" />
    </svg>
  ),
};

// ── Component ─────────────────────────────────────

export function WidgetCatalog({
  open,
  onClose,
  widgetIds,
  toggleWidget,
  editing,
  setEditing,
  resetToDefault,
  clearAll,
}: {
  open: boolean;
  onClose: () => void;
  widgetIds: string[];
  toggleWidget: (id: string) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  resetToDefault: () => void;
  clearAll: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState<'all' | WidgetCategory>('all');
  const [showFilter, setShowFilter] = useState<ShowFilter>('all');
  const [showDescs, setShowDescs] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredWidgetId, setHoveredWidgetId] = useState<string | null>(null);
  const [displayWidgetId, setDisplayWidgetId] = useState<string | null>(null);
  const [displayPos, setDisplayPos] = useState<{ y: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [listFade, setListFade] = useState<'none' | 'top' | 'bottom' | 'both'>('none');

  // Reset state on open
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) {
    setActiveCategory('all');
    setShowFilter('all');
    setSearchOpen(false);
    setSearchQuery('');
    setHoveredWidgetId(null);
    setDisplayWidgetId(null);
  }
  if (open !== lastOpen) setLastOpen(open);

  // Focus search when opened
  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchOpen]);

  // Reset scroll on filter changes
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [activeCategory, searchQuery, showFilter]);

  const updateListFade = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const canUp = el.scrollTop > 0;
    const canDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setListFade(canUp && canDown ? 'both' : canUp ? 'top' : canDown ? 'bottom' : 'none');
  }, []);

  // Filter widgets
  const filteredWidgets = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return WIDGET_CATALOG.filter((w) => {
      if (activeCategory !== 'all' && w.category !== activeCategory) return false;
      if (showFilter === 'active' && !widgetIds.includes(w.id)) return false;
      if (showFilter === 'inactive' && widgetIds.includes(w.id)) return false;
      if (q && !w.name.toLowerCase().includes(q) && !w.description.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [searchQuery, activeCategory, showFilter, widgetIds]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const cat of CATEGORIES) {
      const n = WIDGET_CATALOG.filter((w) => w.category === cat.id).length;
      counts[cat.id] = n;
      total += n;
    }
    counts.all = total;
    return counts;
  }, []);

  // Cycle show filter
  const cycleShowFilter = useCallback(() => {
    setShowFilter((prev) => {
      const idx = SHOW_CYCLE.indexOf(prev);
      return SHOW_CYCLE[(idx + 1) % SHOW_CYCLE.length];
    });
  }, []);

  // Cycle category with arrows
  const allCatIds: Array<'all' | WidgetCategory> = useMemo(
    () => ['all', ...CATEGORIES.map((c) => c.id)],
    [],
  );
  const cycleCategory = useCallback(
    (dir: 1 | -1) => {
      setActiveCategory((prev) => {
        const idx = allCatIds.indexOf(prev);
        const next = (idx + dir + allCatIds.length) % allCatIds.length;
        return allCatIds[next];
      });
    },
    [allCatIds],
  );

  // Hover handler
  const handleRowHover = useCallback((widgetId: string | null, rowElement?: HTMLElement) => {
    setHoveredWidgetId(widgetId);
    if (widgetId && rowElement) {
      const rect = rowElement.getBoundingClientRect();
      setDisplayWidgetId(widgetId);
      setDisplayPos({ y: rect.top + rect.height / 2 });
    }
  }, []);

  // Tooltip positioning — left of panel, or above if clipped
  const [panelRect, setPanelRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (panelRef.current) setPanelRect(panelRef.current.getBoundingClientRect());
  }, [open, filteredWidgets.length]);

  // Subscribe to list/content size changes via ResizeObserver. RO fires
  // immediately on observe() and again whenever the list or its children
  // resize, so fade state stays in sync without calling setState directly
  // from the effect body. Re-attaches when the filter/content set changes.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => updateListFade());
    obs.observe(el);
    for (const child of Array.from(el.children)) obs.observe(child);
    return () => obs.disconnect();
  }, [open, updateListFade, filteredWidgets.length, showDescs]);

  const tooltipStyle = useMemo(() => {
    if (!displayPos || !panelRect) return { display: 'none' } as CSSProperties;
    const tooltipW = 320;
    const gap = 12;
    const vh = window.innerHeight;
    const leftPos = panelRect.left - tooltipW - gap;

    if (leftPos > 16) {
      const top = Math.max(16, Math.min(displayPos.y - 120, vh - 280));
      return { left: leftPos, top } as CSSProperties;
    }
    return {
      right: 24,
      bottom: 64 + 420 + gap,
      width: 440,
    } as CSSProperties;
  }, [displayPos, panelRect]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't capture when typing in search
      if (e.target instanceof HTMLInputElement) {
        if (e.key === 'Escape') {
          setSearchOpen(false);
          setSearchQuery('');
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          onClose();
          e.preventDefault();
          break;
        case 'r':
        case 'R':
          setEditing(!editing);
          e.preventDefault();
          break;
        case 'v':
        case 'V':
          resetToDefault();
          e.preventDefault();
          break;
        case 'c':
        case 'C':
          clearAll();
          e.preventDefault();
          break;
        case 'd':
        case 'D':
          setShowDescs((p) => !p);
          e.preventDefault();
          break;
        case '/':
          setSearchOpen((p) => !p);
          if (!searchOpen) setSearchQuery('');
          e.preventDefault();
          break;
        case 'Tab':
          cycleShowFilter();
          e.preventDefault();
          break;
        case 'ArrowLeft':
          cycleCategory(-1);
          e.preventDefault();
          break;
        case 'ArrowRight':
          cycleCategory(1);
          e.preventDefault();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    open,
    onClose,
    editing,
    setEditing,
    resetToDefault,
    clearAll,
    searchOpen,
    cycleShowFilter,
    cycleCategory,
  ]);

  if (!open) return null;

  const showTooltip = !!hoveredWidgetId;
  const displayWidget = displayWidgetId ? getWidget(displayWidgetId) : null;

  return createPortal(
    <>
      {/* ── Search bar (above panel, invoked with /) ── */}
      {searchOpen && (
        <div className={styles.searchBar} style={{ bottom: 64 + 420 + 8 }}>
          <svg
            className={styles.searchIcon}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <circle cx="6.5" cy="6.5" r="5" />
            <path d="M10.5 10.5 L14.5 14.5" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            className={styles.searchInput}
            placeholder="Search widgets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span className={styles.searchHint}>Esc to close</span>
        </div>
      )}

      {/* ── Widget Panel ── */}
      <div className={styles.panel} ref={panelRef}>
        {/* Category icons with arrow nav */}
        <div className={styles.panelCats}>
          <button type="button" className={styles.panelCatArrow} onClick={() => cycleCategory(-1)}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8.5 3 L4.5 7 L8.5 11" />
            </svg>
          </button>
          <button
            type="button"
            className={clsx(styles.panelCat, activeCategory === 'all' && styles.panelCatActive)}
            onClick={() => setActiveCategory('all')}
            data-label="All"
          >
            <span className={styles.panelCatIcon}>{CAT_ICONS.all}</span>
          </button>
          {CATEGORIES.map((cat) => {
            const n = categoryCounts[cat.id] ?? 0;
            if (n === 0) return null;
            return (
              <button
                key={cat.id}
                type="button"
                className={clsx(
                  styles.panelCat,
                  activeCategory === cat.id && styles.panelCatActive,
                )}
                onClick={() => setActiveCategory(cat.id)}
                data-label={cat.label}
              >
                <span className={styles.panelCatIcon}>{CAT_ICONS[cat.id] ?? CAT_ICONS.all}</span>
              </button>
            );
          })}
          <button type="button" className={styles.panelCatArrow} onClick={() => cycleCategory(1)}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5.5 3 L9.5 7 L5.5 11" />
            </svg>
          </button>
        </div>

        {/* Widget list */}
        <div
          className={clsx(
            styles.panelList,
            listFade === 'top' && styles.panelListFadeTop,
            listFade === 'bottom' && styles.panelListFadeBottom,
            listFade === 'both' && styles.panelListFadeBoth,
          )}
          ref={listRef}
          onScroll={updateListFade}
        >
          {filteredWidgets.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyText}>No widgets match.</span>
            </div>
          ) : (
            filteredWidgets.map((w) => {
              const active = widgetIds.includes(w.id);
              return (
                <div
                  key={w.id}
                  className={styles.panelRow}
                  onClick={() => toggleWidget(w.id)}
                  onMouseEnter={(e) => handleRowHover(w.id, e.currentTarget)}
                  onMouseLeave={() => handleRowHover(null)}
                >
                  <div className={styles.panelRowInfo}>
                    <div className={styles.panelRowName}>{w.name}</div>
                    {showDescs && <div className={styles.panelRowDesc}>{w.description}</div>}
                  </div>
                  <button
                    type="button"
                    className={clsx(styles.toggle, active && styles.toggleOn)}
                    aria-label={active ? `Remove ${w.name}` : `Add ${w.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleWidget(w.id);
                    }}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Hover Tooltip (left of panel) ── */}
      {displayWidget && (
        <div
          className={clsx(styles.tooltip, showTooltip && styles.tooltipVisible)}
          style={tooltipStyle}
          aria-hidden="true"
        >
          <span className={styles.tooltipName}>{displayWidget.name}</span>
          <p className={styles.tooltipDesc}>{displayWidget.description}</p>
          <div className={styles.tooltipMeta}>
            <div>
              <span className={styles.tooltipMetaLabel}>Type</span>
              <div className={styles.tooltipMetaValue}>{VIZ_LABELS[displayWidget.viz]}</div>
            </div>
            <div>
              <span className={styles.tooltipMetaLabel}>Size</span>
              <div className={styles.tooltipMetaValue}>
                {SIZE_LABELS[displayWidget.w] ?? `${displayWidget.w} cols`}
              </div>
            </div>
            {displayWidget.dataKeys[0] && (
              <div>
                <span className={styles.tooltipMetaLabel}>Data</span>
                <div className={styles.tooltipMetaValue}>
                  {DATA_KEY_LABELS[displayWidget.dataKeys[0]] ?? displayWidget.dataKeys[0]}
                </div>
              </div>
            )}
          </div>
          <div className={styles.tooltipIllustration}>
            <VizIllustration viz={displayWidget.viz} />
          </div>
          <span
            className={clsx(
              styles.tooltipStatus,
              widgetIds.includes(displayWidget.id) && styles.tooltipStatusActive,
            )}
          >
            {widgetIds.includes(displayWidget.id) ? 'On dashboard' : 'Not on dashboard'}
          </span>
        </div>
      )}

      {/* ── Command Strip ── */}
      <div className={styles.strip}>
        <button type="button" className={styles.stripAction} onClick={onClose}>
          Done <kbd className={styles.kbd}>Esc</kbd>
        </button>
        <span className={styles.stripDivider} />
        <button
          type="button"
          className={clsx(styles.stripAction, editing && styles.stripActionActive)}
          onClick={() => setEditing(!editing)}
        >
          Rearrange <kbd className={styles.kbd}>R</kbd>
        </button>
        <span className={styles.stripDivider} />
        <button
          type="button"
          className={clsx(styles.stripAction, !showDescs && styles.stripActionActive)}
          onClick={() => setShowDescs((p) => !p)}
        >
          {showDescs ? 'Hide details' : 'Show details'} <kbd className={styles.kbd}>D</kbd>
        </button>
        <span className={styles.stripDivider} />
        <button
          type="button"
          className={clsx(styles.stripAction, showFilter !== 'all' && styles.stripActionActive)}
          onClick={cycleShowFilter}
        >
          {SHOW_LABELS[showFilter]} <kbd className={styles.kbd}>Tab</kbd>
        </button>
        <span className={styles.stripDivider} />
        <button
          type="button"
          className={clsx(styles.stripAction, searchOpen && styles.stripActionActive)}
          onClick={() => {
            setSearchOpen((p) => !p);
            if (!searchOpen) setSearchQuery('');
          }}
        >
          Search <kbd className={styles.kbd}>/</kbd>
        </button>
        <span className={styles.stripDivider} />
        <button type="button" className={styles.stripAction} onClick={clearAll}>
          Clear <kbd className={styles.kbd}>C</kbd>
        </button>
        <span className={styles.stripDivider} />
        <button type="button" className={styles.stripAction} onClick={resetToDefault}>
          Reset <kbd className={styles.kbd}>V</kbd>
        </button>
      </div>
    </>,
    document.body,
  );
}
