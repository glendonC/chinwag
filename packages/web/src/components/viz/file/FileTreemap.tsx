import { useEffect, useMemo, useRef, useState } from 'react';
import { workTypeColor } from '../../../widgets/utils.js';
import styles from './FileTreemap.module.css';

export interface FileTreemapEntry {
  file: string;
  touch_count: number;
  work_type?: string | null;
  total_lines_added?: number;
  total_lines_removed?: number;
}

interface Props {
  entries: ReadonlyArray<FileTreemapEntry>;
  /** Uncapped COUNT(DISTINCT file_path) for the period. If > entries.length,
   *  the caption shows "Top N of M". */
  totalFiles?: number;
  /** Height in px. Default 320. Width fills the container. */
  height?: number;
  /** When set, only files whose path starts with this prefix (at segment
   *  boundaries - "packages/web" won't match "packages/worker") are laid
   *  out. Used by the Row 4 directory selector to scope the treemap. */
  filterPrefix?: string | null;
}

interface LaidRect {
  key: string;
  file: string;
  value: number;
  color: string;
  workType: string;
  density: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function splitPath(file: string): { dir: string; name: string } {
  const idx = file.lastIndexOf('/');
  if (idx < 0) return { dir: '', name: file };
  return { dir: file.slice(0, idx + 1), name: file.slice(idx + 1) };
}

/** Squarified treemap layout (Bruls/Huizing/van Wijk). Lays out rectangles
 *  in a given bounding box so that each rectangle's area is proportional to
 *  its value and aspect ratios stay as close to 1:1 as feasible. */
function squarify(
  items: ReadonlyArray<{ key: string; value: number }>,
  x: number,
  y: number,
  w: number,
  h: number,
): Map<string, { x: number; y: number; w: number; h: number }> {
  const out = new Map<string, { x: number; y: number; w: number; h: number }>();
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0 || w <= 0 || h <= 0 || items.length === 0) return out;

  // Scale values to pixel-area so we can reason in a single unit.
  const scaled = items.map((i) => ({ key: i.key, area: (i.value / total) * w * h }));

  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;
  const remaining = [...scaled];

  function worst(row: { area: number }[], side: number): number {
    if (row.length === 0) return Infinity;
    const sum = row.reduce((s, r) => s + r.area, 0);
    const rMax = Math.max(...row.map((r) => r.area));
    const rMin = Math.min(...row.map((r) => r.area));
    const s2 = side * side;
    return Math.max((s2 * rMax) / (sum * sum), (sum * sum) / (s2 * rMin));
  }

  function layoutRow(row: { key: string; area: number }[], horizontal: boolean) {
    const sum = row.reduce((s, r) => s + r.area, 0);
    if (horizontal) {
      // row runs along the top of the remaining rectangle; height = sum / cw
      const rowH = sum / cw;
      let px = cx;
      for (const item of row) {
        const itemW = item.area / rowH;
        out.set(item.key, { x: px, y: cy, w: itemW, h: rowH });
        px += itemW;
      }
      cy += rowH;
      ch -= rowH;
    } else {
      const rowW = sum / ch;
      let py = cy;
      for (const item of row) {
        const itemH = item.area / rowW;
        out.set(item.key, { x: cx, y: py, w: rowW, h: itemH });
        py += itemH;
      }
      cx += rowW;
      cw -= rowW;
    }
  }

  while (remaining.length > 0 && cw > 0 && ch > 0) {
    const horizontal = cw >= ch;
    const side = horizontal ? cw : ch;
    const row: { key: string; area: number }[] = [];
    // Accumulate items greedily as long as worst aspect keeps improving.
    while (remaining.length > 0) {
      const next = remaining[0];
      const current = worst(row, side);
      const withNext = worst([...row, next], side);
      if (row.length > 0 && withNext > current) break;
      row.push(next);
      remaining.shift();
    }
    layoutRow(row, horizontal);
  }

  return out;
}

// Match a path against a directory prefix at segment boundaries so
// "packages/web" matches "packages/web/..." but not "packages/web-extra/...".
function matchesPrefix(path: string, prefix: string): boolean {
  if (!prefix) return true;
  if (path === prefix) return true;
  return path.startsWith(`${prefix}/`);
}

export default function FileTreemap({
  entries,
  totalFiles,
  height = 320,
  filterPrefix = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(Math.max(200, el.clientWidth));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((obs) => {
      for (const entry of obs) {
        const w = Math.round(entry.contentRect.width);
        if (w > 0) setWidth(Math.max(200, w));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rects = useMemo<LaidRect[]>(() => {
    const ranked = [...entries].filter(
      (e) => e.touch_count > 0 && (!filterPrefix || matchesPrefix(e.file, filterPrefix)),
    );
    ranked.sort((a, b) => b.touch_count - a.touch_count);
    if (ranked.length === 0) return [];

    const laid = squarify(
      ranked.map((e) => ({ key: e.file, value: e.touch_count })),
      0,
      0,
      width,
      height,
    );

    const out: LaidRect[] = [];
    for (const e of ranked) {
      const box = laid.get(e.file);
      if (!box || box.w < 1 || box.h < 1) continue;
      const churn = (e.total_lines_added ?? 0) + (e.total_lines_removed ?? 0);
      const density = e.touch_count > 0 ? churn / e.touch_count : 0;
      out.push({
        key: e.file,
        file: e.file,
        value: e.touch_count,
        workType: e.work_type || 'other',
        color: workTypeColor(e.work_type || 'other'),
        density,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
      });
    }
    return out;
  }, [entries, width, height, filterPrefix]);

  if (rects.length === 0) {
    if (filterPrefix) {
      return (
        <div className={styles.wrap}>
          <div className={styles.caption}>No files in {filterPrefix} this period</div>
        </div>
      );
    }
    return null;
  }

  const captureCount = rects.length;
  const shownOfTotal = totalFiles && totalFiles > captureCount ? totalFiles : null;
  const caption = filterPrefix
    ? `${captureCount} ${captureCount === 1 ? 'file' : 'files'} in ${filterPrefix}`
    : shownOfTotal !== null
      ? `Top ${captureCount} of ${shownOfTotal.toLocaleString()} files touched`
      : null;

  return (
    <div className={styles.wrap}>
      {caption !== null && <div className={styles.caption}>{caption}</div>}
      <div ref={containerRef} className={styles.plot} style={{ height }}>
        <svg
          className={styles.svg}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="File landscape treemap"
        >
          {rects.map((r) => {
            const { dir, name } = splitPath(r.file);
            const showLabel = r.w > 70 && r.h > 26;
            const showDir = showLabel && r.h > 44 && dir.length > 0;
            const active = hoverKey === r.key;
            return (
              <g
                key={r.key}
                className={styles.cell}
                transform={`translate(${r.x},${r.y})`}
                onPointerEnter={() => setHoverKey(r.key)}
                onPointerLeave={() => setHoverKey(null)}
              >
                <rect
                  width={r.w}
                  height={r.h}
                  rx={3}
                  ry={3}
                  fill={r.color}
                  fillOpacity={active ? 0.95 : 0.82}
                  stroke="var(--surface-glass, #fff)"
                  strokeWidth={1.5}
                />
                {showLabel && (
                  <text
                    x={8}
                    y={showDir ? 20 : 18}
                    className={styles.label}
                    clipPath={`inset(0 0 0 0)`}
                  >
                    {name.length * 7 < r.w - 16
                      ? name
                      : `${name.slice(0, Math.max(0, Math.floor((r.w - 16) / 7)))}…`}
                  </text>
                )}
                {showDir && (
                  <text x={8} y={36} className={styles.sublabel}>
                    {dir.length * 6 < r.w - 16
                      ? dir
                      : `${dir.slice(0, Math.max(0, Math.floor((r.w - 16) / 6)))}…`}
                  </text>
                )}
                {showLabel && r.h > 58 && (
                  <text x={8} y={r.h - 10} className={styles.meta}>
                    {r.value.toLocaleString()}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hoverKey &&
          (() => {
            const r = rects.find((x) => x.key === hoverKey);
            if (!r) return null;
            return (
              <div
                className={styles.tooltip}
                style={{
                  left: Math.min(Math.max(r.x, 8), width - 220),
                  top: Math.min(r.y + 8, height - 80),
                }}
              >
                <div className={styles.tooltipPath}>{r.file}</div>
                <div className={styles.tooltipMeta}>
                  <span>{r.value.toLocaleString()} touches</span>
                  <span className={styles.sep}>·</span>
                  <span>{r.workType}</span>
                  {r.density > 0 && (
                    <>
                      <span className={styles.sep}>·</span>
                      <span>{r.density.toFixed(0)} lines/touch</span>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
      </div>
    </div>
  );
}
