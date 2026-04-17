import { useMemo, type ReactNode } from 'react';
import DottedMap from 'dotted-map/without-countries';
import { COUNTRY_COORDS } from '../../components/GlobalMap/countryCoords.js';
import { useGlobalStats } from '../../hooks/useGlobalStats.js';
import { useGlobalRank, type EffectivenessTier } from '../../hooks/useGlobalRank.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import ViewHeader from '../../components/ViewHeader/ViewHeader.js';
import { MAP_JSON } from './mapData.js';
import styles from './GlobalView.module.css';

const ARC_LEN = Math.PI * 45;

const TIER_COLORS: Record<EffectivenessTier, string> = {
  Elite: 'var(--accent)',
  Strong: 'var(--success)',
  Solid: 'var(--ink)',
  Developing: 'var(--warn)',
  New: 'var(--muted)',
};

function formatNum(n: number): string {
  if (n >= 100000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function insightText(
  pct: number,
  metric: string,
  yours: number,
  community: number,
  better: 'higher' | 'lower',
): string {
  const diff = yours - community;
  if (community === 0 && yours === 0) return `Start sessions to see how you compare.`;
  if (community === 0) return `You're among the first to track ${metric.toLowerCase()}.`;
  const ratio = Math.abs(diff) / community;
  if (better === 'higher') {
    if (diff > 0 && ratio >= 0.5) return `Significantly above the community average.`;
    if (diff > 0) return `Above average across all developers.`;
    if (diff < 0 && ratio >= 0.5) return `Below the community average \u2014 room to improve.`;
    return `Near the community average.`;
  }
  if (diff < 0 && ratio >= 0.5) return `Well below the community average \u2014 that's good.`;
  if (diff < 0) return `Better than most developers.`;
  if (diff > 0 && ratio >= 0.5) return `Higher than average \u2014 room to improve.`;
  return `Near the community average.`;
}

// ── World map ────────────────────────────────

function WorldMap({ countries }: { countries: Record<string, number> }): ReactNode {
  const svgStr = useMemo(() => {
    const map = new DottedMap({ map: JSON.parse(MAP_JSON) });
    for (const cc of Object.keys(countries)) {
      if (cc in COUNTRY_COORDS) {
        const [lat, lng] = COUNTRY_COORDS[cc];
        map.addPin({ lat, lng, svgOptions: { color: '#222', radius: 0.55 } });
      }
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
//  Score card
// ═══════════════════════════════════════════════

function ScoreCard({
  score,
  tier,
  totalDevelopers,
  sessions,
}: {
  score: number;
  tier: EffectivenessTier;
  totalDevelopers: number;
  sessions: number;
}): ReactNode {
  const tierDesc: Record<EffectivenessTier, string> = {
    Elite: 'Exceptional AI-assisted developer. Your sessions consistently succeed.',
    Strong: 'Consistently effective with agents across tools and projects.',
    Solid: "Competent and growing. You're building strong AI workflow habits.",
    Developing: 'Building AI workflow skills. Keep experimenting with different approaches.',
    New:
      sessions < 10
        ? `Complete ${10 - sessions} more session${10 - sessions === 1 ? '' : 's'} to unlock your effectiveness rating.`
        : 'Just getting started with AI-assisted development.',
  };

  const circ = 2 * Math.PI * 64;

  return (
    <div className={styles.scoreCard}>
      <div className={styles.scoreRing}>
        <svg viewBox="0 0 148 148" className={styles.scoreRingSvg}>
          <circle cx="74" cy="74" r="64" fill="none" stroke="var(--hairline)" strokeWidth="5" />
          <circle
            cx="74"
            cy="74"
            r="64"
            fill="none"
            stroke={TIER_COLORS[tier]}
            strokeWidth="5"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - score / 100)}
            strokeLinecap="round"
            transform="rotate(-90 74 74)"
            className={styles.scoreRingFill}
          />
        </svg>
        <div className={styles.scoreInner}>
          <span className={styles.scoreNumber}>{score}</span>
        </div>
      </div>
      <span className={styles.scoreTier} style={{ color: TIER_COLORS[tier] }}>
        {tier}
      </span>
      <span className={styles.scoreDesc}>{tierDesc[tier]}</span>
      {totalDevelopers > 0 && tier !== 'New' && (
        <span className={styles.scoreContext}>
          Top {Math.max(1, 100 - score)}%
          {totalDevelopers >= 100
            ? ` of ${totalDevelopers.toLocaleString()} developers`
            : ' of developers'}
        </span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Radar chart
// ═══════════════════════════════════════════════

const RADAR_AXES = [
  { key: 'completion_rate', label: 'Completion' },
  { key: 'edit_velocity', label: 'Velocity' },
  { key: 'lines_per_session', label: 'Output' },
  { key: 'first_edit_latency', label: 'First edit' },
  { key: 'stuck_rate', label: 'Reliability' },
  { key: 'focus_hours', label: 'Focus' },
  { key: 'total_lines', label: 'Experience' },
  { key: 'tool_diversity', label: 'Tools' },
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
  const axes = RADAR_AXES.map((axis, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return {
      x2: cx + r * Math.cos(angle),
      y2: cy + r * Math.sin(angle),
      lx: cx + (r + 22) * Math.cos(angle),
      ly: cy + (r + 22) * Math.sin(angle),
      label: axis.label,
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
            return (
              <polygon
                key={ring}
                points={rPts.join(' ')}
                fill="none"
                stroke="var(--hairline)"
                strokeWidth="0.75"
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
            <text
              key={a.label}
              x={a.lx}
              y={a.ly}
              textAnchor="middle"
              dominantBaseline="middle"
              className={styles.radarLabel}
            >
              {a.label}
            </text>
          ))}
        </svg>
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
//  Card variants — 8 unique viz types
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

function BellCard({ metric, percentile, value, unit, context }: VizProps): ReactNode {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const x = t * 180 + 10;
    const z = (t - 0.5) * 6;
    pts.push([x, 58 - Math.exp((-z * z) / 2) * 44]);
  }
  const curve = `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')}`;
  const mx = (percentile / 100) * 180 + 10;
  const mz = (percentile / 100 - 0.5) * 6;
  const my = 58 - Math.exp((-mz * mz) / 2) * 44;
  const fill = pts.filter(([x]) => x <= mx);
  fill.push([mx, my]);
  const fillPath = `M10 58 L${fill.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')} L${mx.toFixed(1)} 58Z`;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardMetric}>{metric}</span>
        <span className={styles.cardPercentile}>
          {Math.round(percentile)}
          <span className={styles.cardSuffix}>th</span>
        </span>
      </div>
      <div className={styles.cardViz}>
        <svg viewBox="0 0 200 62" className={styles.bellSvg} preserveAspectRatio="none">
          <path d={fillPath} fill="var(--ink)" opacity="0.05" />
          <path d={curve} fill="none" stroke="var(--ink)" strokeWidth="1.5" opacity="0.2" />
          <line
            x1={mx}
            y1={my}
            x2={mx}
            y2={58}
            stroke="var(--ink)"
            strokeWidth="1.5"
            opacity="0.5"
          />
          <circle cx={mx} cy={my} r="4" fill="var(--ink)" opacity="0.6" />
        </svg>
      </div>
      <div className={styles.cardValueRow}>
        <span className={styles.cardValue}>{value}</span>
        {unit && <span className={styles.cardUnit}>{unit}</span>}
      </div>
      {context && <span className={styles.cardContext}>{context}</span>}
    </div>
  );
}

function ThermometerCard({
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
      <div className={styles.thermoWrap}>
        <div className={styles.thermoLabels}>
          <span className={styles.thermoLabel}>{highLabel || 'Better'}</span>
          <span className={styles.thermoLabel}>{lowLabel || 'Worse'}</span>
        </div>
        <div className={styles.thermoTrack}>
          <div className={styles.thermoFill} style={{ height: `${percentile}%` }} />
          <div className={styles.thermoMarker} style={{ bottom: `${percentile}%` }}>
            <span className={styles.thermoMarkerDot} />
          </div>
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

function HistogramCard({
  metric,
  percentile,
  value,
  unit,
  distribution,
  userBracket,
  context,
}: VizProps & {
  distribution: Array<{ label: string; pct: number }>;
  userBracket?: string;
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
        {distribution.map((d) => (
          <div key={d.label} className={styles.histoCol}>
            <div className={styles.histoBarWrap}>
              <div
                className={`${styles.histoBar} ${d.label === userBracket ? styles.histoBarActive : ''}`}
                style={{ height: `${(d.pct / maxPct) * 100}%` }}
              />
            </div>
            <span
              className={`${styles.histoLabel} ${d.label === userBracket ? styles.histoLabelActive : ''}`}
            >
              {d.label}
            </span>
          </div>
        ))}
      </div>
      <div className={styles.cardValueRow}>
        <span className={styles.cardValue}>{value}</span>
        {unit && <span className={styles.cardUnit}>{unit}</span>}
      </div>
      {context && <span className={styles.cardContext}>{context}</span>}
    </div>
  );
}

function SpectrumCard({
  metric,
  percentile,
  value,
  unit,
  lowLabel,
  highLabel,
  context,
}: VizProps): ReactNode {
  let qual = 'Average';
  if (percentile >= 80) qual = 'Quite Exceptional';
  else if (percentile >= 60) qual = 'Above Average';
  else if (percentile <= 20) qual = 'Below Average';
  else if (percentile <= 40) qual = 'Slightly Below';

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardMetric}>{metric}</span>
      </div>
      <div className={styles.spectrumWrap}>
        <span className={styles.spectrumQual}>{qual}</span>
        <div className={styles.spectrumTrack}>
          <div className={styles.spectrumDot} style={{ left: `${percentile}%` }} />
        </div>
        <div className={styles.spectrumEnds}>
          <span className={styles.spectrumEndLabel}>{lowLabel}</span>
          <span className={styles.spectrumEndLabel}>{highLabel}</span>
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

function ArcCard({ metric, percentile, value, unit, context }: VizProps): ReactNode {
  const offset = ARC_LEN * (1 - percentile / 100);
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardMetric}>{metric}</span>
      </div>
      <div className={styles.arcCenter}>
        <svg viewBox="0 0 100 58" className={styles.arcSvg}>
          <path
            d="M5 52 A45 45 0 0 1 95 52"
            fill="none"
            stroke="var(--hairline)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M5 52 A45 45 0 0 1 95 52"
            fill="none"
            stroke="var(--ink)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={ARC_LEN}
            strokeDashoffset={offset}
            className={styles.arcFill}
            style={{ opacity: 0.4 }}
          />
        </svg>
        <div className={styles.arcLabel}>
          <span className={styles.arcNum}>{Math.round(percentile)}</span>
          <span className={styles.arcSuffixInner}>th</span>
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

function RingCard({ metric, percentile, value, unit, context }: VizProps): ReactNode {
  const circ = 2 * Math.PI * 34;
  const offset = circ * (1 - percentile / 100);
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardMetric}>{metric}</span>
      </div>
      <div className={styles.ringCenter}>
        <svg viewBox="0 0 80 80" className={styles.ringSvg}>
          <circle cx="40" cy="40" r="34" fill="none" stroke="var(--hairline)" strokeWidth="4" />
          <circle
            cx="40"
            cy="40"
            r="34"
            fill="none"
            stroke="var(--ink)"
            strokeWidth="4"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 40 40)"
            className={styles.ringFill}
            style={{ opacity: 0.4 }}
          />
        </svg>
        <div className={styles.ringLabel}>
          <span className={styles.ringNum}>{Math.round(percentile)}</span>
          <span className={styles.ringSuffixInner}>th</span>
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

function DotsCard({
  metric,
  percentile,
  value,
  unit,
  max = 8,
  context,
}: VizProps & { max?: number }): ReactNode {
  const count = parseInt(value, 10) || 0;
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardMetric}>{metric}</span>
        <span className={styles.cardPercentile}>
          {Math.round(percentile)}
          <span className={styles.cardSuffix}>th</span>
        </span>
      </div>
      <div className={styles.dotsRow}>
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={i < count ? styles.dotFilled : styles.dotEmpty} />
        ))}
      </div>
      <div className={styles.cardValueRow}>
        <span className={styles.cardValue}>{value}</span>
        {unit && <span className={styles.cardUnit}>{unit}</span>}
      </div>
      {context && <span className={styles.cardContext}>{context}</span>}
    </div>
  );
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

// ── Comparison card ──────────────────────────

function CompareCard({
  metric,
  yours,
  community,
  unit,
  better,
}: {
  metric: string;
  yours: number;
  community: number;
  unit: string;
  better: 'higher' | 'lower';
}): ReactNode {
  const diff = yours - community;
  const isGood = better === 'higher' ? diff > 0 : diff < 0;
  const pct = community > 0 ? Math.round((Math.abs(diff) / community) * 100) : 0;
  const deltaLabel =
    pct === 0
      ? 'At average'
      : `${pct}% ${isGood ? (better === 'higher' ? 'above' : 'below') : better === 'higher' ? 'below' : 'above'} avg`;
  const deltaClass =
    pct === 0
      ? styles.compareDeltaNeutral
      : isGood
        ? styles.compareDeltaGood
        : styles.compareDeltaBad;

  return (
    <div className={styles.compareCard}>
      <span className={styles.compareMetric}>{metric}</span>
      <div className={styles.compareValues}>
        <span className={styles.compareYours}>
          {formatNum(yours)}
          {unit}
        </span>
        <span className={styles.compareVs}>vs</span>
        <span className={styles.compareCommunity}>
          {formatNum(community)}
          {unit}
        </span>
      </div>
      <span className={`${styles.compareDelta} ${deltaClass}`}>{deltaLabel}</span>
      <span className={styles.compareInsight}>
        {insightText(pct, metric, yours, community, better)}
      </span>
    </div>
  );
}

// ── Leaderboard ──────────────────────────────

function LeaderboardSection({
  title,
  items,
}: {
  title: string;
  items: Array<{ name: string; value: string; bar: number; sub?: string }>;
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
          {items.map((item, i) => (
            <div
              key={item.name}
              className={styles.leaderboardRow}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className={styles.leaderboardRank}>{i + 1}</span>
              <span className={styles.leaderboardName}>{item.name}</span>
              <div className={styles.leaderboardBarTrack}>
                <div
                  className={styles.leaderboardBarFill}
                  style={{ width: `${(item.bar / maxBar) * 100}%` }}
                />
              </div>
              <span className={styles.leaderboardValue}>{item.value}</span>
              {item.sub && <span className={styles.leaderboardSub}>{item.sub}</span>}
            </div>
          ))}
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
  const countryCount = Object.keys(gs.countries).length;
  const m = gr.metrics;
  const t = gr.totals;
  const avg = gs.globalAverages;
  const hasEnoughSessions = t.totalSessions >= 10;

  const completionHisto = useMemo(() => {
    if (gs.completionDistribution.length === 0) return [];
    const totalUsers = gs.completionDistribution.reduce((s, d) => s + (d.users as number), 0);
    return gs.completionDistribution.map((d) => ({
      label: String(d.bracket),
      pct: totalUsers > 0 ? Math.round(((d.users as number) / totalUsers) * 100) : 0,
    }));
  }, [gs.completionDistribution]);

  const userCompletionRate = m.completion_rate?.value ?? 0;
  const userBracket = useMemo(() => {
    if (userCompletionRate >= 90) return '90-100';
    if (userCompletionRate >= 80) return '80-89';
    if (userCompletionRate >= 70) return '70-79';
    if (userCompletionRate >= 60) return '60-69';
    if (userCompletionRate >= 50) return '50-59';
    return '0-49';
  }, [userCompletionRate]);

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

      {/* ── Developer Effectiveness ── */}
      <section className={styles.section}>
        <SectionHead label="Developer Effectiveness" />
        <div className={styles.scoreSection}>
          <ScoreCard
            score={gr.score}
            tier={gr.tier}
            totalDevelopers={gr.totalDevelopers}
            sessions={t.totalSessions}
          />
          <RadarChart metrics={m} />
        </div>
      </section>

      {/* ── Your Totals ── */}
      <section className={styles.section}>
        <SectionHead label="Your Totals" />
        <div className={styles.personalStrip}>
          <div className={styles.personalStat}>
            <span className={styles.personalValue}>{formatNum(t.totalSessions)}</span>
            <span className={styles.personalLabel}>sessions</span>
          </div>
          <div className={styles.personalStat}>
            <span className={styles.personalValue}>{formatNum(t.totalEdits)}</span>
            <span className={styles.personalLabel}>edits</span>
          </div>
          <div className={styles.personalStat}>
            <span className={styles.personalValue}>{formatNum(t.totalLinesAdded)}</span>
            <span className={styles.personalLabel}>lines written</span>
          </div>
          <div className={styles.personalStat}>
            <span className={styles.personalValue}>{Math.round(t.totalDurationMin / 60)}</span>
            <span className={styles.personalLabel}>focus hours</span>
          </div>
          <div className={styles.personalStat}>
            <span className={styles.personalValue}>
              {formatNum(t.totalInputTokens + t.totalOutputTokens)}
            </span>
            <span className={styles.personalLabel}>tokens used</span>
          </div>
          <div className={styles.personalStat}>
            <span className={styles.personalValue}>{t.totalMemoriesSaved}</span>
            <span className={styles.personalLabel}>memories saved</span>
          </div>
        </div>
        <OutcomeBreakdown
          completed={t.completedSessions}
          abandoned={t.abandonedSessions}
          failed={t.failedSessions}
          total={t.totalSessions}
        />
      </section>

      {/* ── You vs Community ── */}
      <section className={styles.section}>
        <SectionHead label="You vs Community" />
        <div className={styles.compareGrid}>
          <CompareCard
            metric="Completion rate"
            yours={m.completion_rate?.value ?? 0}
            community={avg.completion_rate}
            unit="%"
            better="higher"
          />
          <CompareCard
            metric="Edit velocity"
            yours={m.edit_velocity?.value ?? 0}
            community={avg.edit_velocity}
            unit="/m"
            better="higher"
          />
          <CompareCard
            metric="Stuck rate"
            yours={m.stuck_rate?.value ?? 0}
            community={avg.stuck_rate}
            unit="%"
            better="lower"
          />
          <CompareCard
            metric="First edit"
            yours={m.first_edit_latency?.value ?? 0}
            community={avg.first_edit_s}
            unit="s"
            better="lower"
          />
        </div>
      </section>

      {/* ── Your Rank ── */}
      <section className={styles.section}>
        <SectionHead
          label={`Your Rank${gr.totalDevelopers > 0 ? ` among ${gr.totalDevelopers.toLocaleString()} developers` : ''}`}
        />
        {!hasEnoughSessions && (
          <p className={styles.cardContext} style={{ marginBottom: 16 }}>
            Complete {10 - t.totalSessions} more session{10 - t.totalSessions === 1 ? '' : 's'} to
            unlock percentile rankings.
          </p>
        )}
        <div
          className={styles.percentileGrid}
          style={!hasEnoughSessions ? { opacity: 0.35, pointerEvents: 'none' } : undefined}
        >
          <BellCard
            metric="Sessions completed"
            percentile={hasEnoughSessions ? (m.completion_rate?.percentile ?? 0) : 0}
            value={hasEnoughSessions ? `${m.completion_rate?.value ?? 0}%` : '--'}
            context={
              hasEnoughSessions &&
              m.completion_rate?.percentile != null &&
              m.completion_rate.percentile >= 50
                ? `Your completion rate is in the top ${100 - Math.round(m.completion_rate.percentile)}% of all developers.`
                : hasEnoughSessions
                  ? 'Complete more sessions to see how you compare.'
                  : undefined
            }
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
          <ThermometerCard
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
          <SpectrumCard
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
          <HistogramCard
            metric="Output per session"
            percentile={hasEnoughSessions ? (m.lines_per_session?.percentile ?? 0) : 0}
            value={hasEnoughSessions ? (m.lines_per_session?.value ?? 0).toLocaleString() : '--'}
            unit="lines"
            distribution={completionHisto}
            userBracket={userBracket}
            context="Distribution of completion rates across all developers."
          />
          <ArcCard
            metric="Code written"
            percentile={hasEnoughSessions ? (m.total_lines?.percentile ?? 0) : 0}
            value={hasEnoughSessions ? formatNum(m.total_lines?.value ?? 0) : '--'}
            unit="lines total"
            context={
              m.total_lines?.percentile != null && m.total_lines.percentile >= 50
                ? `You've written more code with AI than ${Math.round(m.total_lines.percentile)}% of developers.`
                : 'Your lifetime code output with AI agents.'
            }
          />
          <RingCard
            metric="Focus time"
            percentile={hasEnoughSessions ? (m.focus_hours?.percentile ?? 0) : 0}
            value={hasEnoughSessions ? String(m.focus_hours?.value ?? 0) : '--'}
            unit="hours"
            context={
              avg.focus_hours > 0
                ? `The average developer logs ${avg.focus_hours} hours of focused AI time.`
                : undefined
            }
          />
          <DotsCard
            metric="Tools used"
            percentile={hasEnoughSessions ? (m.tool_diversity?.percentile ?? 0) : 0}
            value={hasEnoughSessions ? String(m.tool_diversity?.value ?? 0) : '--'}
            max={8}
            context={
              (m.tool_diversity?.value ?? 0) >= 3
                ? 'Multi-tool developers tend to have higher completion rates.'
                : 'Try different AI tools to broaden your workflow.'
            }
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
        <SectionHead label="Popular Tool Combinations" />
        <div className={styles.combosGrid}>
          {gs.toolCombinations.length > 0
            ? gs.toolCombinations.slice(0, 6).map((c) => (
                <div key={`${c.toolA}-${c.toolB}`} className={styles.comboCard}>
                  <div className={styles.comboTools}>
                    <span className={styles.comboTool}>{getToolMeta(c.toolA).label}</span>
                    <span className={styles.comboPlus}>+</span>
                    <span className={styles.comboTool}>{getToolMeta(c.toolB).label}</span>
                  </div>
                  <span className={styles.comboUsers}>{c.users} developers</span>
                </div>
              ))
            : [0, 1, 2].map((i) => (
                <div key={i} className={`${styles.comboCard} ${styles.ghostCombo}`}>
                  <div className={styles.ghostComboTools}>
                    <div className={styles.ghostComboText} />
                    <span className={styles.comboPlus}>+</span>
                    <div className={styles.ghostComboText} />
                  </div>
                  <div className={styles.ghostComboSub} />
                </div>
              ))}
        </div>
      </section>

      {/* ── Trending ── */}
      <section className={styles.section}>
        <SectionHead label="Trending" />
        <div className={styles.trendingGrid}>
          <div className={styles.trendingList}>
            <span className={styles.trendingListTitle}>Tools</span>
            <div className={styles.trendingItems}>
              {gs.topTools.length > 0
                ? gs.topTools.map((t) => (
                    <div key={t.tool} className={styles.trendingItem}>
                      <span className={styles.trendingName}>{getToolMeta(t.tool).label}</span>
                      <span className={styles.trendingCount}>{t.users} developers</span>
                    </div>
                  ))
                : [60, 48, 32].map((w, i) => (
                    <div key={i} className={styles.ghostTrendingItem}>
                      <div className={styles.ghostText} style={{ width: w }} />
                      <div className={styles.ghostText} style={{ width: 40 }} />
                    </div>
                  ))}
            </div>
          </div>
          <div className={styles.trendingList}>
            <span className={styles.trendingListTitle}>Models</span>
            <div className={styles.trendingItems}>
              {gs.topModels.length > 0
                ? gs.topModels.map((m) => (
                    <div key={m.model} className={styles.trendingItem}>
                      <span className={styles.trendingName}>{m.model}</span>
                      <span className={styles.trendingCount}>{m.users} developers</span>
                    </div>
                  ))
                : [72, 56, 40].map((w, i) => (
                    <div key={i} className={styles.ghostTrendingItem}>
                      <div className={styles.ghostText} style={{ width: w }} />
                      <div className={styles.ghostText} style={{ width: 40 }} />
                    </div>
                  ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
