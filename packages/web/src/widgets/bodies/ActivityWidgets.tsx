import { useMemo, type CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { DAY_LABELS, buildHeatmapData, workTypeColor } from '../utils.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import shared from '../widget-shared.module.css';
import styles from './ActivityWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';

const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21];

// Below this many populated hour×day cells the grid looks broken rather
// than sparse — one or two lit squares against a 168-cell grid reads as
// a load bug. Show a named empty state instead, so the user understands
// the widget will fill in with more sessions.
const HEATMAP_MIN_POPULATED_CELLS = 3;

function HeatmapWidget({ analytics }: WidgetBodyProps) {
  return <Heatmap hourly={analytics.hourly_distribution} />;
}

function Heatmap({ hourly }: { hourly: UserAnalytics['hourly_distribution'] }) {
  const { grid, max, populatedCells } = useMemo(() => {
    const built = buildHeatmapData(hourly);
    let cells = 0;
    for (const row of built.grid) for (const v of row) if (v > 0) cells++;
    return { ...built, populatedCells: cells };
  }, [hourly]);

  if (populatedCells < HEATMAP_MIN_POPULATED_CELLS) {
    return <SectionEmpty>Heatmap fills in as you run more sessions</SectionEmpty>;
  }

  return (
    <div className={styles.heatmapWrap}>
      <div className={styles.heatmapGrid}>
        <div className={styles.heatmapYLabels}>
          {DAY_LABELS.map((d) => (
            <span key={d} className={styles.heatmapYLabel}>
              {d}
            </span>
          ))}
        </div>
        <div className={styles.heatmapCols}>
          {Array.from({ length: 24 }, (_, hour) => (
            <div
              key={hour}
              className={styles.heatmapCol}
              style={{ '--row-index': hour } as CSSProperties}
            >
              {Array.from({ length: 7 }, (_, dow) => {
                const val = grid[dow][hour];
                // Clamp val/max to 1 so cells above p95 (see
                // buildHeatmapData) saturate at full ink rather than
                // exceeding the intended opacity range.
                const norm = max > 0 ? Math.min(1, val / max) : 0;
                const opacity = max > 0 ? 0.05 + norm * 0.7 : 0.04;
                return (
                  <div
                    key={dow}
                    className={styles.heatmapCell}
                    style={{ background: 'var(--ink)', opacity }}
                    title={`${DAY_LABELS[dow]} ${hour}:00 — ${val} sessions`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.heatmapXLabels}>
        {HOUR_LABELS.map((h) => (
          <span key={h} className={styles.heatmapXLabel}>
            {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
          </span>
        ))}
      </div>
    </div>
  );
}

function WorkTypesWidget({ analytics }: WidgetBodyProps) {
  const workTypes = analytics.work_type_distribution;
  // Denominator is edits, not sessions. A session that touches frontend +
  // tests appears in BOTH per-work-type session counts (one row each), so
  // sum(w.sessions) double-counts cross-type sessions and the percentages
  // can exceed 100. Edits are disjoint at the edit level (each edit has
  // exactly one work_type via SQL CASE), so sum(w.edits) is the honest
  // denominator that sums to total period edits.
  const totalEdits = workTypes.reduce((s, w) => s + w.edits, 0);
  if (totalEdits === 0) {
    return <SectionEmpty>No sessions yet</SectionEmpty>;
  }
  return (
    <>
      <div className={shared.workBar}>
        {workTypes.map((w) => {
          const pct = (w.edits / totalEdits) * 100;
          return pct < 1 ? null : (
            <div
              key={w.work_type}
              className={shared.workSegment}
              style={{
                width: `${pct}%`,
                background: workTypeColor(w.work_type),
              }}
              title={`${w.work_type}: ${Math.round(pct)}% of edits`}
            />
          );
        })}
      </div>
      <div className={shared.workLegend}>
        {workTypes
          .map((w) => ({ w, pct: Math.round((w.edits / totalEdits) * 100) }))
          .filter(({ pct }) => pct >= 1)
          .map(({ w, pct }, i) => (
            <div
              key={w.work_type}
              className={shared.workLegendItem}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={shared.workDot} style={{ background: workTypeColor(w.work_type) }} />
              <span className={shared.workLegendLabel}>{w.work_type}</span>
              <span className={shared.workLegendValue}>
                {pct}% · {w.sessions} {w.sessions === 1 ? 'session' : 'sessions'}
              </span>
            </div>
          ))}
      </div>
    </>
  );
}

// Note: duration-dist, scope-complexity, and first-edit live in
// OutcomeWidgets.tsx — they are categorized as 'outcomes' in the catalog
// and share the category's visualization vocabulary (ring / histogram /
// curve). This registry only owns heatmap and work-types.

export const activityWidgets: WidgetRegistry = {
  heatmap: HeatmapWidget,
  'work-types': WorkTypesWidget,
};
