import { useMemo, type CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import HourHeatmap, { type HourCell } from '../../components/viz/time/HourHeatmap.js';
import { qualifyByVolume } from '../../lib/qualifyByVolume.js';
import { completionColor, workTypeColor } from '../utils.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import styles from './ActivityWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';

// Below this many populated hour×day cells the grid looks broken rather
// than sparse — one or two lit squares against a 168-cell grid reads as
// a load bug. Show a named empty state instead, so the user understands
// the widget will fill in with more sessions.
const HEATMAP_MIN_POPULATED_CELLS = 3;

function formatWorkTypeLabel(raw: string): string {
  return raw.replace(/_/g, ' ').toLowerCase();
}

function HeatmapWidget({ analytics }: WidgetBodyProps) {
  return <Heatmap hourly={analytics.hourly_distribution} />;
}

function Heatmap({ hourly }: { hourly: UserAnalytics['hourly_distribution'] }) {
  const { cells, populatedCells, peak } = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const h of hourly) grid[h.dow][h.hour] = (grid[h.dow][h.hour] || 0) + h.sessions;
    const out: HourCell[] = [];
    let populated = 0;
    let peakCell: HourCell | null = null;
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        const v = grid[dow][hour];
        if (v > 0) {
          const cell = { dow, hour, value: v };
          out.push(cell);
          populated++;
          if (!peakCell || v > peakCell.value) peakCell = cell;
        }
      }
    }
    return { cells: out, populatedCells: populated, peak: peakCell };
  }, [hourly]);

  if (populatedCells < HEATMAP_MIN_POPULATED_CELLS) {
    return <SectionEmpty>Heatmap fills in as you run more sessions</SectionEmpty>;
  }

  return (
    <div className={styles.heatmapFrame}>
      {peak ? (
        <div className={styles.heatmapLead}>
          <span className={styles.heatmapLeadLabel}>peak</span>
          <span className={styles.heatmapLeadValue}>
            {peak.value} {peak.value === 1 ? 'session' : 'sessions'}
          </span>
          <span className={styles.heatmapLeadMeta}>
            {hourGlyph(peak.hour)} {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][peak.dow]}
          </span>
        </div>
      ) : null}
      <HourHeatmap data={cells} cellSize={16} />
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
  const ranked = [...workTypes].sort((a, b) => b.edits - a.edits);
  // Cap segment count on the weft strip; tail merges into one "other" bucket
  // (detail view has the full list).
  const maxBands = 6;
  const displayRows =
    ranked.length <= maxBands
      ? ranked
      : [
          ...ranked.slice(0, maxBands - 1),
          {
            work_type: 'other',
            edits: ranked.slice(maxBands - 1).reduce((s, w) => s + w.edits, 0),
            sessions: ranked.slice(maxBands - 1).reduce((s, w) => s + w.sessions, 0),
          },
        ];
  const primary = displayRows[0]!;
  const primaryPct = Math.round((primary.edits / totalEdits) * 100);
  const aria = ranked
    .map(
      (w) =>
        `${formatWorkTypeLabel(w.work_type)} ${Math.round((w.edits / totalEdits) * 100)} percent of edits`,
    )
    .join(', ');
  const primaryLabel = formatWorkTypeLabel(primary.work_type);
  return (
    <div
      className={styles.mixWeft}
      role="group"
      aria-label={`${primaryPct} percent of edits in ${primaryLabel}. Full mix: ${aria}`}
    >
      <div className={styles.mixStrip} aria-hidden>
        {displayRows.map((w, i) => {
          const pct = Math.round((w.edits / totalEdits) * 100);
          const c = workTypeColor(w.work_type);
          return (
            <div
              key={
                i === displayRows.length - 1 && w.work_type === 'other'
                  ? 'other-merged'
                  : w.work_type
              }
              className={styles.mixSeg}
              style={
                {
                  flexGrow: w.edits,
                  flexBasis: 0,
                  minWidth: 2,
                  background: c,
                } as CSSProperties
              }
              title={`${w.work_type}: ${pct}% of edits (${w.edits} edits, ${w.sessions} sessions)`}
            />
          );
        })}
      </div>
      <div className={styles.mixSummary}>
        <span className={styles.mixPct}>{primaryPct}%</span>
        <span className={styles.mixIn}>in</span>
        <span className={styles.mixName} style={{ color: workTypeColor(primary.work_type) }}>
          {primaryLabel}
        </span>
        <span className={styles.mixEditsUnit}>edits</span>
      </div>
    </div>
  );
}

// Below this many qualifying hours the bar chart is too thin to read
// usefully. Off-hour bursts wash a 2-hour view, and the slice-by-volume
// rule (qualifyByVolume p25) usually keeps 6+ hours when sessions are
// real — so under 4 indicates "not enough data yet" rather than "show
// a degenerate viz."
const EFFECTIVE_HOURS_MIN_QUALIFIED = 4;
const EFFECTIVE_WINDOW_HOURS = 3;

function hourGlyph(h: number): string {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

/** End-boundary label so a 3h block reads as a wall-clock span (e.g. 10a–1p). */
function hourWindowWallRange(start: number, windowHrs: number): string {
  const endH = (start + windowHrs) % 24;
  return `${hourGlyph(start)}–${hourGlyph(endH)}`;
}

interface HourWindow {
  start: number;
  sessions: number;
  rate: number;
}

function buildHourWindows(hours: UserAnalytics['hourly_effectiveness']): HourWindow[] {
  const byHour = new Map(hours.map((h) => [h.hour, h]));
  const windows: HourWindow[] = [];
  for (let start = 0; start <= 24 - EFFECTIVE_WINDOW_HOURS; start++) {
    const slice = Array.from({ length: EFFECTIVE_WINDOW_HOURS }, (_, i) => byHour.get(start + i));
    const sessions = slice.reduce((sum, h) => sum + (h?.sessions ?? 0), 0);
    if (sessions === 0) continue;
    const completed = slice.reduce(
      (sum, h) => sum + ((h?.completion_rate ?? 0) / 100) * (h?.sessions ?? 0),
      0,
    );
    windows.push({
      start,
      sessions,
      rate: Math.round((completed / sessions) * 100),
    });
  }
  return windows;
}

function HourlyEffectivenessWidget({ analytics }: WidgetBodyProps) {
  const qualified = useMemo(
    () => qualifyByVolume(analytics.hourly_effectiveness, (h) => h.sessions, 25),
    [analytics.hourly_effectiveness],
  );

  const { series, bestWindow, maxSess, ariaDiel } = useMemo(() => {
    const byHour = new Map(analytics.hourly_effectiveness.map((h) => [h.hour, h]));
    const series = Array.from({ length: 24 }, (_, hour) => {
      const h = byHour.get(hour);
      return {
        hour,
        sessions: h?.sessions ?? 0,
        completion_rate: h != null ? Math.round(h.completion_rate) : 0,
      };
    });
    const windows = buildHourWindows(analytics.hourly_effectiveness);
    const maxWindowSessions = Math.max(1, ...windows.map((w) => w.sessions));
    const meaningful = windows.filter((w) => w.sessions >= Math.max(3, maxWindowSessions * 0.25));
    const windowSet = meaningful.length > 0 ? meaningful : windows;
    let best: HourWindow = { start: 0, rate: 0, sessions: 0 };
    if (windowSet.length) {
      best = windowSet.reduce((top, w) => (w.rate > top.rate ? w : top));
    }
    const maxS = Math.max(1, ...series.map((d) => d.sessions));
    const ariaDiel = `Completion by hour${
      best.sessions
        ? `, ${best.rate} percent in best ${EFFECTIVE_WINDOW_HOURS}h window ${hourWindowWallRange(
            best.start,
            EFFECTIVE_WINDOW_HOURS,
          )}`
        : ''
    }.`;
    return { series, bestWindow: best, maxSess: maxS, ariaDiel };
  }, [analytics.hourly_effectiveness]);

  if (qualified.length < EFFECTIVE_HOURS_MIN_QUALIFIED) {
    return <SectionEmpty>Needs at least 4 high-volume hours — keep working.</SectionEmpty>;
  }

  const bestRangeLabel =
    bestWindow.sessions > 0 ? hourWindowWallRange(bestWindow.start, EFFECTIVE_WINDOW_HOURS) : '';

  return (
    <div className={styles.diel} role="group" aria-label={ariaDiel}>
      {bestWindow.sessions > 0 ? (
        <div className={styles.dielLead}>
          <div className={styles.dielLeadNum}>{bestWindow.rate}%</div>
          <div className={styles.dielLeadSub}>
            Best {EFFECTIVE_WINDOW_HOURS}h window, {bestRangeLabel}
          </div>
        </div>
      ) : null}
      <div className={styles.dielPillarStage}>
        <div className={styles.dielPillars}>
          {series.map((d) => {
            const c = completionColor(d.completion_rate);
            const hasData = d.sessions > 0;
            const vol = hasData ? 0.22 + 0.78 * (d.sessions / maxSess) : 0.12;
            const inBest =
              bestWindow.sessions > 0 &&
              d.hour >= bestWindow.start &&
              d.hour < bestWindow.start + EFFECTIVE_WINDOW_HOURS;
            return (
              <div
                key={d.hour}
                className={styles.dielCell}
                title={
                  hasData
                    ? `${hourGlyph(d.hour)}: ${d.completion_rate}% done, ${d.sessions} sessions`
                    : `${hourGlyph(d.hour)}: no volume`
                }
              >
                <div
                  className={`${styles.dielPillar} ${inBest ? styles.dielPillarBest : ''}`}
                  style={
                    {
                      height: hasData ? `${d.completion_rate}%` : '4%',
                      background: c,
                      opacity: vol,
                    } as CSSProperties
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.dielRim} aria-hidden>
        {series.map((d) => {
          const t = d.hour;
          if (t !== 0 && t !== 6 && t !== 12 && t !== 18) {
            return <span key={d.hour} className={styles.dielTick} />;
          }
          return (
            <span key={d.hour} className={styles.dielTickLabeled}>
              {hourGlyph(t)}
            </span>
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
