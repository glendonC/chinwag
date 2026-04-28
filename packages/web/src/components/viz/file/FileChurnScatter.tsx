import { useMemo, type CSSProperties } from 'react';
import { workTypeColor } from '../../../widgets/utils.js';
import styles from './FileChurnScatter.module.css';

export interface FileChurnScatterEntry {
  file: string;
  lines_added: number;
  lines_removed: number;
  work_type?: string;
  touch_count?: number;
}

interface Props {
  entries: ReadonlyArray<FileChurnScatterEntry>;
  ariaLabel?: string;
}

const W = 560;
const H = 320;
const PAD_L = 60;
const PAD_R = 20;
const PAD_T = 18;
const PAD_B = 40;

const DOT_RADIUS = 5;
const INLINE_LABEL_COUNT = 3;

function fileBasename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * File churn scatter: each file is a dot at (lines added, lines removed).
 * The diagonal y=x splits the plot into character zones.
 *
 *   Below the diagonal (added > removed) → net additions, new code.
 *   Above the diagonal (removed > added) → net deletions, cleanup.
 *   Along the diagonal                    → balanced churn, rewrites.
 *   Far from origin                       → high-volume files worth noting.
 *
 * Dots colored by work-type (same palette as the Files tab's constellation
 * so cross-tab reading is consistent). Fixed radius - the axes are the
 * information; size encoding would be bubble-chart drift.
 */
export default function FileChurnScatter({ entries, ariaLabel }: Props) {
  const dataset = useMemo(() => {
    if (entries.length === 0) return null;

    const maxAdded = Math.max(1, ...entries.map((e) => e.lines_added));
    const maxRemoved = Math.max(1, ...entries.map((e) => e.lines_removed));

    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const points = entries.map((e) => ({
      file: e.file,
      basename: fileBasename(e.file),
      work_type: e.work_type ?? 'other',
      lines_added: e.lines_added,
      lines_removed: e.lines_removed,
      touch_count: e.touch_count,
      color: workTypeColor(e.work_type),
      cx: PAD_L + (e.lines_added / maxAdded) * plotW,
      cy: PAD_T + plotH - (e.lines_removed / maxRemoved) * plotH,
    }));

    // Rank inline labels by total churn so the most impactful files get
    // named. Everything else surfaces via the native title tooltip.
    const ranked = [...points]
      .sort((a, b) => b.lines_added + b.lines_removed - (a.lines_added + a.lines_removed))
      .slice(0, INLINE_LABEL_COUNT);
    const labelSet = new Set(ranked.map((p) => p.file));

    return { points, labelSet, maxAdded, maxRemoved, plotW, plotH };
  }, [entries]);

  if (!dataset) return null;

  const { points, labelSet, maxAdded, maxRemoved, plotW, plotH } = dataset;

  const xTicks = [0.25, 0.5, 0.75, 1].map((f) => ({
    frac: f,
    x: PAD_L + f * plotW,
    label: String(Math.round(f * maxAdded)),
  }));
  const yTicks = [0.25, 0.5, 0.75, 1].map((f) => ({
    frac: f,
    y: PAD_T + plotH - f * plotH,
    label: String(Math.round(f * maxRemoved)),
  }));

  // Diagonal reference - from (0, 0) at bottom-left to the corner that
  // represents equal magnitudes on both axes. Using min(maxAdded, maxRemoved)
  // so the line doesn't overshoot the plot on a lopsided window.
  const diagMagnitude = Math.min(maxAdded, maxRemoved);
  const diagX = PAD_L + (diagMagnitude / maxAdded) * plotW;
  const diagY = PAD_T + plotH - (diagMagnitude / maxRemoved) * plotH;

  const fallbackAria = ariaLabel ?? `File churn scatter with ${entries.length} files`;

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

      {/* Diagonal reference - dashed, faint. Files sitting on this line had
          equal additions and removals for the period. */}
      <line
        x1={PAD_L}
        y1={PAD_T + plotH}
        x2={diagX}
        y2={diagY}
        stroke="var(--soft)"
        strokeWidth={1}
        strokeDasharray="3 4"
        opacity={0.45}
      />

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
        y={14}
        textAnchor="middle"
        transform="rotate(-90)"
        className={styles.axisTitle}
      >
        LINES REMOVED
      </text>
      <text x={PAD_L + plotW / 2} y={H - 6} textAnchor="middle" className={styles.axisTitle}>
        LINES ADDED
      </text>

      {points.map((p, i) => (
        <g key={p.file} className={styles.dotGroup} style={{ '--row-index': i } as CSSProperties}>
          <circle cx={p.cx} cy={p.cy} r={DOT_RADIUS} fill={p.color} opacity={0.85}>
            <title>
              {`${p.file} · +${p.lines_added} / −${p.lines_removed}${p.touch_count != null ? ` · ${p.touch_count} touches` : ''}`}
            </title>
          </circle>
          {labelSet.has(p.file) && (
            <text x={p.cx + DOT_RADIUS + 6} y={p.cy + 3} className={styles.dotLabel}>
              {p.basename}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
