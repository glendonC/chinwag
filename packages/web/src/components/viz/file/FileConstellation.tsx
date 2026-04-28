import { useMemo, type CSSProperties } from 'react';
import { workTypeColor } from '../../../widgets/utils.js';
import styles from './FileConstellation.module.css';

export interface FileConstellationEntry {
  file: string;
  touch_count: number;
  work_type?: string;
  outcome_rate?: number;
  total_lines_added?: number;
  total_lines_removed?: number;
}

interface Props {
  entries: ReadonlyArray<FileConstellationEntry>;
  /** When set, dots whose work_type doesn't match dim to ghost. Lets the
   * hero work-type strip act as a filter without re-rendering the dataset. */
  activeWorkType?: string | null;
  ariaLabel?: string;
}

const W = 560;
const H = 320;
const PAD_L = 50;
const PAD_R = 20;
const PAD_T = 18;
const PAD_B = 40;

// Fixed dot radius matches VelocityScatter's convention and keeps the viz on
// the right side of the "no bubble charts / no filled circle orbs" rule - a
// scatter is a scatter only when dots are positional marks, not size-encoded
// orbs. Lines-churned sits in the tooltip rather than in dot area.
const DOT_RADIUS = 5;

// Top-N inline labels. More than 3–4 labels starts to overlap - for the rest
// the native <title> tooltip covers hover disclosure. Chosen to keep the plot
// chromeless at Swiss-density; power users drill by hovering.
const INLINE_LABEL_COUNT = 3;

function fileBasename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * File constellation: each file is a dot at (touches, completion%). Replaces
 * the old "Most-touched files" + "Highest rework ratio" list pair - one 2D
 * viz fuses the two questions (activity × effectiveness) that previously
 * required two ranked lists to read.
 *
 * Upper-right = high-touch solid files. Upper-left = low-touch one-shot
 * wins. Lower-right = high-touch failing files (the "problem" quadrant,
 * subsumes the rework section). Lower-left = abandoned fragments.
 */
export default function FileConstellation({ entries, activeWorkType, ariaLabel }: Props) {
  const dataset = useMemo(() => {
    if (entries.length === 0) return null;

    const maxTouches = Math.max(1, ...entries.map((e) => e.touch_count));

    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const points = entries.map((e) => {
      const lines = (e.total_lines_added ?? 0) + (e.total_lines_removed ?? 0);
      const outcome = e.outcome_rate ?? 0;
      return {
        file: e.file,
        basename: fileBasename(e.file),
        work_type: e.work_type ?? 'other',
        touch_count: e.touch_count,
        outcome_rate: outcome,
        lines,
        color: workTypeColor(e.work_type),
        cx: PAD_L + (e.touch_count / maxTouches) * plotW,
        // outcome_rate is stored as 0–100 from the backend; no further scaling.
        cy: PAD_T + plotH - (outcome / 100) * plotH,
      };
    });

    // Rank for inline labels - highest touch_count gets the label since
    // that's the primary axis readers scan.
    const ranked = [...points]
      .sort((a, b) => b.touch_count - a.touch_count)
      .slice(0, INLINE_LABEL_COUNT);
    const labelSet = new Set(ranked.map((p) => p.file));

    return { points, labelSet, maxTouches, plotW, plotH };
  }, [entries]);

  if (!dataset) return null;

  const { points, labelSet, maxTouches, plotW, plotH } = dataset;

  // Y ticks at 0/25/50/75/100 % completion - standard grid every quartile.
  // X ticks at 4 equal fractions of maxTouches with integer labels so the
  // scale is readable without interpolation.
  const yTicks = [0, 25, 50, 75, 100].map((pct) => ({
    pct,
    y: PAD_T + plotH - (pct / 100) * plotH,
  }));
  const xTicks = [0.25, 0.5, 0.75, 1].map((f) => ({
    frac: f,
    x: PAD_L + f * plotW,
    label: String(Math.round(f * maxTouches)),
  }));

  const fallbackAria = ariaLabel ?? `File constellation with ${entries.length} files`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={styles.svg}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={fallbackAria}
    >
      {/* Grid - faint horizontal guides at each quartile. No vertical grid:
          the X axis is activity count (long-tail), not percentages, so
          gridding every quartile would be arbitrary noise. */}
      {yTicks.map((t) => (
        <line
          key={`yg-${t.pct}`}
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
          key={`yl-${t.pct}`}
          x={PAD_L - 10}
          y={t.y + 3}
          textAnchor="end"
          className={styles.axisLabel}
        >
          {t.pct}%
        </text>
      ))}
      {xTicks.map((t) => (
        <text
          key={`xl-${t.frac}`}
          x={t.x}
          y={H - PAD_B + 16}
          textAnchor="middle"
          className={styles.axisLabel}
        >
          {t.label}
        </text>
      ))}
      <text
        x={-(PAD_T + plotH / 2)}
        y={12}
        textAnchor="middle"
        transform="rotate(-90)"
        className={styles.axisTitle}
      >
        COMPLETION %
      </text>
      <text x={PAD_L + plotW / 2} y={H - 6} textAnchor="middle" className={styles.axisTitle}>
        TOUCHES
      </text>

      {points.map((p, i) => {
        const dimmed = activeWorkType != null && p.work_type !== activeWorkType;
        const opacity = dimmed ? 0.12 : 0.85;
        const labelClass = dimmed ? styles.dotLabelDim : styles.dotLabel;
        return (
          <g key={p.file} className={styles.dotGroup} style={{ '--row-index': i } as CSSProperties}>
            <circle cx={p.cx} cy={p.cy} r={DOT_RADIUS} fill={p.color} opacity={opacity}>
              <title>
                {`${p.file} · ${p.touch_count} touches · ${Math.round(p.outcome_rate)}% complete · ${p.lines} lines`}
              </title>
            </circle>
            {labelSet.has(p.file) && (
              <text x={p.cx + DOT_RADIUS + 6} y={p.cy + 3} className={labelClass}>
                {p.basename}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
