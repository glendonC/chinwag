/**
 * Tools & Models widget category.
 *
 * Six widgets, two visualizations net new:
 *   tool-handoffs               — completion-weighted cross-tool flow (default, 12×4)
 *   tool-work-type-fit          — tools × work-types completion heatmap (default, 8×3)
 *   one-shot-by-tool            — per-tool first-try rate (default, 4×3)
 *   tool-capability-coverage    — tools × capabilities matrix (catalog, 6×3)
 *   tool-call-errors            — error rate + top patterns (catalog, 6×3)
 *   model-mix                   — model share with tab-selector reveal (catalog, 4×3)
 *   token-attribution           — model × tool token matrix (catalog, 6×4)
 *
 * Substrate-unique angles owned by this category:
 *   - Cross-tool file flow (tool-handoffs)
 *   - Head-to-head completion on identical work-types (tool-work-type-fit)
 *   - Per-vendor first-try rate on the same repo (one-shot-by-tool)
 *   - Per-tool capability coverage (tool-capability-coverage)
 *   - Cross-tool model attribution (token-attribution)
 *
 * Design language: chromeless. No cards, no dividers — hierarchy from font
 * weight, opacity, and color. Mono for labels and metadata. Em-dash for
 * unmeasured, 0 for measured zero. Stagger via --row-index × 35ms. Accent is
 * reserved for live data; static counts use --ink. Coverage notes for any
 * metric gated on a deep-capture capability.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { aggregateModels, completionColor, COMPLETION_THRESHOLDS } from '../utils.js';
import { workTypeColor } from '../utils.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { formatCost } from '../utils.js';
import { getDataCapabilities, type DataCapabilities } from '@chinmeister/shared/tool-registry.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import shared from '../widget-shared.module.css';
import styles from './ToolWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import {
  GhostRows,
  CoverageNote,
  capabilityCoverageNote,
  InlineDelta,
  MoreHidden,
} from './shared.js';

// ── Shared constants ───────────────────────────────

/**
 * Minimum sample size before per-tool ratios render as numbers. Below this
 * threshold, the cell renders an em-dash so a single-session quirk doesn't
 * masquerade as a measured rate. Tunable in one place; do not duplicate.
 */
export const MIN_TOOL_SAMPLE = 3;

/**
 * Work-type column order for the tool-work-type-fit heatmap. Fixed so the
 * eye learns column positions across category browsing — sorted by typical
 * frequency across real chinmeister teams (frontend/backend dominate, docs
 * trails). The 'other' bucket sits last as a catch-all.
 */
const WORK_TYPE_COLUMNS = [
  'frontend',
  'backend',
  'test',
  'styling',
  'config',
  'docs',
  'other',
] as const;

/**
 * Capability columns for the coverage matrix. Order picked so capabilities
 * grow in depth left to right — a row with only the leftmost cells lit
 * reads as "shallow coverage," a row with all cells lit reads as "fully
 * instrumented." Matches the intuitive depth ordering from
 * ANALYTICS_SPEC §1 (the per-tool capability matrix that drives this widget).
 */
const CAPABILITY_COLUMNS: ReadonlyArray<{
  key: keyof DataCapabilities;
  label: string;
}> = [
  { key: 'hooks', label: 'hooks' },
  { key: 'commitTracking', label: 'commits' },
  { key: 'toolCallLogs', label: 'tool calls' },
  { key: 'tokenUsage', label: 'tokens' },
  { key: 'conversationLogs', label: 'conversations' },
];

// ── 1) tool-handoffs (Cross-Tool Flow, 12×4 default) ─────────────────

interface FlowNode {
  host_tool: string;
  outflow: number;
  inflow: number;
}

interface FlowLink {
  from: string;
  to: string;
  file_count: number;
  completion_rate: number;
  avg_gap_minutes: number;
}

/**
 * Two-column SVG flow. Left = source tools (height proportional to outflow),
 * right = destination tools (height proportional to inflow). Lines connect
 * each pair; opacity carries file_count, color carries completion_rate. The
 * substrate-unique signal: no IDE or APM can see file flow across competing
 * vendor agents. Top-N capped with truthful tail row to keep the viz legible
 * at 5+ tools (Challenger D3b: a 5×5 hairball is not a chart).
 */
function ToolHandoffsWidget({ analytics }: WidgetBodyProps) {
  const handoffs = analytics.tool_handoffs;
  const tools = analytics.tool_comparison;
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // Empty states are honest about cause. Solo: structurally impossible.
  // Multi-tool zero handoffs: agents are working in their own lanes.
  if (handoffs.length === 0) {
    const toolCount = tools.length;
    const message =
      toolCount <= 1
        ? 'Connect a second tool with `chinmeister add <tool>` to see how files travel between agents.'
        : 'Your agents stayed inside one tool each this period.';
    return <SectionEmpty>{message}</SectionEmpty>;
  }

  const TOP_N = 8;
  const visible = handoffs.slice(0, TOP_N);
  const hidden = Math.max(0, handoffs.length - TOP_N);

  // Build node aggregates from visible links so heights match what's drawn.
  const nodeMap = new Map<string, FlowNode>();
  const links: FlowLink[] = [];
  for (const h of visible) {
    const f = nodeMap.get(h.from_tool) ?? { host_tool: h.from_tool, outflow: 0, inflow: 0 };
    f.outflow += h.file_count;
    nodeMap.set(h.from_tool, f);
    const t = nodeMap.get(h.to_tool) ?? { host_tool: h.to_tool, outflow: 0, inflow: 0 };
    t.inflow += h.file_count;
    nodeMap.set(h.to_tool, t);
    links.push({
      from: h.from_tool,
      to: h.to_tool,
      file_count: h.file_count,
      completion_rate: h.handoff_completion_rate,
      avg_gap_minutes: h.avg_gap_minutes,
    });
  }
  // Stable order: sources by outflow desc, destinations by inflow desc.
  const sources = [...nodeMap.values()]
    .filter((n) => n.outflow > 0)
    .sort((a, b) => b.outflow - a.outflow);
  const destinations = [...nodeMap.values()]
    .filter((n) => n.inflow > 0)
    .sort((a, b) => b.inflow - a.inflow);

  const maxFiles = links.reduce((m, l) => Math.max(m, l.file_count), 1);

  // Node geometry. Nodes stack vertically with a small gap; each node's
  // height is proportional to its share of total flow on its side. Heights
  // floor at NODE_MIN_PX so a tiny node still has a visible target for its
  // line endpoint. The total visual height of the column is independent of
  // the SVG's intrinsic size — we render in a viewBox so the parent
  // container drives final pixel scale.
  const VIEW_W = 100;
  const VIEW_H = 100;
  const COL_PAD_X = 2;
  const NODE_W = 12;
  const NODE_GAP = 2;
  const LEFT_X = COL_PAD_X;
  const RIGHT_X = VIEW_W - COL_PAD_X - NODE_W;

  function layoutColumn(nodes: FlowNode[], side: 'src' | 'dst') {
    const total = nodes.reduce((s, n) => s + (side === 'src' ? n.outflow : n.inflow), 0);
    const totalGapPx = (nodes.length - 1) * NODE_GAP;
    const usable = Math.max(1, VIEW_H - totalGapPx);
    const NODE_MIN_PX = 4;
    let y = 0;
    return nodes.map((n) => {
      const v = side === 'src' ? n.outflow : n.inflow;
      const raw = total > 0 ? (v / total) * usable : usable / nodes.length;
      const h = Math.max(NODE_MIN_PX, raw);
      const node = { node: n, x: side === 'src' ? LEFT_X : RIGHT_X, y, h };
      y += h + NODE_GAP;
      return node;
    });
  }

  const srcLayout = layoutColumn(sources, 'src');
  const dstLayout = layoutColumn(destinations, 'dst');
  const srcByTool = new Map(srcLayout.map((s) => [s.node.host_tool, s]));
  const dstByTool = new Map(dstLayout.map((d) => [d.node.host_tool, d]));

  // Hover detail: pull the link object directly so the panel reads exact
  // numbers, not derived text.
  const hoveredLink = hoveredKey ? links.find((l) => `${l.from}->${l.to}` === hoveredKey) : null;

  const summary = (() => {
    const totalFiles = links.reduce((s, l) => s + l.file_count, 0);
    const weightedComplete = links.reduce(
      (s, l) => s + (l.completion_rate * l.file_count) / 100,
      0,
    );
    const avgComplete = totalFiles > 0 ? Math.round((weightedComplete / totalFiles) * 100) : 0;
    return { totalFiles, avgComplete, pairs: visible.length };
  })();

  return (
    <div className={styles.flowWrap}>
      <div className={styles.flowHead}>
        <span className={styles.flowSummary}>
          <span className={styles.flowSummaryNum}>{summary.pairs}</span> pairs ·{' '}
          <span className={styles.flowSummaryNum}>{summary.totalFiles}</span> files ·{' '}
          <span
            className={styles.flowSummaryNum}
            style={{ color: completionColor(summary.avgComplete) }}
          >
            {summary.avgComplete}% complete
          </span>
        </span>
        {hoveredLink ? (
          <span className={styles.flowHover}>
            {getToolMeta(hoveredLink.from).label} → {getToolMeta(hoveredLink.to).label} ·{' '}
            <span className={styles.flowSummaryNum}>{hoveredLink.file_count}</span> files ·{' '}
            <span style={{ color: completionColor(hoveredLink.completion_rate) }}>
              {hoveredLink.completion_rate}%
            </span>
            {hoveredLink.avg_gap_minutes > 0 && (
              <>
                {' '}
                · <span className={styles.flowSummaryNum}>{hoveredLink.avg_gap_minutes}m</span> gap
              </>
            )}
          </span>
        ) : null}
      </div>
      <svg
        className={styles.flowSvg}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Cross-tool file handoff flow"
      >
        {/* Lines first so nodes paint on top */}
        {links.map((l, i) => {
          const s = srcByTool.get(l.from);
          const d = dstByTool.get(l.to);
          if (!s || !d) return null;
          const x1 = s.x + NODE_W;
          const y1 = s.y + s.h / 2;
          const x2 = d.x;
          const y2 = d.y + d.h / 2;
          const dx = (x2 - x1) / 2;
          const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
          const opacity = 0.18 + 0.65 * (l.file_count / maxFiles);
          const color = completionColor(l.completion_rate);
          const key = `${l.from}->${l.to}`;
          const isHovered = hoveredKey === key;
          return (
            <path
              key={key}
              d={path}
              stroke={color}
              strokeWidth={isHovered ? 1.4 : 0.8}
              strokeOpacity={isHovered ? 1 : opacity}
              fill="none"
              vectorEffect="non-scaling-stroke"
              style={{ cursor: 'pointer', transition: 'stroke-width 140ms, stroke-opacity 140ms' }}
              onMouseEnter={() => setHoveredKey(key)}
              onMouseLeave={() => setHoveredKey(null)}
              onFocus={() => setHoveredKey(key)}
              onBlur={() => setHoveredKey(null)}
              tabIndex={0}
              aria-label={`${l.from} to ${l.to}, ${l.file_count} files, ${l.completion_rate}% completion`}
              data-row-index={i}
            />
          );
        })}
        {/* Source nodes */}
        {srcLayout.map(({ node, x, y, h }) => {
          const meta = getToolMeta(node.host_tool);
          return (
            <g key={`src-${node.host_tool}`}>
              <rect x={x} y={y} width={NODE_W} height={h} fill={meta.color} opacity={0.7} />
              <text
                x={x - 1}
                y={y + h / 2}
                textAnchor="end"
                dominantBaseline="middle"
                className={styles.flowNodeLabel}
              >
                {meta.label}
              </text>
            </g>
          );
        })}
        {/* Destination nodes */}
        {dstLayout.map(({ node, x, y, h }) => {
          const meta = getToolMeta(node.host_tool);
          return (
            <g key={`dst-${node.host_tool}`}>
              <rect x={x} y={y} width={NODE_W} height={h} fill={meta.color} opacity={0.7} />
              <text
                x={x + NODE_W + 1}
                y={y + h / 2}
                textAnchor="start"
                dominantBaseline="middle"
                className={styles.flowNodeLabel}
              >
                {meta.label}
              </text>
            </g>
          );
        })}
      </svg>
      <MoreHidden count={hidden} />
    </div>
  );
}

// ── 2) tool-work-type-fit (Tools × Work-Types Heatmap, 8×3 default) ───

/**
 * Heatmap of completion rate per (tool, work-type). Color = completion
 * tier (success/warn/danger). Opacity = sample-size confidence (low n
 * fades out). Em-dash at n<MIN_TOOL_SAMPLE so a single-session bucket
 * never displays as a measured rate. Substrate-unique: head-to-head
 * outcomes on identical work-types in the same repo is chinmeister-only.
 */
function ToolWorkTypeFitWidget({ analytics }: WidgetBodyProps) {
  const breakdown = analytics.tool_work_type;
  const tools = analytics.tool_comparison;

  if (breakdown.length === 0 || tools.length === 0) {
    return (
      <SectionEmpty>Run a few sessions across your tools to see where each one wins.</SectionEmpty>
    );
  }

  // Index by (tool, work_type) for O(1) cell lookup.
  const cells = new Map<string, { sessions: number; completion_rate: number }>();
  for (const b of breakdown) {
    cells.set(`${b.host_tool}:${b.work_type}`, {
      sessions: b.sessions,
      completion_rate: b.completion_rate,
    });
  }

  // Tools sorted by total session count (matches tool_comparison ordering).
  const toolRows = [...tools].sort((a, b) => b.sessions - a.sessions);

  // Confidence opacity: 0.25 floor at the sample threshold, 1.0 at 20+.
  function confidence(n: number): number {
    if (n < MIN_TOOL_SAMPLE) return 0;
    return Math.min(1, 0.25 + (n / 20) * 0.75);
  }

  return (
    <div className={styles.heatmapWrap}>
      <div
        className={styles.heatmapGrid}
        style={
          {
            '--heatmap-cols': WORK_TYPE_COLUMNS.length,
          } as CSSProperties
        }
      >
        {/* Header row: blank corner + work-type labels */}
        <span className={styles.heatmapCornerCell} aria-hidden="true" />
        {WORK_TYPE_COLUMNS.map((wt) => (
          <span key={wt} className={styles.heatmapHeaderCell}>
            <span
              className={styles.heatmapHeaderDot}
              style={{ background: workTypeColor(wt) }}
              aria-hidden="true"
            />
            {wt}
          </span>
        ))}
        {/* Data rows */}
        {toolRows.map((t, rowIdx) => {
          const meta = getToolMeta(t.host_tool);
          return (
            <div
              key={t.host_tool}
              className={styles.heatmapRow}
              style={{ '--row-index': rowIdx } as CSSProperties}
              role="row"
            >
              <span className={styles.heatmapRowLabel}>
                <span
                  className={styles.heatmapToolDot}
                  style={{ background: meta.color }}
                  aria-hidden="true"
                />
                <span className={styles.heatmapToolName}>{meta.label}</span>
              </span>
              {WORK_TYPE_COLUMNS.map((wt) => {
                const cell = cells.get(`${t.host_tool}:${wt}`);
                const sessions = cell?.sessions ?? 0;
                const conf = confidence(sessions);
                if (conf === 0) {
                  return (
                    <span key={wt} className={styles.heatmapCellEmpty}>
                      —
                    </span>
                  );
                }
                const rate = cell!.completion_rate;
                return (
                  <span
                    key={wt}
                    className={styles.heatmapCell}
                    style={{
                      background: completionColor(rate),
                      opacity: conf,
                    }}
                    title={`${meta.label} on ${wt}: ${rate}% complete (${sessions} sessions)`}
                  >
                    <span className={styles.heatmapCellValue}>{Math.round(rate)}</span>
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      <CoverageNote text={completionThresholdLegend()} />
    </div>
  );
}

function completionThresholdLegend(): string {
  return `Completion ≥${COMPLETION_THRESHOLDS.good}% · ${COMPLETION_THRESHOLDS.warning}–${COMPLETION_THRESHOLDS.good - 1}% · <${COMPLETION_THRESHOLDS.warning}%. Faded cells = small sample.`;
}

// ── 3) one-shot-by-tool (Per-Tool First-Try, 4×3 default) ─────────────

/**
 * Per-tool one-shot rate. CodeBurn's killer metric, sliced by host_tool.
 * Substrate-unique: head-to-head first-try rate on the same repo is only
 * chinmeister. Bars sized by rate; tools below MIN_TOOL_SAMPLE render
 * em-dash with the session count exposed for honesty.
 */
function OneShotByToolWidget({ analytics }: WidgetBodyProps) {
  const rows = analytics.tool_call_stats.host_one_shot ?? [];
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'toolCallLogs');

  if (rows.length === 0) {
    return (
      <>
        <GhostRows count={3} />
        <CoverageNote text={note} />
      </>
    );
  }

  return (
    <div className={styles.oneShotWrap}>
      <div className={styles.oneShotList}>
        {rows.map((r, i) => {
          const meta = getToolMeta(r.host_tool);
          const enough = r.sessions >= MIN_TOOL_SAMPLE;
          return (
            <div
              key={r.host_tool}
              className={styles.oneShotRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.oneShotLabel}>
                <span
                  className={styles.oneShotDot}
                  style={{ background: meta.color }}
                  aria-hidden="true"
                />
                <span className={styles.oneShotName}>{meta.label}</span>
                <span className={styles.oneShotSubtle}>
                  {r.sessions} {r.sessions === 1 ? 'session' : 'sessions'}
                </span>
              </span>
              <span className={styles.oneShotBarTrack}>
                {enough && (
                  <span
                    className={styles.oneShotBarFill}
                    style={{
                      width: `${Math.max(2, r.one_shot_rate)}%`,
                      background: completionColor(r.one_shot_rate),
                    }}
                  />
                )}
              </span>
              <span className={styles.oneShotValue}>{enough ? `${r.one_shot_rate}%` : '—'}</span>
            </div>
          );
        })}
      </div>
      <CoverageNote text={note} />
    </div>
  );
}

// ── 4) tool-capability-coverage (Coverage Matrix, 6×3 catalog) ────────

/**
 * Reframed `tools` widget: capability-COVERAGE matrix, not capability-USAGE
 * stats. Rows = tools, columns = capability flags. Cells: filled brand-color
 * dot when capable, em-dash when not. Sessions column anchors usage so the
 * matrix doesn't read as static spec sheet — the user sees activity
 * alongside coverage.
 *
 * Demoted to catalog (Challenger): capability is near-static (Cursor having
 * hooks doesn't change next week). Belongs in the discovery / settings flow
 * for daily cockpit work, but kept catalog-available for power users
 * comparing their stack.
 */
function ToolCapabilityCoverageWidget({ analytics }: WidgetBodyProps) {
  const tools = analytics.tool_comparison;
  if (tools.length === 0) {
    return <SectionEmpty>Connect a tool to see what each one captures.</SectionEmpty>;
  }
  const rows = [...tools].sort((a, b) => b.sessions - a.sessions);

  return (
    <div className={styles.coverageWrap}>
      <div
        className={styles.coverageGrid}
        style={
          {
            '--coverage-cols': CAPABILITY_COLUMNS.length,
          } as CSSProperties
        }
      >
        <span className={styles.coverageCornerCell} aria-hidden="true" />
        <span className={styles.coverageHeaderCell}>sessions</span>
        {CAPABILITY_COLUMNS.map((c) => (
          <span key={c.key} className={styles.coverageHeaderCell}>
            {c.label}
          </span>
        ))}
        {rows.map((t, i) => {
          const meta = getToolMeta(t.host_tool);
          const caps = getDataCapabilities(t.host_tool);
          return (
            <div
              key={t.host_tool}
              className={styles.coverageRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.coverageRowLabel}>
                <span
                  className={styles.coverageToolDot}
                  style={{ background: meta.color }}
                  aria-hidden="true"
                />
                <span className={styles.coverageToolName}>{meta.label}</span>
              </span>
              <span className={styles.coverageSessionCell}>{t.sessions}</span>
              {CAPABILITY_COLUMNS.map((c) => {
                const present = caps[c.key] === true;
                return (
                  <span
                    key={c.key}
                    className={present ? styles.coverageCellOn : styles.coverageCellOff}
                    aria-label={`${meta.label} ${c.label}: ${present ? 'yes' : 'no'}`}
                  >
                    {present ? (
                      <span className={styles.coverageDot} style={{ background: meta.color }} />
                    ) : (
                      '—'
                    )}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 5) tool-call-errors (Error Hero + Top-3, 6×3 catalog) ─────────────

/**
 * Reworked errors widget. Hero stat = error_rate %, caption = X errors in Y
 * calls, top 3 recurring errors below. The two-pane (frequent / recent)
 * split moves to the detail view — atoms-and-compounds rule (rubric).
 *
 * Drill target: clicking an error row navigates to the detail-view error
 * tab where the matching session / file context lives.
 */
function ToolCallErrorsWidget({ analytics }: WidgetBodyProps) {
  const stats = analytics.tool_call_stats;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'toolCallLogs');

  if (stats.total_calls === 0) {
    return (
      <>
        <GhostRows count={3} />
        <CoverageNote text={note} />
      </>
    );
  }

  // Period delta isn't on tool_call_stats today; render the hero bare. When
  // the period_comparison schema gains an error_rate field, splice it here.
  const errorRate = stats.error_rate;
  const totalErrors = stats.total_errors;
  const totalCalls = stats.total_calls;

  const top3 = [...stats.error_patterns].sort((a, b) => b.count - a.count).slice(0, 3);

  return (
    <div className={styles.errorsWrap}>
      <div className={styles.errorsHero}>
        <span
          className={shared.heroStatValue}
          style={{ color: errorRate > 5 ? 'var(--danger)' : 'var(--ink)' }}
        >
          {errorRate}%
        </span>
        <span className={styles.errorsHeroCaption}>
          <span className={styles.errorsHeroNum}>{totalErrors}</span>{' '}
          {totalErrors === 1 ? 'error' : 'errors'} in{' '}
          <span className={styles.errorsHeroNum}>{totalCalls.toLocaleString()}</span>{' '}
          {totalCalls === 1 ? 'call' : 'calls'}
        </span>
      </div>
      {top3.length > 0 ? (
        <div className={styles.errorsList}>
          {top3.map((e, i) => {
            const meta = getToolMeta(e.tool);
            return (
              <div
                key={`${e.tool}-${e.error_preview}-${i}`}
                className={styles.errorsRow}
                style={
                  {
                    '--row-index': i,
                    '--tool-brand': meta.color,
                  } as CSSProperties
                }
              >
                <span
                  className={styles.errorsRowDot}
                  style={{ background: meta.color }}
                  aria-hidden="true"
                />
                <span className={styles.errorsRowTool}>{meta.label}</span>
                <span className={styles.errorsRowCount}>{e.count}×</span>
                <span className={styles.errorsRowPreview}>{e.error_preview.slice(0, 80)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.errorsListEmpty}>No recurring patterns this period.</div>
      )}
      <CoverageNote text={note} />
    </div>
  );
}

// ── 6) model-mix (Share Strip + Tab-Selector, 4×3 catalog) ────────────

/**
 * Hero count + horizontal stacked share strip, segments by session-share,
 * colored by model. Tab-selector pattern: clicking a segment makes that
 * model active (full ink) and dims the others to --soft, revealing that
 * model's mini-stats (sessions / tokens / cost or em-dash). Avoids the
 * ranking-by-completion anti-pattern (§10 #5) — share is a fact, not a
 * recommendation.
 */
function ModelMixWidget({ analytics }: WidgetBodyProps) {
  const models = useMemo(
    () => aggregateModels(analytics.model_outcomes),
    [analytics.model_outcomes],
  );
  const tu = analytics.token_usage;
  const tokensByModel = useMemo(() => {
    const map = new Map<string, { tokens: number; cost: number | null }>();
    for (const m of tu.by_model) {
      map.set(m.agent_model, {
        tokens: m.input_tokens + m.output_tokens,
        cost: m.estimated_cost_usd,
      });
    }
    return map;
  }, [tu.by_model]);

  const [active, setActive] = useState<string | null>(null);

  if (models.length === 0) return <GhostRows count={2} />;

  const totalSessions = models.reduce((s, m) => s + m.total, 0) || 1;

  // Total spend renders the same way as the cost stat in Usage: em-dash
  // when stale, $0.00 when measured-zero, formatted otherwise.
  const totalCost = tu.total_estimated_cost_usd;

  return (
    <div className={styles.mixWrap}>
      <div className={styles.mixHead}>
        <span className={shared.heroStatValue}>{models.length}</span>
        <span className={styles.mixHeadCaption}>{models.length === 1 ? 'model' : 'models'}</span>
      </div>
      <div className={styles.mixStrip} role="group" aria-label="Model session share">
        {models.map((m) => {
          const share = m.total / totalSessions;
          const isActive = active === m.model;
          const dim = active != null && !isActive;
          return (
            <button
              key={m.model}
              type="button"
              className={styles.mixSegment}
              style={{
                width: `${share * 100}%`,
                background: hashModelColor(m.model),
                opacity: dim ? 0.25 : 1,
              }}
              onClick={() => setActive(active === m.model ? null : m.model)}
              aria-pressed={isActive}
              aria-label={`${m.model}: ${Math.round(share * 100)}%`}
              title={`${m.model}: ${m.total} sessions`}
            />
          );
        })}
      </div>
      <div className={styles.mixDetail}>
        {active ? (
          (() => {
            const m = models.find((x) => x.model === active)!;
            const tk = tokensByModel.get(active);
            return (
              <>
                <span className={styles.mixDetailName}>{active}</span>
                <span className={styles.mixDetailMeta}>
                  <span className={styles.mixDetailValue}>{m.total}</span> sessions
                  {tk && tk.tokens > 0 && (
                    <>
                      {' '}
                      · <span className={styles.mixDetailValue}>
                        {formatTokenCount(tk.tokens)}
                      </span>{' '}
                      tokens
                    </>
                  )}
                  {tk && tk.cost != null && (
                    <>
                      {' '}
                      · <span className={styles.mixDetailValue}>{formatCost(tk.cost, 2)}</span>
                    </>
                  )}
                </span>
              </>
            );
          })()
        ) : (
          <span className={styles.mixDetailHint}>
            {totalCost != null && totalCost > 0 ? (
              <>
                <span className={styles.mixDetailValue}>{formatCost(totalCost, 2)}</span> total ·
                pick a segment
              </>
            ) : (
              'Pick a segment to inspect'
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** Deterministic color per model name. Real model families could read from
 *  a registry; until that exists, hash to a saturated-but-muted HSL so the
 *  share strip stays distinguishable across models without colliding with
 *  the work-type or tool-brand palettes. */
function hashModelColor(model: string): string {
  let h = 5381;
  for (let i = 0; i < model.length; i++) h = ((h << 5) + h + model.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${hue}, 35%, 58%)`;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// ── 7) token-attribution (Model × Tool Matrix, 6×4 catalog) ──────────

/**
 * Replaces token-detail. Lead with the substrate-unique cell: per-(model,
 * tool) cross-attribution. Drops cost-per-edit and cache-hit-rate (those
 * live in Usage; B2 duplication killed them here). The matrix answers
 * "which tool ran which model how much" — only chinmeister can fill that
 * cell because no IDE sees competitor tokens. Footer carries totals.
 */
function TokenAttributionWidget({ analytics }: WidgetBodyProps) {
  const tu = analytics.token_usage;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'tokenUsage');

  if (tu.sessions_with_token_data === 0) {
    return (
      <>
        <GhostRows count={3} />
        <CoverageNote text={note} />
      </>
    );
  }

  // Build a per-(model, tool) cell map from model_outcomes (which has the
  // model × host_tool cross). Tokens are session-level on token_usage.by_model
  // — not directly cross-attributed today, so each row's token count is the
  // model total. The cells render session counts per (model, tool) for the
  // cross-attribution; tokens render once at the row's right edge as the
  // model total. Honest framing: until per-(model, tool) tokens land, the
  // cross-cell is "did this tool run this model at all, and how much did it
  // run it" via session count, not exact tokens.
  const sessionMatrix = new Map<string, number>();
  const toolSet = new Set<string>();
  for (const m of analytics.model_outcomes) {
    if (!m.host_tool || m.host_tool === 'unknown') continue;
    toolSet.add(m.host_tool);
    const key = `${m.agent_model}:${m.host_tool}`;
    sessionMatrix.set(key, (sessionMatrix.get(key) ?? 0) + m.count);
  }

  const toolCols = [...toolSet]
    .map((t) => ({
      host_tool: t,
      total: tu.by_tool.find((x) => x.host_tool === t)?.input_tokens ?? 0,
    }))
    .sort((a, b) => b.total - a.total);
  const modelRows = [...tu.by_model].sort(
    (a, b) => b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens),
  );

  const totalTokens = tu.total_input_tokens + tu.total_output_tokens;
  const totalCost = tu.total_estimated_cost_usd;

  return (
    <div className={styles.attribWrap}>
      <div className={styles.attribGrid}>
        <span className={styles.attribCornerCell}>model</span>
        {toolCols.map((t) => {
          const meta = getToolMeta(t.host_tool);
          return (
            <span key={t.host_tool} className={styles.attribHeaderCell}>
              <span
                className={styles.attribHeaderDot}
                style={{ background: meta.color }}
                aria-hidden="true"
              />
              {meta.label}
            </span>
          );
        })}
        <span className={styles.attribHeaderCellRight}>tokens</span>
        {modelRows.map((m, i) => (
          <div
            key={m.agent_model}
            className={styles.attribRow}
            style={
              {
                '--row-index': i,
                '--attrib-cols': toolCols.length,
              } as CSSProperties
            }
          >
            <span className={styles.attribRowLabel}>{m.agent_model}</span>
            {toolCols.map((t) => {
              const sessions = sessionMatrix.get(`${m.agent_model}:${t.host_tool}`) ?? 0;
              if (sessions === 0) {
                return (
                  <span key={t.host_tool} className={styles.attribCellEmpty}>
                    —
                  </span>
                );
              }
              return (
                <span key={t.host_tool} className={styles.attribCell}>
                  {sessions}
                </span>
              );
            })}
            <span className={styles.attribCellRight}>
              {formatTokenCount(m.input_tokens + m.output_tokens)}
              {m.estimated_cost_usd != null && m.estimated_cost_usd > 0 && (
                <span className={styles.attribCellSub}> {formatCost(m.estimated_cost_usd, 2)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className={styles.attribFooter}>
        <span className={styles.attribFooterStat}>
          <span className={styles.attribFooterValue}>{formatTokenCount(totalTokens)}</span> total
          tokens
        </span>
        {totalCost != null && totalCost > 0 ? (
          <span className={styles.attribFooterStat}>
            <span className={styles.attribFooterValue}>{formatCost(totalCost, 2)}</span> total cost
          </span>
        ) : null}
        <span className={styles.attribFooterCells}>
          Cells = sessions per (model, tool). Tokens row-totalled.
        </span>
      </div>
      <CoverageNote text={note} />
    </div>
  );
}

// Suppress "unused" lint until detail-view drill exposes the InlineDelta.
const _keepInlineDelta = InlineDelta;

// Re-exports `UserAnalytics` shape for IDE jump-to-definition convenience.
export type { UserAnalytics };

export const toolWidgets: WidgetRegistry = {
  'tool-handoffs': ToolHandoffsWidget,
  'tool-work-type-fit': ToolWorkTypeFitWidget,
  'one-shot-by-tool': OneShotByToolWidget,
  'tool-capability-coverage': ToolCapabilityCoverageWidget,
  'tool-call-errors': ToolCallErrorsWidget,
  'model-mix': ModelMixWidget,
  'token-attribution': TokenAttributionWidget,
};
