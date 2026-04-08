import { type CSSProperties, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { getToolMeta } from '../../lib/toolMeta.js';
import { summarizeList } from '../../lib/summarize.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import {
  ShimmerText,
  SkeletonStatGrid,
  SkeletonRows,
} from '../../components/Skeleton/Skeleton.jsx';
import DirectoryRow from './DirectoryRow.jsx';
import ToolDetailView from './ToolDetailView.jsx';
import { useToolsViewData, arcPath, CX, CY, R, SW, type SortOption } from './useToolsViewData.js';
import styles from './ToolsView.module.css';

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

export default function ToolsView() {
  const {
    loading,
    evaluations,
    categories,
    categoryList,
    toolShare,
    knownToolShare,
    arcs,
    uniqueTools,
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
  const [hoveredTool, setHoveredTool] = useState<string | null>(null);
  const [hoveredDirId, setHoveredDirId] = useState<string | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  const shifted = !!selectedToolId;

  // Display state — only updated on hover-in, persists on hover-out for exit animation.
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

    // When demo video is playing, center the card vertically in the viewport.
    // The video experience takes priority over cursor proximity.
    if (showDemo) {
      return { left, top: '50%', bottom: 'auto', transform: 'translateY(-50%)' } as CSSProperties;
    }

    // Normal mode: stay near cursor. Upper half drops down, lower half grows up.
    if (pos.y < vh * 0.6) {
      return { left, top: pos.y, bottom: 'auto' } as CSSProperties;
    }
    return { left, bottom: vh - pos.y, top: 'auto' } as CSSProperties;
  }, [displayPos, showDemo]);

  // Scroll to top when entering/leaving detail view — scroll container is .main (parent), not window
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
      // S → Quick setup (future: trigger setup flow)
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hoveredDirId, selectTool]);

  if (loading && evaluations.length === 0 && toolShare.length === 0) {
    return (
      <div className={styles.page}>
        <section className={styles.header}>
          <ViewHeader eyebrow="Across projects" title="" />
          <ShimmerText as="h1" className={styles.heroTitle}>
            Loading your tools
          </ShimmerText>
          <SkeletonStatGrid count={3} />
        </section>
        <SkeletonRows count={4} columns={5} />
      </div>
    );
  }

  return (
    <div ref={pageRef} className={styles.page}>
      <div className={clsx(styles.track, shifted && styles.trackShifted)}>
        {/* ── List panel ── */}
        <div className={styles.listPanel}>
          <ViewHeader eyebrow="Across projects" title="Tools" />

          {/* ── Zone A: Your Stack ── */}
          {uniqueTools === 0 ? (
            <section className={styles.stackEmpty}>
              <div className={styles.stackEmptyRing}>
                <svg viewBox="0 0 260 260" className={styles.ringSvg}>
                  <circle
                    cx={CX}
                    cy={CY}
                    r={R}
                    fill="none"
                    stroke="var(--ghost)"
                    strokeWidth={SW}
                  />
                  <text
                    x={CX}
                    y={CY - 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="var(--soft)"
                    fontSize="28"
                    fontWeight="200"
                    fontFamily="var(--display)"
                    letterSpacing="-0.06em"
                  >
                    {toolShare.length > 0 ? toolShare.length : 0}
                  </text>
                  <text
                    x={CX}
                    y={CY + 16}
                    textAnchor="middle"
                    fill="var(--soft)"
                    fontSize="8.5"
                    fontFamily="var(--mono)"
                    letterSpacing="0.1em"
                  >
                    {toolShare.length > 0 ? 'UNIDENTIFIED' : 'CONFIGURED'}
                  </text>
                </svg>
              </div>
              <div className={styles.stackEmptyCopy}>
                <span className={styles.stackEmptyTitle}>
                  {toolShare.length > 0
                    ? `${toolShare.length} tool${toolShare.length === 1 ? '' : 's'} connected`
                    : 'No tools detected yet'}
                </span>
                <span className={styles.stackEmptyHint}>
                  {toolShare.length > 0 ? (
                    'Agents are connected but host tools were not identified. This resolves automatically on the next session.'
                  ) : (
                    <>
                      Your stack appears here once agents connect. Run <code>npx chinwag init</code>{' '}
                      in a project to get started.
                    </>
                  )}
                </span>
              </div>
            </section>
          ) : (
            <section className={styles.stackZone} onMouseLeave={() => setHoveredTool(null)}>
              {/* Ring chart */}
              {arcs.length > 0 && (
                <div className={styles.ringWrap}>
                  <svg viewBox="0 0 260 260" className={styles.ringSvg}>
                    {arcs.map((arc) => {
                      const meta = getToolMeta(arc.tool);
                      const dimmed = hoveredTool && hoveredTool !== arc.tool;
                      const highlighted = hoveredTool === arc.tool;
                      return (
                        <g
                          key={arc.tool}
                          style={{
                            opacity: dimmed ? 0.15 : 1,
                            transition: 'opacity 0.2s ease',
                          }}
                          onMouseEnter={() => setHoveredTool(arc.tool)}
                          onMouseLeave={() => setHoveredTool(null)}
                        >
                          <path
                            d={arcPath(CX, CY, R, arc.startDeg, arc.sweepDeg)}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={SW + 16}
                            style={{ cursor: 'pointer' }}
                          />
                          <path
                            d={arcPath(CX, CY, R, arc.startDeg, arc.sweepDeg)}
                            fill="none"
                            stroke={meta.color}
                            strokeWidth={SW}
                            strokeLinecap="round"
                            opacity={highlighted ? 1 : 0.8}
                            style={{ transition: 'opacity 0.2s ease' }}
                          />
                          {arc.labeled && (
                            <>
                              <path
                                d={`M ${arc.anchorX} ${arc.anchorY} L ${arc.elbowX} ${arc.elbowY} L ${arc.labelX} ${arc.labelY}`}
                                fill="none"
                                stroke="var(--faint)"
                                strokeWidth="1"
                                strokeDasharray="2 3"
                              />
                              <text
                                x={arc.labelX}
                                y={arc.labelY - 4}
                                textAnchor={arc.side === 'right' ? 'start' : 'end'}
                                fill={meta.color}
                                fontSize="16"
                                fontWeight="400"
                                fontFamily="var(--display)"
                                letterSpacing="-0.04em"
                              >
                                {Math.round(arc.share * 100)}%
                              </text>
                              <text
                                x={arc.labelX}
                                y={arc.labelY + 10}
                                textAnchor={arc.side === 'right' ? 'start' : 'end'}
                                fill="var(--muted)"
                                fontSize="9"
                                fontFamily="var(--sans)"
                                fontWeight="500"
                              >
                                {meta.label}
                              </text>
                            </>
                          )}
                        </g>
                      );
                    })}
                    <text
                      x={CX}
                      y={CY - 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="var(--ink)"
                      fontSize="28"
                      fontWeight="200"
                      fontFamily="var(--display)"
                      letterSpacing="-0.06em"
                    >
                      {uniqueTools}
                    </text>
                    <text
                      x={CX}
                      y={CY + 16}
                      textAnchor="middle"
                      fill="var(--muted)"
                      fontSize="8.5"
                      fontFamily="var(--mono)"
                      letterSpacing="0.1em"
                    >
                      CONFIGURED
                    </text>
                  </svg>
                </div>
              )}

              {/* Configured tools table */}
              <div className={styles.stackTable}>
                <div className={styles.stackColHeader}>
                  <span>Tool</span>
                  <span>Projects</span>
                  <span>Share</span>
                  <span>Sessions</span>
                </div>
                {knownToolShare.map((tool, i) => {
                  const meta = getToolMeta(tool.tool as string);
                  const toolId = tool.tool as string;
                  return (
                    <div
                      key={toolId}
                      className={clsx(
                        styles.stackRow,
                        hoveredTool && hoveredTool !== toolId && styles.stackRowDim,
                      )}
                      style={{ '--row-index': i } as CSSProperties}
                      onMouseEnter={() => setHoveredTool(toolId)}
                      onMouseLeave={() => setHoveredTool(null)}
                    >
                      <div className={styles.stackIdentity}>
                        <ToolIcon tool={toolId} size={20} />
                        <span className={styles.stackName}>{meta.label}</span>
                      </div>
                      <span className={styles.stackProjects}>
                        {summarizeList(tool.projects as string[])}
                      </span>
                      <span className={styles.stackShare}>{Math.round(tool.share * 100)}%</span>
                      <span className={styles.stackJoins}>{tool.value}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Zone B: Directory ── */}
          <section className={styles.directoryZone}>
            <div className={styles.directoryHeader}>
              <div className={styles.directoryTitleRow}>
                <h2 className={styles.directoryTitle}>Directory</h2>
                <span className={styles.directoryMeta}>
                  {filteredEvaluations.length} of {evaluations.length} tools
                </span>
              </div>

              <div className={styles.directoryControls}>
                {/* Primary row: toggle, verdict pills, search */}
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

                {/* Category row */}
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

            {/* Column headers */}
            <div className={styles.dirColHeader}>
              <span>Tool</span>
              <span>Status</span>
              <span>Stars</span>
              <span>Category</span>
              <span>Pricing</span>
              <span>Summary</span>
              <span></span>
            </div>

            {/* Directory list */}
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

        {/* ── Detail panel ── */}
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

      {/* Cursor-relative hover preview (always mounted for exit animation) */}
      {displayEval &&
        tooltipStyle &&
        (() => {
          const ev = displayEval;
          const meta = getToolMeta(ev.id);
          const md = (ev.metadata ?? {}) as Record<string, unknown>;

          // Rich fields — all gracefully absent when empty
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
              {/* 1. Header */}
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

              {/* 2. Strengths pills — the differentiators */}
              {strengths.length > 0 && (
                <div className={styles.tooltipStrengths}>
                  {strengths.map((s, i) => (
                    <span key={i} className={styles.tooltipStrength}>
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {/* 3. AI summary */}
              {aiSummary && <p className={styles.tooltipSummary}>{aiSummary}</p>}

              {/* 4. Metadata grid */}
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

              {/* 5. Demo video — toggled by D key */}
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

              {/* 6. Action bar — pinned to bottom */}
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
