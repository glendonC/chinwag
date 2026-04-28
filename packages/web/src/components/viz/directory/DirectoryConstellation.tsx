import { useMemo, type CSSProperties } from 'react';
import styles from './DirectoryConstellation.module.css';

export interface DirectoryConstellationEntry {
  directory: string;
  touch_count: number;
  file_count: number;
  total_lines: number;
  completion_rate: number;
}

interface Props {
  entries: ReadonlyArray<DirectoryConstellationEntry>;
  ariaLabel?: string;
}

const W = 560;
const H = 280;
const PAD_L = 54;
const PAD_R = 24;
const PAD_T = 18;
const PAD_B = 42;

// Fixed dot radius - avoids the bubble-chart pattern (variable-size orbs
// encoding a third dimension). Tint carries completion; size stays uniform.
const DOT_RADIUS = 6;

/**
 * Directory constellation: each directory is a dot at (file count, avg
 * touches per file). Replaces the horizontal bar list that flattened the
 * breadth/depth question onto a single axis.
 *
 * Upper-right = wide + deep (hot zones). Upper-left = focused rework on
 * few files. Lower-right = wide-and-shallow. Lower-left = edges. Dot tint
 * encodes completion rate - an ink-alpha spread from muted (low completion)
 * to full ink (high completion).
 */
export default function DirectoryConstellation({ entries, ariaLabel }: Props) {
  const dataset = useMemo(() => {
    if (entries.length === 0) return null;

    // Derive avg touches per file - the "depth" axis. file_count > 0 is
    // guaranteed by the query (the directory wouldn't exist otherwise) but
    // Math.max cap keeps the division safe regardless.
    const enriched = entries.map((e) => ({
      directory: e.directory,
      file_count: e.file_count,
      touch_count: e.touch_count,
      total_lines: e.total_lines,
      completion_rate: e.completion_rate,
      avg_touches: e.touch_count / Math.max(1, e.file_count),
    }));

    const maxFiles = Math.max(1, ...enriched.map((e) => e.file_count));
    const maxDepth = Math.max(0.5, ...enriched.map((e) => e.avg_touches));

    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const points = enriched.map((e) => {
      // Ink-alpha tint keyed to completion rate. 0% → 22% ink (ghost-ish,
      // reads as neutral rather than wrong). 100% → full ink. Same spread
      // vocabulary as DurationStrip's bucket tints.
      const alpha = Math.round(22 + (e.completion_rate / 100) * 78);
      return {
        ...e,
        cx: PAD_L + (e.file_count / maxFiles) * plotW,
        cy: PAD_T + plotH - (e.avg_touches / maxDepth) * plotH,
        fill: `color-mix(in srgb, var(--ink) ${alpha}%, transparent)`,
      };
    });

    return { points, maxFiles, maxDepth, plotW, plotH };
  }, [entries]);

  if (!dataset) return null;

  const { points, maxFiles, maxDepth, plotW, plotH } = dataset;

  const yTicks = [0.25, 0.5, 0.75, 1].map((f) => ({
    frac: f,
    y: PAD_T + plotH - f * plotH,
    label: (f * maxDepth).toFixed(1),
  }));
  const xTicks = [0.25, 0.5, 0.75, 1].map((f) => ({
    frac: f,
    x: PAD_L + f * plotW,
    label: String(Math.round(f * maxFiles)),
  }));

  const fallbackAria = ariaLabel ?? `Directory constellation with ${entries.length} directories`;

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
        AVG TOUCHES / FILE
      </text>
      <text x={PAD_L + plotW / 2} y={H - 6} textAnchor="middle" className={styles.axisTitle}>
        FILE COUNT
      </text>

      {points.map((p, i) => (
        <g
          key={p.directory}
          className={styles.dotGroup}
          style={{ '--row-index': i } as CSSProperties}
        >
          <circle cx={p.cx} cy={p.cy} r={DOT_RADIUS} fill={p.fill}>
            <title>
              {`${p.directory} · ${p.file_count} files · ${p.touch_count} touches · ${p.avg_touches.toFixed(1)} per file · ${p.completion_rate}% complete`}
            </title>
          </circle>
          <text x={p.cx + DOT_RADIUS + 6} y={p.cy + 3} className={styles.dotLabel}>
            {p.directory}
          </text>
        </g>
      ))}
    </svg>
  );
}
