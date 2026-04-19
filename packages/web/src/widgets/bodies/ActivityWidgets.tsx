import { useMemo } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { DAY_LABELS, buildHeatmapData, workTypeColor } from '../utils.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import styles from '../../views/OverviewView/OverviewView.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { GhostBars, GhostStatRow } from './shared.js';

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
            <div key={hour} className={styles.heatmapCol}>
              {Array.from({ length: 7 }, (_, dow) => {
                const val = grid[dow][hour];
                const opacity = max > 0 ? 0.05 + (val / max) * 0.7 : 0.04;
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
  const total = workTypes.reduce((s, w) => s + w.sessions, 0);
  if (total === 0) {
    return <SectionEmpty>No sessions yet</SectionEmpty>;
  }
  return (
    <>
      <div className={styles.workBar}>
        {workTypes.map((w) => {
          const pct = (w.sessions / total) * 100;
          return pct < 1 ? null : (
            <div
              key={w.work_type}
              className={styles.workSegment}
              style={{
                width: `${pct}%`,
                background: workTypeColor(w.work_type),
              }}
              title={`${w.work_type}: ${Math.round(pct)}%`}
            />
          );
        })}
      </div>
      <div className={styles.workLegend}>
        {workTypes.map((w) => {
          const pct = Math.round((w.sessions / total) * 100);
          return pct < 1 ? null : (
            <div key={w.work_type} className={styles.workLegendItem}>
              <span className={styles.workDot} style={{ background: workTypeColor(w.work_type) }} />
              <span className={styles.workLegendLabel}>{w.work_type}</span>
              <span className={styles.workLegendValue}>
                {pct}% · {w.sessions}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function DurationDistWidget({ analytics }: WidgetBodyProps) {
  const dd = analytics.duration_distribution;
  if (dd.length === 0) return <GhostBars count={4} />;
  const maxD = Math.max(...dd.map((d) => d.count), 1);
  return (
    <div className={styles.metricBars}>
      {dd.map((d) => (
        <div key={d.bucket} className={styles.metricRow}>
          <span className={styles.metricLabel}>{d.bucket}</span>
          <div className={styles.metricBarTrack}>
            <div className={styles.metricBarFill} style={{ width: `${(d.count / maxD) * 100}%` }} />
          </div>
          <span className={styles.metricValue}>{d.count}</span>
        </div>
      ))}
    </div>
  );
}

function ScopeComplexityWidget({ analytics }: WidgetBodyProps) {
  const sc = analytics.scope_complexity;
  if (sc.length === 0) return <GhostBars count={4} />;
  return (
    <div className={styles.metricBars}>
      {sc.map((b) => (
        <div key={b.bucket} className={styles.metricRow}>
          <span className={styles.metricLabel}>{b.bucket}</span>
          <div className={styles.metricBarTrack}>
            <div
              className={styles.metricBarFill}
              style={{
                width: `${b.completion_rate}%`,
                background: 'var(--success)',
                opacity: 'var(--opacity-bar-fill)',
              }}
            />
          </div>
          <span className={styles.metricValue}>
            {b.completion_rate}% · {b.sessions}
          </span>
        </div>
      ))}
    </div>
  );
}

function FirstEditWidget({ analytics }: WidgetBodyProps) {
  const fe = analytics.first_edit_stats;
  if (!fe || fe.avg_minutes_to_first_edit === 0)
    return <GhostStatRow labels={['avg first edit', 'median']} />;
  return (
    <div className={styles.statRow}>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{fe.avg_minutes_to_first_edit.toFixed(1)}m</span>
        <span className={styles.statBlockLabel}>avg first edit</span>
      </div>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{fe.median_minutes_to_first_edit.toFixed(1)}m</span>
        <span className={styles.statBlockLabel}>median</span>
      </div>
      {fe.by_tool.length > 1 &&
        fe.by_tool.slice(0, 2).map((t) => (
          <div key={t.host_tool} className={styles.statBlock}>
            <span className={styles.statBlockValue}>{t.avg_minutes.toFixed(1)}m</span>
            <span className={styles.statBlockLabel}>{getToolMeta(t.host_tool).label}</span>
          </div>
        ))}
    </div>
  );
}

export const activityWidgets: WidgetRegistry = {
  heatmap: HeatmapWidget,
  'work-types': WorkTypesWidget,
  'duration-dist': DurationDistWidget,
  'scope-complexity': ScopeComplexityWidget,
  'first-edit': FirstEditWidget,
};
