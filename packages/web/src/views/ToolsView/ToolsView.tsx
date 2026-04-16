// Tools tab — your tools, observed.
// One row per tool in your stack with concrete per-tool analytics.
// Click any row → drill into a per-tool detail view (slide-in panel for now;
// PR 2 will replace this with a proper /tools/:toolId route).

import { type CSSProperties, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { getToolMeta, normalizeToolId } from '../../lib/toolMeta.js';
import { formatDuration } from '../../lib/utils.js';
import { navigate, setQueryParam, useQueryParam } from '../../lib/router.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import InlineHint from '../../components/InlineHint/InlineHint.jsx';
import { SkeletonRows } from '../../components/Skeleton/Skeleton.jsx';
import { useDismissible } from '../../hooks/useDismissible.js';
import StackToolDetail from './StackToolDetail.js';
import Sparkline from './Sparkline.js';
import StackAdoptionTimeline from './StackAdoptionTimeline.js';
import StackWorkTypeMatrix from './StackWorkTypeMatrix.js';
import StackConcurrency from './StackConcurrency.js';
import SharedFileStream from './SharedFileStream.js';
import SharedFileDetail from './SharedFileDetail.js';
import CompareTools from './CompareTools.js';
import { useScoredStackData, type ScoredToolRow } from './useScoredStackData.js';
import { useToolsViewData, arcPath, CX, CY, R, SW } from './useToolsViewData.js';
import styles from './ToolsView.module.css';

type StackSortKey = 'name' | 'sessions' | 'completion' | 'firstEdit';

function formatAdoption(day: string | null): string | null {
  if (!day) return null;
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function compareRows(a: ScoredToolRow, b: ScoredToolRow, key: StackSortKey): number {
  switch (key) {
    case 'name':
      return getToolMeta(a.toolId).label.localeCompare(getToolMeta(b.toolId).label);
    case 'sessions':
      return b.sessions - a.sessions;
    case 'completion':
      return b.completionRate - a.completionRate;
    case 'firstEdit': {
      const av = a.avgFirstEditMin ?? Number.POSITIVE_INFINITY;
      const bv = b.avgFirstEditMin ?? Number.POSITIVE_INFINITY;
      return av - bv;
    }
  }
}

const DIRECTORY_HINT_KEY = 'chinwag:tools-directory-hint-dismissed';

export default function ToolsView() {
  const stackToolParam = useQueryParam('stack');
  const fileParam = useQueryParam('file');
  const { rows: scoredRows, getDrillIn, isLoading, analytics } = useScoredStackData(30);
  const { arcs, uniqueTools, toolShare, evaluations } = useToolsViewData();
  const directoryHint = useDismissible(DIRECTORY_HINT_KEY);

  const [sortKey, setSortKey] = useState<StackSortKey>('sessions');
  const sortedRows = useMemo(
    () => [...scoredRows].sort((a, b) => compareRows(a, b, sortKey)),
    [scoredRows, sortKey],
  );

  const stackDrill = useMemo(() => {
    if (!stackToolParam) return null;
    return getDrillIn(stackToolParam);
  }, [stackToolParam, getDrillIn]);

  // Stack and file detail panels are mutually exclusive — opening one
  // clears the other so the URL always reflects a single active drill.
  const openStackTool = useCallback((toolId: string | null) => {
    if (toolId) setQueryParam('file', null);
    setQueryParam('stack', toolId);
  }, []);

  const openFile = useCallback((filePath: string | null) => {
    if (filePath) setQueryParam('stack', null);
    setQueryParam('file', filePath);
  }, []);

  const pageRef = useRef<HTMLDivElement>(null);
  const [hoveredTool, setHoveredTool] = useState<string | null>(null);
  const shifted = !!stackDrill || !!fileParam;

  // Scroll to top when entering/leaving detail
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

  // Escape closes whichever drill-in is open.
  useEffect(() => {
    if (!shifted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (stackDrill) openStackTool(null);
      else if (fileParam) openFile(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shifted, stackDrill, fileParam, openStackTool, openFile]);

  if (isLoading && scoredRows.length === 0) {
    return (
      <div className={styles.page}>
        <ViewHeader eyebrow="Across projects" title="Tools" />
        <SkeletonRows count={3} columns={6} />
      </div>
    );
  }

  return (
    <div ref={pageRef} className={styles.page}>
      <div className={clsx(styles.track, shifted && styles.trackShifted)}>
        <div className={styles.listPanel}>
          <ViewHeader eyebrow="Across projects" title="Tools" />

          <section className={styles.stackZone} onMouseLeave={() => setHoveredTool(null)}>
            {/* Ring chart — visual identity for the stack */}
            {uniqueTools === 0 ? (
              <div className={styles.stackEmptyRingWrap}>
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
            ) : (
              <div className={styles.ringWrap}>
                <svg viewBox="0 0 260 260" className={styles.ringSvg}>
                  {arcs.map((arc) => {
                    const meta = getToolMeta(arc.tool);
                    const arcKey = normalizeToolId(arc.tool);
                    const hoveredKey = hoveredTool ? normalizeToolId(hoveredTool) : null;
                    const dimmed = hoveredKey && hoveredKey !== arcKey;
                    const highlighted = hoveredKey === arcKey;
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
                          <g pointerEvents="none">
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
                          </g>
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

            <div className={styles.tableColumn}>
              <div className={styles.tableToolbar}>
                <CompareTools rows={sortedRows} getDrillIn={getDrillIn} />
              </div>
              <div className={styles.scoredTable}>
                <div className={styles.scoredHeader}>
                  <button
                    type="button"
                    className={clsx(
                      styles.scoredHeaderCell,
                      sortKey === 'name' && styles.scoredHeaderActive,
                    )}
                    onClick={() => setSortKey('name')}
                  >
                    Tool
                  </button>
                  <button
                    type="button"
                    className={clsx(
                      styles.scoredHeaderCell,
                      styles.scoredHeaderRight,
                      sortKey === 'sessions' && styles.scoredHeaderActive,
                    )}
                    onClick={() => setSortKey('sessions')}
                  >
                    Sessions
                  </button>
                  <button
                    type="button"
                    className={clsx(
                      styles.scoredHeaderCell,
                      styles.scoredHeaderRight,
                      sortKey === 'completion' && styles.scoredHeaderActive,
                    )}
                    onClick={() => setSortKey('completion')}
                  >
                    Completion
                  </button>
                  <button
                    type="button"
                    className={clsx(
                      styles.scoredHeaderCell,
                      styles.scoredHeaderRight,
                      sortKey === 'firstEdit' && styles.scoredHeaderActive,
                    )}
                    onClick={() => setSortKey('firstEdit')}
                  >
                    First edit
                  </button>
                  <span className={styles.scoredHeaderCell}>Trend</span>
                  <span aria-hidden="true" />
                </div>

                {sortedRows.length === 0 ? (
                  <div className={styles.scoredEmpty}>
                    No tools have reported sessions yet. Run <code>npx chinwag init</code> in a
                    project to get started.
                  </div>
                ) : (
                  sortedRows.map((row, i) => {
                    const meta = getToolMeta(row.toolId);
                    const adoption = formatAdoption(row.firstSeen);
                    const dimmed =
                      hoveredTool && normalizeToolId(hoveredTool) !== normalizeToolId(row.toolId);
                    return (
                      <button
                        key={row.toolId}
                        type="button"
                        className={clsx(styles.scoredRow, dimmed && styles.scoredRowDim)}
                        style={{ '--row-index': i } as CSSProperties}
                        onClick={() => openStackTool(row.toolId)}
                        onMouseEnter={() => setHoveredTool(row.toolId)}
                        onMouseLeave={() => setHoveredTool(null)}
                      >
                        <div className={styles.scoredIdentity}>
                          <ToolIcon tool={row.toolId} size={20} />
                          <div className={styles.scoredNameColumn}>
                            <span className={styles.scoredName}>{meta.label}</span>
                            {adoption && (
                              <span className={styles.scoredAdoption}>since {adoption}</span>
                            )}
                          </div>
                        </div>
                        <span className={styles.scoredNum}>{row.sessions}</span>
                        <span className={styles.scoredNum}>
                          {row.sessions > 0 ? `${row.completionRate}%` : '\u2014'}
                        </span>
                        <span className={styles.scoredNum}>
                          {row.avgFirstEditMin != null
                            ? formatDuration(row.avgFirstEditMin)
                            : '\u2014'}
                        </span>
                        <span className={styles.scoredSpark}>
                          <Sparkline
                            data={row.sparkline}
                            width={88}
                            height={22}
                            color={meta.color}
                            ariaLabel={`${meta.label} 30 day session trend`}
                          />
                        </span>
                        <span className={styles.viewButton}>View</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          {scoredRows.length > 0 && (
            <div className={styles.followUpSections}>
              <StackAdoptionTimeline />
              <StackWorkTypeMatrix
                breakdown={analytics.tool_work_type}
                onToolClick={openStackTool}
              />
              <SharedFileStream onFileClick={(path) => openFile(path)} />
              <StackConcurrency />
            </div>
          )}
        </div>

        <div className={styles.detailPanel}>
          {stackDrill ? (
            <StackToolDetail drill={stackDrill} rangeDays={30} onBack={() => openStackTool(null)} />
          ) : fileParam ? (
            <SharedFileDetail filePath={fileParam} onBack={() => openFile(null)} />
          ) : null}
        </div>
      </div>

      {!stackDrill && !directoryHint.isDismissed() && (
        <InlineHint
          actionLabel="Browse directory"
          onAction={() => navigate('directory')}
          onDismiss={() => directoryHint.dismiss()}
        >
          {evaluations.length > 0
            ? `Looking for more? ${evaluations.length} AI coding tools in the directory.`
            : 'Looking for more? Browse the directory of supported tools.'}
        </InlineHint>
      )}
    </div>
  );
}
