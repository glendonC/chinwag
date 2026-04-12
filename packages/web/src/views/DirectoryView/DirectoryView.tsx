// Tool directory — browsable catalog of all supported tools.
// Sibling top-level route to /tools. Reuses the existing useToolsViewData hook
// for the catalog data and the existing DirectoryRow / ToolDetailView components.

import { type CSSProperties, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { getToolMeta } from '../../lib/toolMeta.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import { ShimmerText, SkeletonRows } from '../../components/Skeleton/Skeleton.jsx';
import DirectoryRow from './DirectoryRow.jsx';
import ToolDetailView from './ToolDetailView.jsx';
import { useToolsViewData, type SortOption } from '../ToolsView/useToolsViewData.js';
import styles from './DirectoryView.module.css';

const VERDICT_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'integrated', label: 'Supported' },
  { value: 'installable', label: 'Available' },
  { value: 'listed', label: 'Coming soon' },
] as const;

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'score', label: 'Recommended' },
  { value: 'stars', label: 'Most starred' },
  { value: 'name', label: 'A\u2013Z' },
];

const INITIAL_COUNT = 15;

export default function DirectoryView() {
  const {
    loading,
    evaluations,
    categories,
    categoryList,
    filteredEvaluations,
    activeCategory,
    setActiveCategory,
    activeVerdict,
    setActiveVerdict,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    selectedToolId,
    selectedEvaluation,
    selectTool,
    showAll,
    setShowAll,
    hideConfigured,
    setHideConfigured,
    isConfigured,
  } = useToolsViewData();

  const pageRef = useRef<HTMLDivElement>(null);
  const [hoveredDirId, setHoveredDirId] = useState<string | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  const shifted = !!selectedToolId;

  const [displayEvalId, setDisplayEvalId] = useState<string | null>(null);
  const [displayPos, setDisplayPos] = useState<{ x: number; y: number } | null>(null);

  const handleDirHover = useCallback((evalId: string | null, x?: number, y?: number) => {
    setHoveredDirId(evalId);
    setShowDemo(false);
    if (evalId && x != null && y != null) {
      setDisplayEvalId(evalId);
      setDisplayPos({ x, y });
    }
  }, []);

  const showTooltip = !!hoveredDirId;
  const displayEval = displayEvalId
    ? (evaluations.find((e) => e.id === displayEvalId) ?? null)
    : null;

  // Position tooltip near cursor, clamped to viewport
  const tooltipStyle = useMemo(() => {
    const pos = displayPos;
    if (!pos) return undefined;
    const w = 400;
    const gap = 24;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1400;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    let left = pos.x + gap;
    if (left + w > vw - 16) left = pos.x - gap - w;

    if (showDemo) {
      return { left, top: '50%', bottom: 'auto', transform: 'translateY(-50%)' } as CSSProperties;
    }

    if (pos.y < vh * 0.6) {
      return { left, top: pos.y, bottom: 'auto' } as CSSProperties;
    }
    return { left, bottom: vh - pos.y, top: 'auto' } as CSSProperties;
  }, [displayPos, showDemo]);

  // Scroll to top when entering/leaving detail view
  useEffect(() => {
    let el = pageRef.current?.parentElement;
    while (el) {
      const { overflowY } = getComputedStyle(el);
      if (overflowY === 'auto' || overflowY === 'scroll') {
        el.scrollTop = 0;
        break;
      }
      el = el.parentElement;
    }
  }, [shifted]);

  // Escape key closes detail view
  useEffect(() => {
    if (!shifted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selectTool(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shifted, selectTool]);

  // Keyboard shortcuts for hovered directory tool
  useEffect(() => {
    if (!hoveredDirId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Enter') {
        selectTool(hoveredDirId);
        e.preventDefault();
      }
      if (e.key === 'd' || e.key === 'D') {
        setShowDemo((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hoveredDirId, selectTool]);

  if (loading && evaluations.length === 0) {
    return (
      <div className={styles.page}>
        <section className={styles.header}>
          <span className={styles.loadingEyebrow}>Browse</span>
          <ShimmerText as="h1" className={styles.loadingTitle}>
            Loading directory
          </ShimmerText>
        </section>
        <SkeletonRows count={5} columns={5} />
      </div>
    );
  }

  return (
    <div ref={pageRef} className={styles.page}>
      <div className={clsx(styles.track, shifted && styles.trackShifted)}>
        <div className={styles.listPanel}>
          <ViewHeader eyebrow="Browse" title="Directory" />

          <section className={styles.directoryZone}>
            <div className={styles.directoryHeader}>
              <div className={styles.directoryTitleRow}>
                <span className={styles.directoryMeta}>
                  {filteredEvaluations.length} of {evaluations.length} tools
                </span>
              </div>

              <div className={styles.directoryControls}>
                <div className={styles.filterRow}>
                  <button
                    className={clsx(styles.toggle, hideConfigured && styles.toggleOn)}
                    onClick={() => setHideConfigured(!hideConfigured)}
                    type="button"
                  >
                    <span className={styles.toggleTrack}>
                      <span className={styles.toggleThumb} />
                    </span>
                    Hide my tools
                  </button>

                  <div className={styles.verdictPills}>
                    {VERDICT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        className={clsx(
                          styles.verdictPill,
                          activeVerdict === opt.value && styles.verdictPillActive,
                        )}
                        onClick={() => setActiveVerdict(opt.value)}
                        type="button"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <select
                    className={styles.sortSelect}
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    className={styles.searchInput}
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                {categoryList.length > 0 && (
                  <div className={styles.categoryRow}>
                    <span className={styles.categoryLabel}>Category</span>
                    <button
                      className={clsx(
                        styles.categoryChip,
                        activeCategory === 'all' && styles.categoryChipActive,
                      )}
                      onClick={() => setActiveCategory('all')}
                      type="button"
                    >
                      All
                    </button>
                    {categoryList.map(([id, label]) => (
                      <button
                        key={id}
                        className={clsx(
                          styles.categoryChip,
                          activeCategory === id && styles.categoryChipActive,
                        )}
                        onClick={() => setActiveCategory(id)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.dirColHeader}>
              <span>Tool</span>
              <span>Status</span>
              <span>Stars</span>
              <span>Category</span>
              <span>Pricing</span>
              <span>Summary</span>
              <span></span>
            </div>

            <div className={styles.directoryList}>
              {(showAll ? filteredEvaluations : filteredEvaluations.slice(0, INITIAL_COUNT)).map(
                (ev) => (
                  <DirectoryRow
                    key={ev.id}
                    evaluation={ev}
                    categories={categories}
                    onSelect={() => selectTool(ev.id)}
                    onHoverChange={handleDirHover}
                  />
                ),
              )}
              {filteredEvaluations.length === 0 && (
                <div className={styles.emptyState}>
                  <span className={styles.emptyStateTitle}>No tools found</span>
                  <span className={styles.emptyStateHint}>
                    Try adjusting your filters or search to find what you&apos;re looking for.
                  </span>
                </div>
              )}
              {!showAll && filteredEvaluations.length > INITIAL_COUNT && (
                <button className={styles.showMoreButton} onClick={() => setShowAll(true)}>
                  Show {filteredEvaluations.length - INITIAL_COUNT} more tools
                </button>
              )}
              {showAll && filteredEvaluations.length > INITIAL_COUNT && (
                <button className={styles.showMoreButton} onClick={() => setShowAll(false)}>
                  Show less
                </button>
              )}
            </div>
          </section>
        </div>

        <div className={styles.detailPanel}>
          {selectedEvaluation && (
            <ToolDetailView
              evaluation={selectedEvaluation}
              categories={categories}
              isConfigured={isConfigured(selectedEvaluation.id)}
              onBack={() => selectTool(null)}
            />
          )}
        </div>
      </div>

      {/* Cursor-relative hover preview */}
      {displayEval &&
        tooltipStyle &&
        (() => {
          const ev = displayEval;
          const meta = getToolMeta(ev.id);
          const md = (ev.metadata ?? {}) as Record<string, unknown>;

          const aiSummary = typeof md.ai_summary === 'string' ? md.ai_summary : ev.tagline || '';
          const strengths = Array.isArray(md.strengths)
            ? (md.strengths as string[]).slice(0, 3)
            : [];
          const integrationType =
            typeof md.integration_type === 'string' ? md.integration_type : '';
          const platform = Array.isArray(md.platform) ? (md.platform as string[]) : [];
          const isOss = md.open_source === true || (typeof md.github === 'string' && !!md.github);
          const githubStars = typeof md.github_stars === 'number' ? md.github_stars : null;
          const freshness = typeof md.last_updated === 'string' ? md.last_updated : '';
          const demoUrl = typeof md.demo_url === 'string' ? md.demo_url : '';

          return (
            <div
              className={clsx(
                styles.tooltip,
                showTooltip && styles.tooltipVisible,
                showDemo && demoUrl && styles.tooltipInteractive,
              )}
              style={
                {
                  ...tooltipStyle,
                  '--tool-color': (md.brand_color as string) || meta.color,
                } as CSSProperties
              }
              aria-hidden="true"
            >
              <div className={styles.tooltipHeader}>
                <ToolIcon
                  tool={ev.id}
                  website={md.website as string | undefined}
                  iconUrl={md.icon_url as string | undefined}
                  favicon={md.favicon as string | undefined}
                  brandColor={md.brand_color as string | undefined}
                  size={28}
                />
                <span className={styles.tooltipName}>{ev.name || meta.label}</span>
              </div>

              {strengths.length > 0 && (
                <div className={styles.tooltipStrengths}>
                  {strengths.map((s, i) => (
                    <span key={i} className={styles.tooltipStrength}>
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {aiSummary && <p className={styles.tooltipSummary}>{aiSummary}</p>}

              <div className={styles.tooltipMeta}>
                {integrationType && (
                  <div className={styles.tooltipMetaItem}>
                    <span className={styles.tooltipMetaLabel}>Type</span>
                    <span className={styles.tooltipMetaValue}>{integrationType}</span>
                  </div>
                )}
                {platform.length > 0 && (
                  <div className={styles.tooltipMetaItem}>
                    <span className={styles.tooltipMetaLabel}>Platform</span>
                    <span className={styles.tooltipMetaValue}>{platform.join(', ')}</span>
                  </div>
                )}
                {isOss && (
                  <div className={styles.tooltipMetaItem}>
                    <span className={styles.tooltipMetaLabel}>Open source</span>
                    <span className={styles.tooltipMetaValue}>
                      {githubStars != null
                        ? `${githubStars >= 1000 ? `${(githubStars / 1000).toFixed(1)}k` : githubStars} stars`
                        : 'Yes'}
                    </span>
                  </div>
                )}
                {freshness && (
                  <div className={styles.tooltipMetaItem}>
                    <span className={styles.tooltipMetaLabel}>Updated</span>
                    <span className={styles.tooltipMetaValue}>{freshness}</span>
                  </div>
                )}
              </div>

              {showDemo && demoUrl && (
                <div className={styles.tooltipDemo}>
                  {demoUrl.includes('youtube.com') || demoUrl.includes('youtu.be') ? (
                    <iframe
                      src={`${demoUrl
                        .replace('youtube.com/watch?v=', 'youtube.com/embed/')
                        .replace('youtu.be/', 'youtube.com/embed/')}?autoplay=1&rel=0`}
                      className={styles.tooltipDemoEmbed}
                      allow="accelerometer; autoplay; encrypted-media; gyroscope"
                      allowFullScreen
                      title="Product demo"
                    />
                  ) : (
                    <a
                      href={demoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.tooltipDemoLink}
                    >
                      Watch demo
                    </a>
                  )}
                </div>
              )}

              <div className={styles.tooltipActions}>
                <span className={styles.tooltipAction}>
                  <kbd className={styles.kbd}>Enter</kbd> View details
                </span>
                {demoUrl && (
                  <span className={styles.tooltipAction}>
                    <kbd className={styles.kbd}>D</kbd> {showDemo ? 'Hide demo' : 'Watch demo'}
                  </span>
                )}
                <span className={clsx(styles.tooltipAction, styles.tooltipActionDisabled)}>
                  <kbd className={styles.kbd}>S</kbd> Quick setup
                </span>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
