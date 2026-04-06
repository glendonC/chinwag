import { type CSSProperties } from 'react';
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
    arcs,
    uniqueTools,
    filteredEvaluations,
    activeCategory,
    setActiveCategory,
    activeVerdict,
    setActiveVerdict,
    searchQuery,
    setSearchQuery,
    expandedId,
    setExpandedId,
    showAll,
    setShowAll,
    hideConfigured,
    setHideConfigured,
    isConfigured,
  } = useToolsViewData();

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
      <ViewHeader eyebrow="Across projects" title="Tools" />

      {/* ── Zone A: Your Stack ── */}
      {uniqueTools === 0 ? (
        <section className={styles.stackEmpty}>
          <div className={styles.stackEmptyRing}>
            <svg viewBox="0 0 260 260" className={styles.ringSvg}>
              <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--ghost)" strokeWidth={SW} />
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
                  Your stack appears here once agents connect. Run <code>npx chinwag init</code> in
                  a project to get started.
                </>
              )}
            </span>
          </div>
        </section>
      ) : (
        <section className={styles.stackZone}>
          {/* Ring chart */}
          {arcs.length > 0 && (
            <div className={styles.ringWrap}>
              <svg viewBox="0 0 260 260" className={styles.ringSvg}>
                {arcs.map((arc) => {
                  const meta = getToolMeta(arc.tool);
                  return (
                    <g key={arc.tool}>
                      <path
                        d={arcPath(CX, CY, R, arc.startDeg, arc.sweepDeg)}
                        fill="none"
                        stroke={meta.color}
                        strokeWidth={SW}
                        strokeLinecap="round"
                        opacity="0.8"
                      />
                      <line
                        x1={arc.anchorX}
                        y1={arc.anchorY}
                        x2={arc.labelX}
                        y2={arc.labelY}
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

          {/* Configured tools list */}
          <div className={styles.stackList}>
            {toolShare.map((tool, i) => {
              const meta = getToolMeta(tool.tool as string);
              return (
                <div
                  key={tool.tool as string}
                  className={styles.stackRow}
                  style={{ '--row-index': i } as CSSProperties}
                >
                  <div className={styles.stackIdentity}>
                    <ToolIcon tool={tool.tool as string} size={20} />
                    <div className={styles.stackCopy}>
                      <span className={styles.stackName}>{meta.label}</span>
                      <span className={styles.stackProjects}>
                        {summarizeList(tool.projects as string[])}
                      </span>
                    </div>
                  </div>
                  <span className={styles.stackShare}>{Math.round(tool.share * 100)}%</span>
                  <span className={styles.stackJoins}>
                    {tool.value} session{tool.value === 1 ? '' : 's'}
                  </span>
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
            <div className={styles.filterRow}>
              {/* Stack filter — key differentiator */}
              <button
                className={clsx(styles.filterButton, hideConfigured && styles.filterButtonActive)}
                onClick={() => setHideConfigured(!hideConfigured)}
              >
                Not configured
              </button>
              <span className={styles.filterDivider} />
              {VERDICT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={clsx(
                    styles.filterButton,
                    activeVerdict === opt.value && styles.filterButtonActive,
                  )}
                  onClick={() => setActiveVerdict(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
              {categoryList.length > 0 && (
                <>
                  <span className={styles.filterDivider} />
                  <button
                    className={clsx(
                      styles.filterButton,
                      activeCategory === 'all' && styles.filterButtonActive,
                    )}
                    onClick={() => setActiveCategory('all')}
                  >
                    All categories
                  </button>
                  {categoryList.map(([id, label]) => (
                    <button
                      key={id}
                      className={clsx(
                        styles.filterButton,
                        activeCategory === id && styles.filterButtonActive,
                      )}
                      onClick={() => setActiveCategory(id)}
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}
            </div>

            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Column headers */}
        <div className={styles.dirColHeader}>
          <span>Tool</span>
          <span>Verdict</span>
          <span>MCP</span>
          <span>Category</span>
          <span>Confidence</span>
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
                isExpanded={expandedId === ev.id}
                onToggle={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
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
  );
}
