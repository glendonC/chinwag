import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import clsx from 'clsx';
import { COLOR_PALETTE } from '../../../lib/utils.js';
import styles from './InteractiveDailyChurn.module.css';

export interface InteractiveDailyChurnPoint {
  day: string;
  added: number;
  removed: number;
}

export interface InteractiveDailyChurnEntry {
  key: string;
  label: string;
  series: ReadonlyArray<InteractiveDailyChurnPoint>;
  /** Optional explicit color. Falls through to a deterministic hash of
   *  `key` into the 12-color identity palette when omitted. */
  color?: string;
}

interface Props {
  entries: ReadonlyArray<InteractiveDailyChurnEntry>;
  /** Copy fragment inserted into the axis title — e.g. 'lines' renders
   *  "DAILY LINES" above the Y axis. Defaults to 'lines'. */
  unitLabel?: string;
  ariaLabel?: string;
}

const H = 320;
const PAD_L = 58;
const PAD_R = 28;
const PAD_T = 28;
const PAD_B = 46;

// djb2 hash — stable across sessions so a given handle keeps the same
// color without needing per-user color storage on the contract side.
function hashKey(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function defaultColor(key: string): string {
  const entry = COLOR_PALETTE[hashKey(key) % COLOR_PALETTE.length];
  return entry ? entry.hex : '#98989d';
}

function formatAxisDate(iso: string): string {
  if (iso.length >= 10) return iso.slice(5);
  return iso;
}

// Full human date for the tooltip header: "Apr 6, 2026". ISO → parse as UTC
// so local-timezone shifts don't push the label to the wrong day.
function formatTooltipDate(iso: string): string {
  if (iso.length < 10) return iso;
  const date = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return iso;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

// Round a max-Y value up to a "nice" step so the grid doesn't terminate
// at 457 or 1,283 — human-readable milestones instead.
function niceMax(raw: number): number {
  if (raw <= 0) return 1;
  const order = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / order;
  let step: number;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  return step * order;
}

/**
 * Stacked-area chart with toggleable entities, cursor scanner + ring dots,
 * and a floating tooltip card. Each active entity contributes a filled
 * band to the day's stack; the top edge of the stack is the team's total
 * churn for that day.
 *
 * Uses a ResizeObserver so the SVG viewBox matches the container's native
 * pixels — no aspect-ratio fight, crisp text, crisp strokes.
 *
 * Interactions:
 *   hover chart plot         → scanner line + ring dots on each stack top +
 *                              floating tooltip card (date, per-entity rows
 *                              sorted desc, daily total)
 *   hover legend chip        → emphasise that band in the chart
 *   click legend chip        → toggle visibility
 *   shift-click legend chip  → isolate (solo this entity)
 */
export default function InteractiveDailyChurn({ entries, unitLabel = 'lines', ariaLabel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<Set<string>>(() => new Set(entries.map((e) => e.key)));
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  // Re-seed the active set when the entries identity changes (e.g. outer
  // pivot toggles teammate→project). React's recommended "adjust state
  // during render" pattern: track the last-seen entries reference and
  // reset state when it changes. Avoids the cascading re-render that a
  // useEffect+setState would produce.
  const [prevEntries, setPrevEntries] = useState(entries);
  if (entries !== prevEntries) {
    setPrevEntries(entries);
    setActive(new Set(entries.map((e) => e.key)));
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((obs) => {
      for (const entry of obs) {
        const w = Math.round(entry.contentRect.width);
        if (w > 0) setWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const prepared = useMemo(() => {
    return entries.map((e) => ({
      ...e,
      color: e.color ?? defaultColor(e.key),
      total: e.series.reduce((s, p) => s + p.added + p.removed, 0),
      dailyChurn: e.series.map((p) => ({ day: p.day, churn: p.added + p.removed })),
    }));
  }, [entries]);

  const days = useMemo(() => prepared[0]?.series.map((p) => p.day) ?? [], [prepared]);
  const dayCount = days.length;

  // Stack order: heaviest contributor at the bottom, smaller bands on top.
  // Matches the reference's reading — the base carries the bulk, strips on
  // top show auxiliary contributions.
  const stackOrder = useMemo(
    () => [...prepared].sort((a, b) => b.total - a.total).map((e) => e.key),
    [prepared],
  );

  const activePrepared = useMemo(
    () =>
      stackOrder
        .map((key) => prepared.find((e) => e.key === key))
        .filter((e): e is NonNullable<typeof e> => !!e && active.has(e.key)),
    [stackOrder, prepared, active],
  );

  // Max Y = peak stack total across days, rounded up to a nice milestone.
  const { maxY, dailyTotals } = useMemo(() => {
    const totals: number[] = new Array(dayCount).fill(0);
    let peak = 0;
    for (let i = 0; i < dayCount; i++) {
      let sum = 0;
      for (const e of activePrepared) {
        sum += e.dailyChurn[i]?.churn ?? 0;
      }
      totals[i] = sum;
      if (sum > peak) peak = sum;
    }
    return { maxY: niceMax(Math.max(1, peak)), dailyTotals: totals };
  }, [activePrepared, dayCount]);

  const plotW = Math.max(200, width - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;
  const plotRight = PAD_L + plotW;
  const plotBottom = PAD_T + plotH;

  const xFor = useCallback(
    (i: number) => PAD_L + (dayCount > 1 ? (i / (dayCount - 1)) * plotW : plotW / 2),
    [dayCount, plotW],
  );
  const yFor = useCallback((v: number) => PAD_T + plotH - (v / maxY) * plotH, [maxY, plotH]);

  // Build stacked bands. Each band carries its own fill path (closed area
  // between its cumulative top and the prior stack top) and a stroke path
  // (top edge only) so we can layer strokes above fills for crisp outlines.
  const stackBands = useMemo(() => {
    const cumulative: number[] = new Array(dayCount).fill(0);
    const bands: Array<{
      key: string;
      label: string;
      color: string;
      total: number;
      top: number[];
      fillD: string;
      strokeD: string;
      dailyChurn: Array<{ day: string; churn: number }>;
    }> = [];

    for (const e of activePrepared) {
      const bottom = [...cumulative];
      const top: number[] = new Array(dayCount);
      for (let i = 0; i < dayCount; i++) {
        cumulative[i] += e.dailyChurn[i]?.churn ?? 0;
        top[i] = cumulative[i];
      }
      // Fill: top edge L→R, bottom edge R→L, closed.
      const fillParts: string[] = [];
      for (let i = 0; i < dayCount; i++) {
        fillParts.push(`${i === 0 ? 'M' : 'L'}${xFor(i)},${yFor(top[i])}`);
      }
      for (let i = dayCount - 1; i >= 0; i--) {
        fillParts.push(`L${xFor(i)},${yFor(bottom[i])}`);
      }
      fillParts.push('Z');

      const strokeParts: string[] = [];
      for (let i = 0; i < dayCount; i++) {
        strokeParts.push(`${i === 0 ? 'M' : 'L'}${xFor(i)},${yFor(top[i])}`);
      }

      bands.push({
        key: e.key,
        label: e.label,
        color: e.color,
        total: e.total,
        top,
        fillD: fillParts.join(' '),
        strokeD: strokeParts.join(' '),
        dailyChurn: e.dailyChurn,
      });
    }
    return bands;
  }, [activePrepared, dayCount, xFor, yFor]);

  const yTicks = useMemo(() => {
    return [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      frac: f,
      y: PAD_T + plotH - f * plotH,
      label: Math.round(f * maxY).toLocaleString(),
    }));
  }, [maxY, plotH]);

  const labelSpacing = Math.max(1, Math.floor(dayCount / 6));

  const toggle = useCallback(
    (key: string, isolate: boolean) => {
      setActive((prev) => {
        if (isolate) {
          if (prev.size === 1 && prev.has(key)) {
            return new Set(entries.map((e) => e.key));
          }
          return new Set([key]);
        }
        const next = new Set(prev);
        if (next.has(key)) {
          if (next.size > 1) next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    },
    [entries],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (dayCount === 0) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      if (localX < PAD_L || localX > plotRight) {
        setHoverIdx(null);
        return;
      }
      const frac = (localX - PAD_L) / plotW;
      const idx = Math.max(0, Math.min(dayCount - 1, Math.round(frac * (dayCount - 1))));
      setHoverIdx(idx);
    },
    [dayCount, plotRight, plotW],
  );

  const handlePointerLeave = useCallback(() => setHoverIdx(null), []);

  // Hover-day tooltip data. Rows sorted by churn desc so the dominant
  // contributor reads first — matches the reference's breakdown order.
  const tooltip = useMemo(() => {
    if (hoverIdx == null) return null;
    const rows = stackBands
      .map((b) => ({
        key: b.key,
        label: b.label,
        color: b.color,
        value: b.dailyChurn[hoverIdx]?.churn ?? 0,
      }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = dailyTotals[hoverIdx] ?? 0;
    const x = xFor(hoverIdx);
    const day = days[hoverIdx] ?? '';
    return { rows, total, x, day, idx: hoverIdx };
  }, [hoverIdx, stackBands, dailyTotals, xFor, days]);

  // Tooltip card flips to the left of the cursor past the midline of the
  // plot so it never clips against the container edge.
  const tooltipCardStyle = useMemo((): CSSProperties | null => {
    if (!tooltip) return null;
    const flip = tooltip.x > PAD_L + plotW * 0.55;
    const leftPx = flip ? tooltip.x - 16 : tooltip.x + 16;
    return {
      left: `${leftPx}px`,
      top: `${PAD_T + 10}px`,
      transform: flip ? 'translateX(-100%)' : undefined,
    };
  }, [tooltip, plotW]);

  const hoverEmphasis = hoverKey != null;
  const fallbackAria = ariaLabel ?? `Daily ${unitLabel} across ${entries.length} entities`;

  if (entries.length === 0) return null;

  const handleChipClick = (key: string) => (e: ReactMouseEvent<HTMLButtonElement>) =>
    toggle(key, e.shiftKey);

  return (
    <div ref={containerRef} className={styles.block}>
      <div className={styles.chartWrap}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${H}`}
          width={width}
          height={H}
          className={styles.svg}
          role="img"
          aria-label={fallbackAria}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          {/* Y grid */}
          {yTicks.map((t) => (
            <line
              key={`yg-${t.frac}`}
              x1={PAD_L}
              x2={plotRight}
              y1={t.y}
              y2={t.y}
              stroke="var(--hover-bg)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
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

          {/* X-axis day ticks */}
          {days.map((day, i) => {
            const visible = i === 0 || i === dayCount - 1 || i % labelSpacing === 0;
            if (!visible) return null;
            return (
              <text
                key={`xl-${day}`}
                x={xFor(i)}
                y={H - PAD_B + 18}
                textAnchor="middle"
                className={styles.axisLabel}
              >
                {formatAxisDate(day)}
              </text>
            );
          })}

          {/* Axis title */}
          <text x={PAD_L - 50} y={PAD_T - 10} textAnchor="start" className={styles.axisTitle}>
            daily {unitLabel}
          </text>

          {/* Stacked fill areas — semi-transparent, rendered in stack order
              (heaviest at the bottom). Emphasized band bumps opacity so it
              reads even behind the strokes. */}
          {stackBands.map((b, i) => {
            const emphasised = hoverKey === b.key;
            const faded = hoverEmphasis && !emphasised;
            const alpha = faded ? 0.08 : emphasised ? 0.42 : 0.22;
            return (
              <path
                key={`fill-${b.key}`}
                d={b.fillD}
                fill={b.color}
                fillOpacity={alpha}
                className={styles.band}
                style={{ '--row-index': i } as CSSProperties}
              />
            );
          })}

          {/* Top-edge strokes — layered above the fills so band identity is
              crisp at each cumulative boundary. */}
          {stackBands.map((b, i) => {
            const emphasised = hoverKey === b.key;
            const faded = hoverEmphasis && !emphasised;
            return (
              <path
                key={`stroke-${b.key}`}
                d={b.strokeD}
                fill="none"
                stroke={b.color}
                strokeWidth={emphasised ? 2.2 : 1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={faded ? 0.22 : 1}
                vectorEffect="non-scaling-stroke"
                className={clsx(styles.line, emphasised && styles.lineEmphasis)}
                style={{ '--row-index': i } as CSSProperties}
              >
                <title>{b.label}</title>
              </path>
            );
          })}

          {/* Scanner — vertical guide + ring dots at each active stack top */}
          {tooltip && (
            <g className={styles.scanner}>
              <line
                x1={tooltip.x}
                x2={tooltip.x}
                y1={PAD_T}
                y2={plotBottom}
                stroke="var(--ink)"
                strokeWidth={1}
                strokeDasharray="2 4"
                opacity={0.35}
                vectorEffect="non-scaling-stroke"
              />
              {stackBands.map((b) => {
                const value = b.dailyChurn[tooltip.idx]?.churn ?? 0;
                if (value <= 0) return null;
                const y = yFor(b.top[tooltip.idx] ?? 0);
                return (
                  <circle
                    key={`ring-${b.key}`}
                    cx={tooltip.x}
                    cy={y}
                    r={5.5}
                    fill="var(--surface, #fff)"
                    stroke={b.color}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    className={styles.ringDot}
                  />
                );
              })}
            </g>
          )}
        </svg>

        {/* Floating tooltip card — HTML overlay for crisp text + easy
            formatting. Flips to the left of the cursor past the midline
            of the plot so it never clips at the edge. */}
        {tooltip && tooltipCardStyle && tooltip.rows.length > 0 && (
          <div
            className={styles.tooltipCard}
            style={tooltipCardStyle}
            role="status"
            aria-live="polite"
          >
            <div className={styles.tooltipDate}>{formatTooltipDate(tooltip.day)}</div>
            <div className={styles.tooltipSubtitle}>daily breakdown</div>
            <ul className={styles.tooltipList}>
              {tooltip.rows.map((r) => {
                const share =
                  tooltip.total > 0 ? ((r.value / tooltip.total) * 100).toFixed(1) : '0.0';
                return (
                  <li key={r.key} className={styles.tooltipRow}>
                    <span className={styles.tooltipDot} style={{ background: r.color }} />
                    <span className={styles.tooltipLabel}>{r.label}</span>
                    <span className={styles.tooltipValue}>{r.value.toLocaleString()}</span>
                    <span className={styles.tooltipShare}>({share}%)</span>
                  </li>
                );
              })}
            </ul>
            <div className={styles.tooltipTotal}>
              <span className={styles.tooltipTotalLabel}>daily total</span>
              <span className={styles.tooltipTotalValue}>{tooltip.total.toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>

      <ul className={styles.legend} role="group" aria-label="Toggle entities">
        {prepared.map((e, i) => {
          const isActive = active.has(e.key);
          return (
            <li
              key={e.key}
              className={styles.legendItem}
              style={{ '--row-index': i } as CSSProperties}
              onMouseEnter={() => setHoverKey(e.key)}
              onMouseLeave={() => setHoverKey(null)}
              onFocus={() => setHoverKey(e.key)}
              onBlur={() => setHoverKey(null)}
            >
              <button
                type="button"
                className={clsx(styles.legendButton, !isActive && styles.legendButtonOff)}
                onClick={handleChipClick(e.key)}
                aria-pressed={isActive}
                aria-label={`${isActive ? 'Hide' : 'Show'} ${e.label}. Shift-click to isolate.`}
                style={{ '--entity-color': e.color } as CSSProperties}
              >
                {/* Rectangle swatch — reads as a legend bar tied to its
                 *  filled band, not a dot tied to a plotted point. */}
                <span
                  className={styles.legendSwatch}
                  style={{
                    background: isActive ? e.color : 'transparent',
                    borderColor: e.color,
                  }}
                />
                <span className={styles.legendLabel}>{e.label}</span>
                <span className={styles.legendTotal}>{e.total.toLocaleString()}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className={styles.hint}>click to toggle · shift-click to isolate · hover to emphasize</p>
    </div>
  );
}
