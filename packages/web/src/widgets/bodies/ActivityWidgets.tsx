import { useMemo, type CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import HourHeatmap, { type HourCell } from '../../components/viz/time/HourHeatmap.js';
import { qualifyByVolume } from '../../lib/qualifyByVolume.js';
import { completionColor, workTypeColor } from '../utils.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import shared from '../widget-shared.module.css';
import styles from './ActivityWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';

// Below this many populated hour×day cells the grid looks broken rather
// than sparse — one or two lit squares against a 168-cell grid reads as
// a load bug. Show a named empty state instead, so the user understands
// the widget will fill in with more sessions.
const HEATMAP_MIN_POPULATED_CELLS = 3;

function HeatmapWidget({ analytics }: WidgetBodyProps) {
  return <Heatmap hourly={analytics.hourly_distribution} />;
}

function Heatmap({ hourly }: { hourly: UserAnalytics['hourly_distribution'] }) {
  const { cells, populatedCells } = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const h of hourly) grid[h.dow][h.hour] = (grid[h.dow][h.hour] || 0) + h.sessions;
    const out: HourCell[] = [];
    let populated = 0;
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        const v = grid[dow][hour];
        if (v > 0) {
          out.push({ dow, hour, value: v });
          populated++;
        }
      }
    }
    return { cells: out, populatedCells: populated };
  }, [hourly]);

  if (populatedCells < HEATMAP_MIN_POPULATED_CELLS) {
    return <SectionEmpty>Heatmap fills in as you run more sessions</SectionEmpty>;
  }

  return <HourHeatmap data={cells} />;
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

// Below this many qualifying hours the bar chart is too thin to read
// usefully. Off-hour bursts wash a 2-hour view, and the slice-by-volume
// rule (qualifyByVolume p25) usually keeps 6+ hours when sessions are
// real — so under 4 indicates "not enough data yet" rather than "show
// a degenerate viz."
const EFFECTIVE_HOURS_MIN_QUALIFIED = 4;

function hourGlyph(h: number): string {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

function HourlyEffectivenessWidget({ analytics }: WidgetBodyProps) {
  const qualified = useMemo(
    () => qualifyByVolume(analytics.hourly_effectiveness, (h) => h.sessions, 25),
    [analytics.hourly_effectiveness],
  );

  if (qualified.length < EFFECTIVE_HOURS_MIN_QUALIFIED) {
    return <SectionEmpty>Needs at least 4 high-volume hours — keep working.</SectionEmpty>;
  }

  // Bars ordered by clock so the user can scan their day; height encodes
  // session volume, color encodes completion rate. Mirror of the
  // peak-completion question in ActivityDetailView.
  const byClock = [...qualified].sort((a, b) => a.hour - b.hour);
  const maxSessions = Math.max(1, ...byClock.map((h) => h.sessions));

  return (
    <div className={styles.effFrame}>
      <div className={styles.effBars}>
        {byClock.map((h) => {
          const heightPct = Math.max(8, Math.round((h.sessions / maxSessions) * 100));
          const color = completionColor(h.completion_rate);
          return (
            <div key={h.hour} className={styles.effColumn}>
              <span className={styles.effRate}>{Math.round(h.completion_rate)}%</span>
              <span
                className={styles.effBar}
                style={
                  {
                    '--bar-height': `${heightPct}%`,
                    background: color,
                  } as CSSProperties
                }
                title={`${hourGlyph(h.hour)}: ${h.sessions} sessions, ${Math.round(h.completion_rate)}% completed`}
              />
              <span className={styles.effHourLabel}>{hourGlyph(h.hour)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Note: duration-dist, scope-complexity, and first-edit live in
// OutcomeWidgets.tsx — they are categorized as 'outcomes' in the catalog
// and share the category's visualization vocabulary (ring / histogram /
// curve). This registry only owns heatmap, work-types, and
// hourly-effectiveness.

export const activityWidgets: WidgetRegistry = {
  heatmap: HeatmapWidget,
  'work-types': WorkTypesWidget,
  'hourly-effectiveness': HourlyEffectivenessWidget,
};
