import { type CSSProperties, useState, useEffect } from 'react';
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
import { useToolsViewData, arcPath, CX, CY, R, SW } from './useToolsViewData.js';
import styles from './ToolsView.module.css';

const VERDICT_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'integrated', label: 'Integrated' },
  { value: 'installable', label: 'Installable' },
  { value: 'listed', label: 'Listed' },
] as const;

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
    selectedToolId,
    selectedEvaluation,
    selectTool,
    showAll,
    setShowAll,
    hideConfigured,
    setHideConfigured,
  } = useToolsViewData();

  const [hoveredTool, setHoveredTool] = useState<string | null>(null);
  const shifted = !!selectedToolId;

  // Escape key closes detail view
  useEffect(() => {
    if (!shifted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selectTool(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shifted, selectTool]);

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
    <div className={styles.page}>
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
                    Hide configured
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
              <span>Verdict</span>
              <span>Pricing</span>
              <span>Category</span>
              <span>Setup</span>
              <span>Summary</span>
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
                  />
                ),
              )}
              {filteredEvaluations.length === 0 && (
                <p className={styles.emptyHint}>No tools match the current filters.</p>
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
              onBack={() => selectTool(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
