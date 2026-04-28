import { Fragment, useMemo, type ReactNode } from 'react';
import DottedMap from 'dotted-map/without-countries';
import { COUNTRY_COORDS } from '../../components/GlobalMap/countryCoords.js';
import { useGlobalStats } from '../../hooks/useGlobalStats.js';
import { useGlobalRank } from '../../hooks/useGlobalRank.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.js';
import ViewHeader from '../../components/ViewHeader/ViewHeader.js';
import { MAP_JSON } from './mapData.js';
import styles from './GlobalView.module.css';

function formatNum(n: number): string {
  if (n >= 100000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

// ── World map ────────────────────────────────

// Pre-computed accent-blue shades at three intensities. dotted-map's color
// arg goes directly into an SVG `fill` attribute, and the library rejects
// `rgba()` strings silently - the earlier attempt to vary alpha dropped pins
// entirely. Hex works, so density is encoded via (a) a discrete 3-step
// palette that darkens with count share, and (b) a continuous radius ramp.
// The darkest step is the token accent; the lighter steps blend toward the
// page background so low-density countries stay present without shouting.
const ACCENT_DENSITY_PALETTE = ['#a4b6ff', '#6683ff', '#1d46ff'] as const;

function WorldMap({ countries }: { countries: Record<string, number> }): ReactNode {
  const svgStr = useMemo(() => {
    const map = new DottedMap({ map: JSON.parse(MAP_JSON) });
    const counts = Object.values(countries);
    const maxCount = Math.max(...counts, 1);
    for (const [cc, count] of Object.entries(countries)) {
      if (!(cc in COUNTRY_COORDS)) continue;
      const [lat, lng] = COUNTRY_COORDS[cc];
      // `^0.6` pulls tiny-count countries above the perceptual floor -
      // pure linear scaling would leave single-dev countries visibly
      // indistinguishable from the gray base map.
      const intensity = Math.pow(count / maxCount, 0.6);
      const bucket = intensity >= 0.66 ? 2 : intensity >= 0.33 ? 1 : 0;
      const color = ACCENT_DENSITY_PALETTE[bucket];
      const radius = 0.6 + intensity * 0.9;
      map.addPin({ lat, lng, svgOptions: { color, radius } });
    }
    return map.getSVG({
      radius: 0.2,
      color: '#bbb',
      shape: 'circle',
      backgroundColor: 'transparent',
    });
  }, [countries]);
  return <div className={styles.mapWrap} dangerouslySetInnerHTML={{ __html: svgStr }} />;
}

// ── Personal stat with user-vs-community spark ───────────────

function PersonalStat({
  value,
  label,
  userValue,
  communityValue,
}: {
  value: string;
  label: string;
  /** User's raw value on the same scale as communityValue. */
  userValue: number;
  communityValue: number;
}): ReactNode {
  // Always render the spark so every card in the strip shares the same
  // visual structure - a zero-data card should read as "waiting for data,"
  // not "broken or missing." When both values are zero, the track renders
  // empty with a muted caption; this is honest about the absence without
  // breaking the rhythm of the row.
  const hasAnyData = userValue > 0 || communityValue > 0;
  const max = hasAnyData ? Math.max(userValue, communityValue) * 1.2 : 1;
  const userPct = hasAnyData ? Math.min(100, (userValue / max) * 100) : 0;
  const communityPct = hasAnyData ? Math.min(100, (communityValue / max) * 100) : 0;
  const direction = userValue >= communityValue ? 'above' : 'below';

  let caption: ReactNode;
  let captionClass = styles.personalSpark_neutral;
  if (!hasAnyData) {
    caption = 'no community data yet';
  } else if (communityValue === 0) {
    caption = 'no peer average yet';
  } else {
    caption = `${direction === 'above' ? '↑' : '↓'} avg ${communityValue.toLocaleString()}`;
    captionClass = styles[`personalSpark_${direction}`];
  }

  return (
    <div className={styles.personalStat}>
      <span className={styles.personalValue}>{value}</span>
      <span className={styles.personalLabel}>{label}</span>
      <div className={styles.personalSpark} title="you vs community average">
        <div className={styles.personalSparkTrack}>
          <div className={styles.personalSparkUserFill} style={{ width: `${userPct}%` }} />
          {hasAnyData && communityValue > 0 && (
            <div
              className={styles.personalSparkCommunity}
              style={{ left: `${communityPct}%` }}
              aria-hidden="true"
            />
          )}
        </div>
        <span className={`${styles.personalSparkCaption} ${captionClass}`}>{caption}</span>
      </div>
    </div>
  );
}

// ── Section header with rule ─────────────────

function SectionHead({ label }: { label: string }): ReactNode {
  return (
    <div className={styles.sectionHeader}>
      <span className={styles.sectionLabel}>{label}</span>
      <span className={styles.sectionRule} />
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Radar chart
// ═══════════════════════════════════════════════

// Two narrow composites instead of one wide one. Each aggregates three
// already-commensurable percentile axes (all are percentile ranks, all are
// "higher = better" post-normalization in rank.ts). Weights are opinionated
// - Effectiveness tilts to completion+reliability because coordination is
// chinmeister's product stance; Productivity tilts to output because volume is
// what shows up in a dev's day-to-day. Weights render on the page so the
// rubric isn't hidden.
const COMPOSITES = [
  {
    key: 'effectiveness' as const,
    label: 'Effectiveness',
    caption: 'Does your work land',
    parts: [
      { key: 'completion_rate', label: 'completion', weight: 0.4 },
      { key: 'stuck_rate', label: 'reliability', weight: 0.35 },
      { key: 'first_edit_latency', label: 'first-edit', weight: 0.25 },
    ],
  },
  {
    key: 'productivity' as const,
    label: 'Productivity',
    caption: 'How much moves through you',
    parts: [
      { key: 'lines_per_session', label: 'output', weight: 0.4 },
      { key: 'edit_velocity', label: 'velocity', weight: 0.35 },
      { key: 'focus_hours', label: 'focus', weight: 0.25 },
    ],
  },
];

function computeComposite(
  parts: Array<{ key: string; weight: number }>,
  metrics: Record<string, { percentile: number }>,
): number {
  let sum = 0;
  let totalWeight = 0;
  for (const p of parts) {
    const pct = metrics[p.key]?.percentile;
    if (typeof pct === 'number') {
      sum += pct * p.weight;
      totalWeight += p.weight;
    }
  }
  if (totalWeight === 0) return 0;
  return Math.round(sum / totalWeight);
}

function CompositeBlock({
  label,
  caption,
  score,
  parts,
  enabled,
}: {
  label: string;
  caption: string;
  score: number;
  parts: Array<{ label: string; weight: number }>;
  enabled: boolean;
}): ReactNode {
  const width = enabled ? Math.max(0, Math.min(100, score)) : 0;
  return (
    <div className={styles.composite}>
      <span className={styles.compositeLabel}>{label}</span>
      <div className={styles.compositeScoreRow}>
        <span className={styles.compositeScore} style={{ '--score': score } as React.CSSProperties}>
          {enabled ? score : '-'}
        </span>
        <span className={styles.compositeSuffix}>{enabled ? 'th' : ''}</span>
        <span className={styles.compositeDenom} aria-hidden="true">
          / 100
        </span>
      </div>
      {/* Gauge track. Fill width encodes percentile; marker dot sits at the
          current position; a subtle tick at 50% anchors the community median
          as a visual reference. Matches the QOVES range-bar treatment. */}
      <div className={styles.compositeGauge}>
        <div className={styles.compositeGaugeTrack}>
          <div className={styles.compositeGaugeFill} style={{ width: `${width}%` }} />
          <div className={styles.compositeGaugeMedian} />
          {enabled && <div className={styles.compositeGaugeMarker} style={{ left: `${width}%` }} />}
        </div>
        <div className={styles.compositeGaugeEnds}>
          <span>bottom</span>
          <span>median</span>
          <span>top</span>
        </div>
      </div>
      <span className={styles.compositeCaption}>{caption}</span>
      <div className={styles.compositeParts}>
        {parts.map((p) => (
          <span key={p.label} className={styles.compositePart}>
            {p.label} <span className={styles.compositeWeight}>{Math.round(p.weight * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// 6 axes. Dropped `tool_diversity` (more tools ≠ better) and swapped
// `total_lines` for `lines_per_session` - lifetime totals were heavily
// tenure-biased (a dev starting today had no path to catch up). Per-session
// is tenure-neutral and measures the same underlying signal: how much moves
// through each session.
const RADAR_AXES = [
  {
    key: 'completion_rate',
    label: 'Completion',
    desc: 'Share of your sessions that finish instead of getting abandoned.',
  },
  {
    key: 'edit_velocity',
    label: 'Velocity',
    desc: 'Edits per minute of active session time.',
  },
  {
    key: 'first_edit_latency',
    label: 'First edit',
    desc: 'Time from session start to the first code change. Lower is better.',
  },
  {
    key: 'stuck_rate',
    label: 'Reliability',
    desc: 'Inverse of stuck sessions plus tool-call error rate.',
  },
  {
    key: 'focus_hours',
    label: 'Focus',
    desc: 'Hours of active work - idle time with the agent open does not count.',
  },
  {
    key: 'lines_per_session',
    label: 'Output',
    desc: 'Lines of code written per session. Tenure-neutral.',
  },
];

function RadarChart({ metrics }: { metrics: Record<string, { percentile: number }> }): ReactNode {
  const cx = 110,
    cy = 110,
    r = 80;
  const n = RADAR_AXES.length;

  const points = RADAR_AXES.map((axis, i) => {
    const pct = (metrics[axis.key]?.percentile ?? 0) / 100;
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return { x: cx + r * pct * Math.cos(angle), y: cy + r * pct * Math.sin(angle) };
  });
  const polygonPath = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const rings = [0.25, 0.5, 0.75, 1.0];
  // Axis labels now carry two text nodes: the name on top (var(--soft))
  // and the live percentile value below (var(--ink), larger). Gives the
  // radar information density - users see their rank per-axis without
  // having to map polygon position to a number. Labels push slightly
  // further out to make room for the two-line format.
  const axes = RADAR_AXES.map((axis, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const pct = metrics[axis.key]?.percentile ?? 0;
    return {
      x2: cx + r * Math.cos(angle),
      y2: cy + r * Math.sin(angle),
      lx: cx + (r + 26) * Math.cos(angle),
      ly: cy + (r + 26) * Math.sin(angle),
      label: axis.label,
      percentile: Math.round(pct),
    };
  });

  return (
    <div className={styles.radarCard}>
      <div className={styles.radarWrap}>
        <svg viewBox="0 0 220 220" className={styles.radarSvg}>
          {rings.map((ring) => {
            const rPts = RADAR_AXES.map((_, i) => {
              const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
              return `${(cx + r * ring * Math.cos(angle)).toFixed(1)},${(cy + r * ring * Math.sin(angle)).toFixed(1)}`;
            });
            // 50th-percentile ring gets the accent-blue dashed treatment
            // so the community median is visually named, not just one of
            // four anonymous hairlines. The others stay hairline gray.
            const isMedian = ring === 0.5;
            return (
              <polygon
                key={ring}
                points={rPts.join(' ')}
                fill="none"
                stroke={isMedian ? 'var(--accent)' : 'var(--hairline)'}
                strokeWidth={isMedian ? 0.9 : 0.75}
                strokeDasharray={isMedian ? '2 2' : undefined}
                strokeOpacity={isMedian ? 0.45 : 1}
              />
            );
          })}
          {axes.map((a) => (
            <line
              key={a.label}
              x1={cx}
              y1={cy}
              x2={a.x2}
              y2={a.y2}
              stroke="var(--hairline)"
              strokeWidth="0.5"
            />
          ))}
          <polygon
            points={polygonPath}
            fill="var(--ink)"
            fillOpacity="0.06"
            stroke="var(--ink)"
            strokeWidth="1.5"
            strokeOpacity="0.4"
            strokeLinejoin="round"
          />
          {points.map((p, i) => (
            <circle
              key={RADAR_AXES[i].key}
              cx={p.x}
              cy={p.y}
              r="3.5"
              fill="var(--ink)"
              opacity="0.5"
            />
          ))}
          {axes.map((a) => (
            <g key={a.label}>
              <text
                x={a.lx}
                y={a.ly - 3}
                textAnchor="middle"
                dominantBaseline="middle"
                className={styles.radarLabel}
              >
                {a.label}
              </text>
              <text
                x={a.lx}
                y={a.ly + 5}
                textAnchor="middle"
                dominantBaseline="middle"
                className={styles.radarLabelValue}
              >
                {a.percentile}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className={styles.radarLegend}>
        <span className={styles.radarLegendDashed} />
        <span className={styles.radarLegendText}>community median</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Outcome breakdown
// ═══════════════════════════════════════════════

function OutcomeBreakdown({
  completed,
  abandoned,
  failed,
  total,
}: {
  completed: number;
  abandoned: number;
  failed: number;
  total: number;
}): ReactNode {
  const pcts =
    total > 0
      ? {
          completed: (completed / total) * 100,
          abandoned: (abandoned / total) * 100,
          failed: (failed / total) * 100,
          unknown: Math.max(0, ((total - completed - abandoned - failed) / total) * 100),
        }
      : { completed: 0, abandoned: 0, failed: 0, unknown: 100 };

  return (
    <div className={styles.outcomeBreakdown}>
      <div className={styles.outcomeBar}>
        {pcts.completed > 0 && (
          <div
            className={styles.outcomeSegment}
            style={{ width: `${pcts.completed}%`, background: 'var(--success)' }}
          />
        )}
        {pcts.abandoned > 0 && (
          <div
            className={styles.outcomeSegment}
            style={{ width: `${pcts.abandoned}%`, background: 'var(--warn)' }}
          />
        )}
        {pcts.failed > 0 && (
          <div
            className={styles.outcomeSegment}
            style={{ width: `${pcts.failed}%`, background: 'var(--danger)' }}
          />
        )}
        {pcts.unknown > 0 && (
          <div
            className={styles.outcomeSegment}
            style={{ width: `${pcts.unknown}%`, background: 'var(--hairline)' }}
          />
        )}
      </div>
      <div className={styles.outcomeLegend}>
        <span className={styles.outcomeItem}>
          <span className={styles.outcomeDot} style={{ background: 'var(--success)' }} />
          {completed} finished
        </span>
        <span className={styles.outcomeItem}>
          <span className={styles.outcomeDot} style={{ background: 'var(--warn)' }} />
          {abandoned} abandoned
        </span>
        <span className={styles.outcomeItem}>
          <span className={styles.outcomeDot} style={{ background: 'var(--danger)' }} />
          {failed} failed
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Percentile cards - 2 reusable viz idioms
//    · BarCard:  1-D position, user marker on track. For metrics with no
//                community distribution available (velocity, stuck, focus, …).
//    · DistCard: bracket histogram with user's bracket lit. For metrics where
//                the backend exposes a real community distribution
//                (completion_rate, tool_count).
// ═══════════════════════════════════════════════

interface VizProps {
  metric: string;
  percentile: number;
  value: string;
  unit?: string;
  lowLabel?: string;
  highLabel?: string;
  context?: string;
}

function BarCard({
  metric,
  percentile,
  value,
  unit,
  lowLabel,
  highLabel,
  context,
}: VizProps): ReactNode {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardMetric}>{metric}</span>
        <span className={styles.cardPercentile}>
          {Math.round(percentile)}
          <span className={styles.cardSuffix}>th</span>
        </span>
      </div>
      <div className={styles.barWrap}>
        <div className={styles.barTrack}>
          <div className={styles.barFill} style={{ width: `${percentile}%` }} />
          {/* Community median reference tick. Sits behind the user marker so
              whenever the user is near 50 the hierarchy reads user-on-top.
              Accent color names it as "where the community center is." */}
          <div className={styles.barMedianTick} aria-hidden="true" />
          <div className={styles.barMarker} style={{ left: `${percentile}%` }} />
        </div>
        <div className={styles.barLabels}>
          <span className={styles.barLabel}>{lowLabel}</span>
          <span className={styles.barLabel}>{highLabel}</span>
        </div>
      </div>
      <div className={styles.cardValueRow}>
        <span className={styles.cardValue}>{value}</span>
        {unit && <span className={styles.cardUnit}>{unit}</span>}
      </div>
      {context && <span className={styles.cardContext}>{context}</span>}
    </div>
  );
}

function DistCard({
  metric,
  percentile,
  value,
  unit,
  distribution,
  userBucket,
  context,
}: VizProps & {
  distribution: Array<{ label: string; pct: number }>;
  userBucket: string | null;
}): ReactNode {
  const maxPct = Math.max(...distribution.map((d) => d.pct), 1);
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardMetric}>{metric}</span>
        <span className={styles.cardPercentile}>
          {Math.round(percentile)}
          <span className={styles.cardSuffix}>th</span>
        </span>
      </div>
      <div className={styles.histoWrap}>
        {distribution.length === 0 ? (
          <div className={styles.histoEmpty} />
        ) : (
          distribution.map((d) => (
            <div key={d.label} className={styles.histoCol}>
              <div className={styles.histoBarWrap}>
                <div
                  className={`${styles.histoBar} ${d.label === userBucket ? styles.histoBarActive : ''}`}
                  style={{ height: `${(d.pct / maxPct) * 100}%` }}
                />
              </div>
              <span
                className={`${styles.histoLabel} ${d.label === userBucket ? styles.histoLabelActive : ''}`}
              >
                {d.label}
              </span>
            </div>
          ))
        )}
      </div>
      <div className={styles.cardValueRow}>
        <span className={styles.cardValue}>{value}</span>
        {unit && <span className={styles.cardUnit}>{unit}</span>}
      </div>
      {context && <span className={styles.cardContext}>{context}</span>}
    </div>
  );
}

// ── Co-occurrence matrix for tool combinations ───────────────

/**
 * Parse a CSS color string (hex or hsl()) into an [r, g, b] tuple, 0-255.
 * Needed because getToolMeta returns either - known tools use hex brand
 * colors, unknown tools get an HSL-derived fallback.
 * Returns null if the input is unrecognized so the caller can fall back to
 * a neutral ink rendering rather than throwing.
 */
function parseColor(input: string): [number, number, number] | null {
  if (input.startsWith('#')) {
    const h = input.slice(1);
    if (h.length === 3) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    }
    if (h.length === 6) {
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
    }
    return null;
  }
  const hslMatch = input.match(
    /^hsl\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)$/i,
  );
  if (hslMatch) {
    const h = Number(hslMatch[1]) / 360;
    const s = Number(hslMatch[2]) / 100;
    const l = Number(hslMatch[3]) / 100;
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hueToRgb = (t: number): number => {
      let u = t;
      if (u < 0) u += 1;
      if (u > 1) u -= 1;
      if (u < 1 / 6) return p + (q - p) * 6 * u;
      if (u < 1 / 2) return q;
      if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
      return p;
    };
    return [
      Math.round(hueToRgb(h + 1 / 3) * 255),
      Math.round(hueToRgb(h) * 255),
      Math.round(hueToRgb(h - 1 / 3) * 255),
    ];
  }
  return null;
}

/** Average two tool brand colors into a single rgba with the given alpha. */
function blendToolColors(a: string, b: string, alpha: number): string {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return `rgba(18, 19, 23, ${alpha})`;
  return `rgba(${Math.round((pa[0] + pb[0]) / 2)}, ${Math.round((pa[1] + pb[1]) / 2)}, ${Math.round((pa[2] + pb[2]) / 2)}, ${alpha.toFixed(2)})`;
}

function ToolComboMatrix({
  pairs,
}: {
  pairs: Array<{ toolA: string; toolB: string; users: number }>;
}): ReactNode {
  // Derive the distinct tool axis from the pair data itself. Sort by a tool's
  // total pair-volume so the densest cells cluster top-left. Clamp to 12 so
  // label density stays legible - if the community ever cracks 12 tools with
  // co-usage, the tail gets grouped under "…".
  const { tools, pairMap, maxUsers } = useMemo(() => {
    const volume = new Map<string, number>();
    const pm = new Map<string, number>();
    let mu = 0;
    for (const p of pairs) {
      volume.set(p.toolA, (volume.get(p.toolA) ?? 0) + p.users);
      volume.set(p.toolB, (volume.get(p.toolB) ?? 0) + p.users);
      const key = p.toolA < p.toolB ? `${p.toolA}|${p.toolB}` : `${p.toolB}|${p.toolA}`;
      pm.set(key, p.users);
      if (p.users > mu) mu = p.users;
    }
    const sorted = [...volume.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    return { tools: sorted.slice(0, 12), pairMap: pm, maxUsers: Math.max(mu, 1) };
  }, [pairs]);

  if (tools.length < 2) {
    return (
      <div className={styles.matrixEmpty}>
        Tool combinations will appear once enough developers use multiple tools.
      </div>
    );
  }

  // Grid: one leading column for row labels, then N data columns.
  const gridCols = `minmax(92px, auto) repeat(${tools.length}, minmax(20px, 1fr))`;

  return (
    <div className={styles.matrix} style={{ gridTemplateColumns: gridCols }}>
      {/* Column-header row: blank corner + tool labels. Label color pulls
          the tool's brand color so the matrix reads as a product map - the
          category IS the color. Per design brief: categorical data is a
          legitimate place for color on an otherwise-monochrome surface. */}
      <span className={styles.matrixCorner} />
      {tools.map((t) => {
        const meta = getToolMeta(t);
        return (
          <span
            key={`col-${t}`}
            className={styles.matrixColLabel}
            style={{ color: meta.color }}
            title={meta.label}
          >
            {meta.label}
          </span>
        );
      })}
      {/* Data rows */}
      {tools.map((rowTool, ri) => {
        const rowMeta = getToolMeta(rowTool);
        return (
          <Fragment key={`row-${rowTool}`}>
            <span className={styles.matrixRowLabel} style={{ color: rowMeta.color }}>
              {rowMeta.label}
            </span>
            {tools.map((colTool, ci) => {
              if (ci === ri) {
                return <span key={`${ri}-${ci}`} className={styles.matrixDiag} />;
              }
              if (ci < ri) {
                // Lower triangle: render mirrored but faint, so the shape still
                // reads as a square without double-counting.
                return <span key={`${ri}-${ci}`} className={styles.matrixMirror} />;
              }
              const key = rowTool < colTool ? `${rowTool}|${colTool}` : `${colTool}|${rowTool}`;
              const users = pairMap.get(key) ?? 0;
              const intensity = users / maxUsers;
              // Cell color = blend of the two tools' brand colors. Cell
              // opacity = how common this pair is among developers. Two
              // channels of data on the same cell: color tells WHICH pair,
              // density tells HOW MANY. Empty cells (no co-usage) render at
              // the blended color with very low alpha so the grid reads as
              // a product map, not a checkerboard.
              const alpha = users === 0 ? 0.05 : 0.15 + intensity * 0.75;
              const colorRow = getToolMeta(rowTool).color;
              const colorCol = getToolMeta(colTool).color;
              const background = blendToolColors(colorRow, colorCol, alpha);
              return (
                <span
                  key={`${ri}-${ci}`}
                  className={styles.matrixCell}
                  style={{ background }}
                  title={`${getToolMeta(rowTool).label} + ${getToolMeta(colTool).label}: ${users} developer${users === 1 ? '' : 's'}`}
                />
              );
            })}
          </Fragment>
        );
      })}
    </div>
  );
}

// ── Leaderboard ──────────────────────────────

interface LeaderboardItem {
  name: string;
  value: string;
  bar: number;
  sub?: string;
  /** Tool id - when present, renders the tool's icon + brand-colored bar fill. */
  toolId?: string;
}

function LeaderboardSection({
  title,
  items,
}: {
  title: string;
  items: LeaderboardItem[];
}): ReactNode {
  const maxBar = Math.max(...items.map((i) => i.bar), 1);
  return (
    <div className={styles.leaderboard}>
      <span className={styles.leaderboardTitle}>{title}</span>
      {items.length === 0 ? (
        <div className={`${styles.leaderboardRows} ${styles.ghostLeaderboard}`}>
          {[70, 50, 30].map((w, i) => (
            <div key={i} className={styles.ghostRow}>
              <div className={styles.ghostText} style={{ width: 16 }} />
              <div className={styles.ghostText} style={{ width: 80 }} />
              <div className={styles.ghostBar} style={{ width: `${w}%` }} />
              <div className={styles.ghostText} style={{ width: 32 }} />
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.leaderboardRows}>
          {items.map((item, i) => {
            const brandColor = item.toolId ? getToolMeta(item.toolId).color : null;
            return (
              <div
                key={item.name}
                className={styles.leaderboardRow}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span className={styles.leaderboardRank}>{i + 1}</span>
                <span className={styles.leaderboardName}>
                  {item.toolId && <ToolIcon tool={item.toolId} size={18} />}
                  <span className={styles.leaderboardNameText}>{item.name}</span>
                </span>
                <div className={styles.leaderboardBarTrack}>
                  <div
                    className={styles.leaderboardBarFill}
                    style={{
                      width: `${(item.bar / maxBar) * 100}%`,
                      /* Brand color on the fill when we have a tool id;
                         ink otherwise (for model leaderboard where no
                         categorical color exists). Opacity softens the
                         raw brand so the bars still read as a calm row
                         of data, not a paint sample. */
                      background: brandColor ?? undefined,
                      opacity: brandColor ? 0.7 : undefined,
                    }}
                  />
                </div>
                <span className={styles.leaderboardValue}>{item.value}</span>
                {item.sub && <span className={styles.leaderboardSub}>{item.sub}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Main view
// ═══════════════════════════════════════════════

export default function GlobalView(): ReactNode {
  const gs = useGlobalStats();
  const gr = useGlobalRank();
  // Only count countries we can actually place on the map. Lobby presence
  // stores `XX` for any heartbeat without a valid CF-IPCountry header
  // (wrangler dev, geolocation failures); those would inflate the hero to
  // "1 countries" while the map renders nothing, since XX is not in
  // COUNTRY_COORDS. Same filter the WorldMap applies so hero count and
  // map pin count stay in lockstep.
  const countryCount = Object.keys(gs.countries).filter((cc) => cc in COUNTRY_COORDS).length;
  const m = gr.metrics;
  const t = gr.totals;
  const avg = gs.globalAverages;
  // Threshold for surfacing percentile ranks. Not a statistical boundary - just
  // a "wait until your metrics stabilize a bit" floor. Below 5, completion rate
  // lives in 6 coarse buckets (0/20/40/60/80/100%) and flips violently session-
  // to-session. 5 is a compromise between early visibility and stable ranks.
  const hasEnoughSessions = t.totalSessions >= 5;

  // Community completion-rate bracket histogram - used by the "Sessions
  // completed" DistCard. Percentages are share of developers per bracket.
  const completionHisto = useMemo(() => {
    if (gs.completionDistribution.length === 0) return [];
    const totalUsers = gs.completionDistribution.reduce((s, d) => s + (d.users as number), 0);
    return gs.completionDistribution.map((d) => ({
      label: String(d.bracket),
      pct: totalUsers > 0 ? Math.round(((d.users as number) / totalUsers) * 100) : 0,
    }));
  }, [gs.completionDistribution]);

  const userCompletionRate = m.completion_rate?.value ?? 0;
  const userCompletionBracket = useMemo(() => {
    if (userCompletionRate >= 90) return '90-100';
    if (userCompletionRate >= 80) return '80-89';
    if (userCompletionRate >= 70) return '70-79';
    if (userCompletionRate >= 60) return '60-69';
    if (userCompletionRate >= 50) return '50-59';
    return '0-49';
  }, [userCompletionRate]);

  // Community tool-count histogram - how many distinct tools each developer
  // uses. Computed at /stats, previously unrendered. Surfaces the user's own
  // tool count against the community distribution.
  const toolCountHisto = useMemo(() => {
    if (gs.toolCountDistribution.length === 0) return [];
    const totalUsers = gs.toolCountDistribution.reduce((s, d) => s + d.users, 0);
    return gs.toolCountDistribution.map((d) => ({
      label: String(d.count),
      pct: totalUsers > 0 ? Math.round((d.users / totalUsers) * 100) : 0,
    }));
  }, [gs.toolCountDistribution]);

  const userToolCount = m.tool_diversity?.value ?? 0;

  return (
    <div className={styles.global}>
      <ViewHeader eyebrow="Across all developers" title="Global" />

      {/* ── Hero ── */}
      <div className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.onlinePulse}>
            <span className={styles.onlineCount}>{gs.online.toLocaleString()}</span>
            <span className={styles.onlineLabel}>
              {gs.online === 1 ? 'developer online' : 'developers online'}
            </span>
          </div>
          <div className={styles.heroStats}>
            <div className={styles.heroStat}>
              <span className={styles.heroStatValue}>{gs.totalUsers.toLocaleString()}</span>
              <span className={styles.heroStatLabel}>developers</span>
            </div>
            <div className={styles.heroStat}>
              <span className={styles.heroStatValue}>{countryCount}</span>
              <span className={styles.heroStatLabel}>countries</span>
            </div>
            <div className={styles.heroStat}>
              <span className={styles.heroStatValue}>{formatNum(gs.totalSessions)}</span>
              <span className={styles.heroStatLabel}>sessions</span>
            </div>
            <div className={styles.heroStat}>
              <span className={styles.heroStatValue}>{formatNum(gs.totalEdits)}</span>
              <span className={styles.heroStatLabel}>edits</span>
            </div>
          </div>
        </div>
        <WorldMap countries={gs.countries} />
      </div>

      {/* ── Percentile ranks ── */}
      <section className={styles.section}>
        <SectionHead label="Your Percentile Ranks" />
        {!hasEnoughSessions && (
          <p className={styles.gateMessage}>
            Complete {10 - t.totalSessions} more session
            {10 - t.totalSessions === 1 ? '' : 's'} to unlock your percentile ranks.
          </p>
        )}
        <div
          className={styles.rankGroup}
          style={!hasEnoughSessions ? { opacity: 0.35, pointerEvents: 'none' } : undefined}
        >
          <div className={styles.compositeRow}>
            {COMPOSITES.map((c) => (
              <CompositeBlock
                key={c.key}
                label={c.label}
                caption={c.caption}
                score={computeComposite(c.parts, m)}
                parts={c.parts}
                enabled={hasEnoughSessions}
              />
            ))}
          </div>
          <div className={styles.scoreSection}>
            <RadarChart metrics={m} />
            <div className={styles.axisList}>
              {RADAR_AXES.map((axis) => (
                <div key={axis.key} className={styles.axisRow}>
                  <span className={styles.axisName}>{axis.label}</span>
                  <span className={styles.axisDesc}>{axis.desc}</span>
                </div>
              ))}
              <span className={styles.axisFooter}>
                {gr.totalDevelopers > 0
                  ? `Against ${gr.totalDevelopers.toLocaleString()} developers with at least one session. Composites are weighted groupings of the six axes, not a single ranking.`
                  : 'Composites are weighted groupings of the axes, not a single overall ranking.'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Your Totals ── */}
      <section className={styles.section}>
        <SectionHead label="Your Totals" />
        <div className={styles.personalStrip}>
          <PersonalStat
            value={formatNum(t.totalSessions)}
            label="sessions"
            userValue={t.totalSessions}
            communityValue={avg.total_sessions}
          />
          <PersonalStat
            value={formatNum(t.totalEdits)}
            label="edits"
            userValue={t.totalEdits}
            communityValue={avg.total_edits}
          />
          <PersonalStat
            value={formatNum(t.totalLinesAdded)}
            label="lines written"
            userValue={t.totalLinesAdded}
            communityValue={avg.total_lines_added}
          />
          <PersonalStat
            value={String(Math.round(t.totalDurationMin / 60))}
            label="focus hours"
            userValue={t.totalDurationMin / 60}
            communityValue={avg.focus_hours}
          />
          <PersonalStat
            value={formatNum(t.totalInputTokens + t.totalOutputTokens)}
            label="tokens used"
            userValue={t.totalInputTokens + t.totalOutputTokens}
            communityValue={avg.total_tokens}
          />
          <PersonalStat
            value={String(t.totalMemoriesSaved)}
            label="memories saved"
            userValue={t.totalMemoriesSaved}
            communityValue={avg.total_memories}
          />
        </div>
        <OutcomeBreakdown
          completed={t.completedSessions}
          abandoned={t.abandonedSessions}
          failed={t.failedSessions}
          total={t.totalSessions}
        />
      </section>

      {/* ── Your Rank ── */}
      <section className={styles.section}>
        <SectionHead
          label={`Your Rank${gr.totalDevelopers > 0 ? ` among ${gr.totalDevelopers.toLocaleString()} developers` : ''}`}
        />
        {!hasEnoughSessions && (
          <p className={styles.gateMessage}>
            Complete {10 - t.totalSessions} more session{10 - t.totalSessions === 1 ? '' : 's'} to
            unlock percentile rankings.
          </p>
        )}
        <div
          className={styles.percentileGrid}
          style={!hasEnoughSessions ? { opacity: 0.35, pointerEvents: 'none' } : undefined}
        >
          <DistCard
            metric="Sessions completed"
            percentile={hasEnoughSessions ? (m.completion_rate?.percentile ?? 0) : 0}
            value={hasEnoughSessions ? `${m.completion_rate?.value ?? 0}%` : '--'}
            distribution={completionHisto}
            userBucket={hasEnoughSessions ? userCompletionBracket : null}
            context="Distribution of completion rates across all developers."
          />
          <BarCard
            metric="Time to first edit"
            percentile={hasEnoughSessions ? (m.first_edit_latency?.percentile ?? 0) : 0}
            value={hasEnoughSessions ? `${m.first_edit_latency?.value ?? 0}s` : '--'}
            lowLabel="Slower"
            highLabel="Faster"
            context={
              avg.first_edit_s > 0
                ? `The average developer waits ${avg.first_edit_s}s for their first edit.`
                : undefined
            }
          />
          <BarCard
            metric="Agent reliability"
            percentile={hasEnoughSessions ? (m.stuck_rate?.percentile ?? 0) : 0}
            value={hasEnoughSessions ? `${100 - (m.stuck_rate?.value ?? 0)}%` : '--'}
            lowLabel="Less reliable"
            highLabel="More reliable"
            context={
              t.totalStuck > 0
                ? `Your agents have stalled ${t.totalStuck} time${t.totalStuck === 1 ? '' : 's'} across all sessions.`
                : 'No stuck sessions recorded yet.'
            }
          />
          <BarCard
            metric="Edits per minute"
            percentile={hasEnoughSessions ? (m.edit_velocity?.percentile ?? 0) : 0}
            value={hasEnoughSessions ? String(m.edit_velocity?.value ?? 0) : '--'}
            lowLabel="Slower"
            highLabel="Faster"
            context={
              avg.edit_velocity > 0
                ? `The community averages ${avg.edit_velocity} edits per minute.`
                : undefined
            }
          />
          <BarCard
            metric="Output per session"
            percentile={hasEnoughSessions ? (m.lines_per_session?.percentile ?? 0) : 0}
            value={hasEnoughSessions ? (m.lines_per_session?.value ?? 0).toLocaleString() : '--'}
            unit="lines"
            lowLabel="Less"
            highLabel="More"
            context={
              avg.lines_per_session > 0
                ? `The average developer writes ${avg.lines_per_session.toLocaleString()} lines per session.`
                : undefined
            }
          />
          <BarCard
            metric="Code written"
            percentile={hasEnoughSessions ? (m.total_lines?.percentile ?? 0) : 0}
            value={hasEnoughSessions ? formatNum(m.total_lines?.value ?? 0) : '--'}
            unit="lines total"
            lowLabel="Less"
            highLabel="More"
            context={
              m.total_lines?.percentile != null && m.total_lines.percentile >= 50
                ? `You've written more code with AI than ${Math.round(m.total_lines.percentile)}% of developers.`
                : 'Your lifetime code output with AI agents.'
            }
          />
          <BarCard
            metric="Focus time"
            percentile={hasEnoughSessions ? (m.focus_hours?.percentile ?? 0) : 0}
            value={hasEnoughSessions ? String(m.focus_hours?.value ?? 0) : '--'}
            unit="hours"
            lowLabel="Less"
            highLabel="More"
            context={
              avg.focus_hours > 0
                ? `The average developer logs ${avg.focus_hours} hours of focused AI time.`
                : undefined
            }
          />
          <DistCard
            metric="Tools used"
            percentile={hasEnoughSessions ? (m.tool_diversity?.percentile ?? 0) : 0}
            value={hasEnoughSessions ? String(m.tool_diversity?.value ?? 0) : '--'}
            distribution={toolCountHisto}
            userBucket={hasEnoughSessions ? String(userToolCount) : null}
            context="How many AI tools each developer uses."
          />
        </div>
      </section>

      {/* ── What's Working ── */}
      <section className={styles.section}>
        <SectionHead label="What's Working" />
        <div className={styles.leaderboardGrid}>
          <LeaderboardSection
            title="Tool effectiveness"
            items={gs.toolEffectiveness.map((t) => ({
              name: getToolMeta(t.tool).label,
              value: `${t.completionRate}%`,
              bar: t.completionRate,
              sub: `${t.users} developers \u00b7 ${t.editVelocity} edits/m`,
              toolId: t.tool,
            }))}
          />
          <LeaderboardSection
            title="Model effectiveness"
            items={gs.modelEffectiveness.map((m) => ({
              name: m.model,
              value: `${m.completionRate}%`,
              bar: m.completionRate,
              sub: `${m.users} developers`,
            }))}
          />
        </div>
      </section>

      {/* ── Tool Combinations ── */}
      <section className={styles.section}>
        <SectionHead label="How Developers Stack Tools" />
        <ToolComboMatrix pairs={gs.toolCombinations} />
      </section>
    </div>
  );
}
