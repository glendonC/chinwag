import { useState, useMemo } from 'react';
import clsx from 'clsx';
import { getToolMeta, normalizeToolId } from '../../lib/toolMeta.js';
import { summarizeList } from '../../lib/summarize.js';
import { useToolCatalog } from '../../lib/useToolCatalog.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import DirectoryRow from '../ToolsView/DirectoryRow.jsx';
import { arcPath, CX, CY, R, SW, type ArcEntry } from './useOverviewData.js';
import type { JoinShareEntry } from '../../lib/toolAnalytics.js';
import styles from './OverviewView.module.css';

interface ToolUsageEntry {
  tool: string;
  joins: number;
  share: number;
}

interface HostConfigured {
  host_tool?: string;
  joins: number;
  [key: string]: unknown;
}

interface TeamSummary {
  team_id: string;
  team_name?: string;
  hosts_configured?: HostConfigured[];
  [key: string]: unknown;
}

interface VerdictOption {
  value: string;
  label: string;
}

const VERDICT_OPTIONS: VerdictOption[] = [
  { value: 'all', label: 'All' },
  { value: 'integrated', label: 'Integrated' },
  { value: 'installable', label: 'Installable' },
  { value: 'listed', label: 'Listed' },
];

const VERDICT_ORDER: Record<string, number> = {
  integrated: 0,
  compatible: 0,
  installable: 1,
  partial: 1,
  listed: 2,
  incompatible: 2,
};

const INITIAL_COUNT = 15;

interface ToolsPanelProps {
  arcs: ArcEntry[];
  toolUsage: ToolUsageEntry[];
  uniqueTools: number;
  hostShare: JoinShareEntry[];
  surfaceShare: JoinShareEntry[];
  summaries: TeamSummary[];
  token: string | null;
}

export default function ToolsPanel({
  arcs,
  toolUsage,
  uniqueTools,
  hostShare,
  surfaceShare,
  summaries,
  token,
}: ToolsPanelProps) {
  const [screen, setScreen] = useState<'stack' | 'directory'>('stack');
  const { categories, evaluations, loading } = useToolCatalog(token);

  // Directory filter state
  const [activeCategory, setActiveCategory] = useState('all');
  const [activeVerdict, setActiveVerdict] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Build user tool sets for sorting
  const userToolIds = useMemo(
    () => new Set(toolUsage.map((t) => normalizeToolId(t.tool))),
    [toolUsage],
  );
  const userHostIds = useMemo(
    () => new Set(hostShare.map((h) => normalizeToolId(h.host_tool as string))),
    [hostShare],
  );
  const seenSurfaceIds = useMemo(
    () => new Set(surfaceShare.map((s) => normalizeToolId(s.agent_surface as string))),
    [surfaceShare],
  );

  const categoryList = useMemo(() => Object.entries(categories), [categories]);

  const filteredEvaluations = useMemo(() => {
    let result = evaluations;
    if (activeCategory !== 'all') {
      result = result.filter((ev) => ev.category === activeCategory);
    }
    if (activeVerdict !== 'all') {
      result = result.filter((ev) => ev.verdict === activeVerdict);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (ev) =>
          (ev.name || '').toLowerCase().includes(q) ||
          (ev.id || '').toLowerCase().includes(q) ||
          (ev.tagline || '').toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) => {
      const aId = normalizeToolId(a.id);
      const bId = normalizeToolId(b.id);
      const aConfigured =
        userToolIds.has(aId) || userHostIds.has(aId) || seenSurfaceIds.has(aId) ? 1 : 0;
      const bConfigured =
        userToolIds.has(bId) || userHostIds.has(bId) || seenSurfaceIds.has(bId) ? 1 : 0;
      if (aConfigured !== bConfigured) return bConfigured - aConfigured;
      const aV = VERDICT_ORDER[a.verdict ?? ''] ?? 3;
      const bV = VERDICT_ORDER[b.verdict ?? ''] ?? 3;
      if (aV !== bV) return aV - bV;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [
    evaluations,
    activeCategory,
    activeVerdict,
    searchQuery,
    userToolIds,
    userHostIds,
    seenSurfaceIds,
  ]);

  if (arcs.length === 0 && evaluations.length === 0) {
    return (
      <div className={styles.vizPanel} role="tabpanel" id="panel-tools">
        <p className={styles.emptyHint}>No tools connected yet.</p>
      </div>
    );
  }

  return (
    <div className={styles.vizPanel} role="tabpanel" id="panel-tools">
      <div className={styles.spatialContainer}>
        <div
          className={clsx(
            styles.spatialTrack,
            screen === 'directory' && styles.spatialShowDirectory,
          )}
        >
          {/* ── Screen 1: Stack ── */}
          <div className={styles.spatialScreen}>
            <div className={styles.toolsViz}>
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
                      TOOLS
                    </text>
                  </svg>
                </div>
              )}

              {/* Legend table */}
              {toolUsage.length > 0 && (
                <div className={styles.toolsLegend}>
                  {toolUsage.map((entry) => {
                    const meta = getToolMeta(entry.tool);
                    const projects = summaries
                      .filter((t) =>
                        (t.hosts_configured || []).some((tc) => tc.host_tool === entry.tool),
                      )
                      .map((t) => t.team_name || t.team_id);
                    return (
                      <div key={entry.tool} className={styles.legendRow}>
                        <span className={styles.legendDot} style={{ background: meta.color }} />
                        <span className={styles.legendName}>{meta.label}</span>
                        <span className={styles.legendProjects}>{projects.join(', ')}</span>
                        <span className={styles.legendShare}>{Math.round(entry.share * 100)}%</span>
                        <span className={styles.legendSessions}>
                          {entry.joins} session{entry.joins === 1 ? '' : 's'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Hosts + Surfaces signals */}
              {(hostShare.length > 0 || surfaceShare.length > 0) && (
                <div className={styles.signalGrid}>
                  <section className={styles.signalBlock}>
                    <div className={styles.signalHeader}>
                      <span className={styles.signalTitle}>Hosts</span>
                      <span className={styles.signalMeta}>Cross-project</span>
                    </div>
                    {hostShare.length > 0 ? (
                      <div className={styles.signalList}>
                        {hostShare.map((entry) => {
                          const meta = getToolMeta(entry.host_tool as string);
                          return (
                            <div key={`host:${entry.host_tool}`} className={styles.signalRow}>
                              <span className={styles.signalIdentity}>
                                <ToolIcon tool={entry.host_tool as string} size={16} />
                                {meta.label}
                              </span>
                              <span className={styles.signalValue}>
                                {Math.round(entry.share * 100)}%
                              </span>
                              <span className={styles.signalProjects}>
                                {summarizeList(entry.projects as string[])}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className={styles.emptyHint}>No host telemetry yet.</p>
                    )}
                  </section>

                  <section className={styles.signalBlock}>
                    <div className={styles.signalHeader}>
                      <span className={styles.signalTitle}>Agent surfaces</span>
                      <span className={styles.signalMeta}>Cross-project</span>
                    </div>
                    {surfaceShare.length > 0 ? (
                      <div className={styles.signalList}>
                        {surfaceShare.map((entry) => {
                          const meta = getToolMeta(entry.agent_surface as string);
                          return (
                            <div
                              key={`surface:${entry.agent_surface}`}
                              className={styles.signalRow}
                            >
                              <span className={styles.signalIdentity}>
                                <ToolIcon tool={entry.agent_surface as string} size={16} />
                                {meta.label}
                              </span>
                              <span className={styles.signalValue}>
                                {Math.round(entry.share * 100)}%
                              </span>
                              <span className={styles.signalProjects}>
                                {summarizeList(entry.projects as string[])}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className={styles.emptyHint}>No surfaces observed yet.</p>
                    )}
                  </section>
                </div>
              )}

              {/* ── Directory navigation affordance ── */}
              <button
                type="button"
                className={styles.directoryNav}
                onClick={() => setScreen('directory')}
              >
                <div className={styles.directoryNavContent}>
                  <span className={styles.directoryNavTitle}>Directory</span>
                  <span className={styles.directoryNavMeta}>
                    {loading
                      ? 'Loading evaluations\u2026'
                      : `${evaluations.length} evaluated tools`}
                  </span>
                </div>
                <span className={styles.directoryNavArrow}>{'\u2192'}</span>
              </button>
            </div>
          </div>

          {/* ── Screen 2: Directory ── */}
          <div className={styles.spatialScreen}>
            <div className={styles.directoryView}>
              {/* Back button */}
              <button
                type="button"
                className={styles.directoryBack}
                onClick={() => setScreen('stack')}
              >
                {'\u2190'} Stack
              </button>

              {/* Directory header */}
              <div className={styles.dirSectionHeader}>
                <h2 className={styles.dirSectionTitle}>Directory</h2>
                <span className={styles.dirSectionMeta}>
                  {filteredEvaluations.length} of {evaluations.length} evaluated
                </span>
              </div>

              {/* Filter controls */}
              <div className={styles.dirControls}>
                <div className={styles.dirFilterRow}>
                  {VERDICT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={clsx(
                        styles.dirFilterBtn,
                        activeVerdict === opt.value && styles.dirFilterBtnActive,
                      )}
                      onClick={() => setActiveVerdict(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <span className={styles.dirFilterDivider} />
                  <button
                    className={clsx(
                      styles.dirFilterBtn,
                      activeCategory === 'all' && styles.dirFilterBtnActive,
                    )}
                    onClick={() => setActiveCategory('all')}
                  >
                    All categories
                  </button>
                  {categoryList.map(([id, label]) => (
                    <button
                      key={id}
                      className={clsx(
                        styles.dirFilterBtn,
                        activeCategory === id && styles.dirFilterBtnActive,
                      )}
                      onClick={() => setActiveCategory(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  className={styles.dirSearchInput}
                  placeholder="Search tools..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Directory table header */}
              <div className={styles.dirHeader}>
                <span>Tool</span>
                <span>Verdict</span>
                <span>MCP</span>
                <span>Category</span>
                <span>Confidence</span>
                <span>Summary</span>
              </div>

              {/* Directory list */}
              <div className={styles.dirList}>
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
                  <button className={styles.dirShowMore} onClick={() => setShowAll(true)}>
                    Show {filteredEvaluations.length - INITIAL_COUNT} more tools
                  </button>
                )}
                {showAll && filteredEvaluations.length > INITIAL_COUNT && (
                  <button className={styles.dirShowMore} onClick={() => setShowAll(false)}>
                    Show less
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
