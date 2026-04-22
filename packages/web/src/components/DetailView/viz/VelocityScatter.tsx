import { useMemo, type CSSProperties } from 'react';
import styles from './VelocityScatter.module.css';

export interface VelocityPoint {
  key: string;
  label: string;
  color: string;
  /** X-axis value (e.g. hours logged). */
  hours: number;
  /** Y-axis value (e.g. edits per hour). */
  rate: number;
  /** Total count for the tooltip (e.g. edit count). */
  edits: number;
}

interface Props {
  entries: ReadonlyArray<VelocityPoint>;
  /** Aria label for the SVG. */
  ariaLabel?: string;
  /** X-axis unit suffix for tick labels. Default "h" (hours). */
  xUnit?: string;
  /** Axis titles rendered in uppercase mono along the axes. */
  xTitle?: string;
  yTitle?: string;
}

const W = 520;
const H = 220;
const PAD_L = 46;
const PAD_R = 16;
const PAD_T = 10;
const PAD_B = 34;

/**
 * Scatter chart: each entity is a dot at (x, y). Reveals outliers (low
 * usage at a high rate, high usage at a low rate) that a one-axis bar
 * chart would flatten. Entities are colored by brand so the scatter
 * inherits the same palette as ring charts / tool lists elsewhere.
 */
export default function VelocityScatter({
  entries,
  ariaLabel,
  xUnit = 'h',
  xTitle = 'HOURS LOGGED',
  yTitle = 'EDITS / HR',
}: Props) {
  const { maxHours, maxRate } = useMemo(() => {
    const mh = Math.max(0.001, ...entries.map((e) => e.hours));
    const mr = Math.max(0.001, ...entries.map((e) => e.rate));
    return { maxHours: mh, maxRate: mr };
  }, [entries]);

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const points = entries.map((e) => ({
    ...e,
    cx: PAD_L + (e.hours / maxHours) * plotW,
    cy: PAD_T + plotH - (e.rate / maxRate) * plotH,
  }));

  const xTicks = [0.25, 0.5, 0.75, 1].map((f) => ({
    frac: f,
    x: PAD_L + f * plotW,
    label: (f * maxHours).toFixed(1),
  }));
  const yTicks = [0, 0.5, 1].map((f) => ({
    frac: f,
    y: PAD_T + plotH - f * plotH,
    label: (f * maxRate).toFixed(1),
  }));

  const fallbackAria = ariaLabel ?? `Velocity scatter with ${entries.length} entries`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={styles.svg}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={fallbackAria}
    >
      {yTicks.map((t) => (
        <line
          key={`yg-${t.frac}`}
          x1={PAD_L}
          x2={PAD_L + plotW}
          y1={t.y}
          y2={t.y}
          stroke="var(--hover-bg)"
          strokeWidth={1}
        />
      ))}
      {yTicks.map((t) => (
        <text
          key={`yl-${t.frac}`}
          x={PAD_L - 10}
          y={t.y + 3}
          textAnchor="end"
          className={styles.axisLabel}
        >
          {t.label}
        </text>
      ))}
      {xTicks.map((t) => (
        <text
          key={`xl-${t.frac}`}
          x={t.x}
          y={H - PAD_B + 14}
          textAnchor="middle"
          className={styles.axisLabel}
        >
          {t.label}
          {xUnit}
        </text>
      ))}
      <text
        x={-(PAD_T + plotH / 2)}
        y={12}
        textAnchor="middle"
        transform="rotate(-90)"
        className={styles.axisTitle}
      >
        {yTitle}
      </text>
      <text x={PAD_L + plotW / 2} y={H - 4} textAnchor="middle" className={styles.axisTitle}>
        {xTitle}
      </text>
      {points.map((p, i) => (
        <g key={p.key} className={styles.dotGroup} style={{ '--row-index': i } as CSSProperties}>
          <circle cx={p.cx} cy={p.cy} r={6} fill={p.color} opacity={0.85}>
            <title>{`${p.label} · ${p.hours.toFixed(1)}${xUnit} · ${p.rate.toFixed(1)} · ${p.edits}`}</title>
          </circle>
          <text x={p.cx + 11} y={p.cy + 4} className={styles.dotLabel} fill="var(--ink)">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
