import { useMemo, type CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { setQueryParam, useRoute } from '../../lib/router.js';
import { arcPath, computeArcSlices } from '../../lib/svgArcs.js';
import { completionColor, workTypeColor } from '../utils.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import shared from '../widget-shared.module.css';
import styles from './OutcomeWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { InlineDelta, Sparkline, StatWidget, CoverageNote } from './shared.js';

/** Outcomes detail-view drill. Gated to overview scope because the
 * detail view is only mounted there (same gating as UsageWidgets). */
function openOutcomes(tab: string) {
  return () => setQueryParam('outcomes', tab);
}

function useIsDrillable(): boolean {
  const route = useRoute();
  return route.view === 'overview';
}

/* ─────────────────────────────────────────────────────
 * Outcomes category — main-view widgets.
 *
 * The category answers one question: "did the work land?" Every widget
 * visualizes that from a different angle with a distinct viz family:
 *
 *   outcomes             — ring (4×3)
 *   one-shot-rate        — stat (3×2)
 *   stuckness            — stat-row (4×2)
 *   scope-complexity     — scope band (6×3)
 *   work-type-outcomes   — horizontal bars (6×3)
 *
 * `first-edit` and `duration-dist` used to live here; both were cut
 * 2026-04-24 per the Widget-Detail Precedent (WIDGET_RUBRIC.md). Each
 * already had an honest home inside the Usage detail Sessions panel —
 * a widget-shaped duplicate wasn't earning its main-view seat.
 *
 * Coverage notes only render in empty states. Populated states keep
 * the widget body chromeless — the widget title names the metric;
 * repeating it below the value is filler. ──────────────────────── */

// ── Outcomes ring + clickable row table ─────────────
//
// 8×3 cell = ~671×240 body. Ring on the left (matches the UsageDetailView
// ToolRing — 160px, SW=8), table on the right with clickable row
// buttons. The ring is the visual identity; the table is the
// breakdown + drill affordance.

const RING_VIEW = 160;
const RING_CX = 80;
const RING_CY = 80;
const RING_R = 58;
const RING_GAP_DEG = 14;

type OutcomeKey = 'completed' | 'abandoned' | 'failed' | 'unknown';

interface OutcomeSlice {
  key: OutcomeKey;
  label: string;
  count: number;
  color: string;
  muted: boolean;
}

function OutcomesWidget({ analytics }: WidgetBodyProps) {
  const cs = analytics.completion_summary;
  const pc = analytics.period_comparison;
  const prevRate = pc.previous?.completion_rate;
  const currRate = pc.current.completion_rate;
  const completionDelta = prevRate != null && prevRate > 0 ? currRate - prevRate : null;
  const drillable = useIsDrillable();

  if (cs.total_sessions === 0) {
    return <SectionEmpty>No sessions yet</SectionEmpty>;
  }

  const allSlices: OutcomeSlice[] = [
    {
      key: 'completed',
      label: 'completed',
      count: cs.completed,
      color: 'var(--success)',
      muted: false,
    },
    {
      key: 'abandoned',
      label: 'abandoned',
      count: cs.abandoned,
      color: 'var(--warn)',
      muted: false,
    },
    { key: 'failed', label: 'failed', count: cs.failed, color: 'var(--danger)', muted: false },
    { key: 'unknown', label: 'no outcome', count: cs.unknown, color: 'var(--ghost)', muted: true },
  ];
  const slices = allSlices.filter((s) => s.count > 0);
  const reported = cs.total_sessions - cs.unknown;

  // Per-outcome daily series for the TREND mini-sparkline column.
  const trends: Record<OutcomeKey, number[]> = {
    completed: analytics.daily_trends.map((d) => d.completed ?? 0),
    abandoned: analytics.daily_trends.map((d) => d.abandoned ?? 0),
    failed: analytics.daily_trends.map((d) => d.failed ?? 0),
    unknown: analytics.daily_trends.map((d) => {
      const total = d.sessions ?? 0;
      const known = (d.completed ?? 0) + (d.abandoned ?? 0) + (d.failed ?? 0);
      return Math.max(0, total - known);
    }),
  };

  return (
    <div className={styles.outcomeFrame}>
      <OutcomeRing
        slices={slices.filter((s) => !s.muted)}
        cs={cs}
        completionDelta={completionDelta}
        reported={reported}
      />
      <div className={styles.outcomeTable} role="table">
        <div className={styles.outcomeHeadRow} role="row">
          <span role="columnheader">outcome</span>
          <span role="columnheader" className={styles.outcomeHeadNum}>
            count
          </span>
          <span role="columnheader">share</span>
          <span role="columnheader">trend</span>
          <span aria-hidden="true" />
        </div>
        {slices.map((s, i) => {
          const share = cs.total_sessions > 0 ? s.count / cs.total_sessions : 0;
          const sharePct = Math.round(share * 100);
          const series = trends[s.key];
          const content = (
            <>
              <span className={styles.outcomeCellOutcome}>
                <span
                  className={styles.outcomeDot}
                  style={{ background: s.color, opacity: s.muted ? 0.45 : 1 }}
                />
                <span className={styles.outcomeLabel}>{s.label}</span>
              </span>
              <span className={styles.outcomeCount}>{s.count.toLocaleString()}</span>
              <span className={styles.outcomeShareCell}>
                <span className={styles.outcomeShareTrack}>
                  <span
                    className={styles.outcomeShareFill}
                    style={{
                      width: `${Math.max(2, sharePct)}%`,
                      background: s.color,
                      opacity: s.muted ? 0.35 : 'var(--opacity-bar-fill)',
                    }}
                  />
                </span>
                <span className={styles.outcomeShareValue}>{sharePct}%</span>
              </span>
              <span className={styles.outcomeTrendCell}>
                {series.length >= 2 ? (
                  <Sparkline
                    values={series}
                    color={s.color}
                    muted={s.muted}
                    className={styles.outcomeSparkline}
                  />
                ) : (
                  <span className={styles.outcomeTrendBlank}>—</span>
                )}
              </span>
              {drillable && <span className={styles.outcomeViewButton}>View</span>}
            </>
          );
          if (drillable) {
            return (
              <button
                key={s.key}
                type="button"
                role="row"
                className={styles.outcomeDataRow}
                style={{ '--row-index': i } as CSSProperties}
                onClick={openOutcomes('sessions')}
                aria-label={`Open outcomes detail · ${s.label} ${s.count}`}
              >
                {content}
              </button>
            );
          }
          return (
            <div
              key={s.key}
              role="row"
              className={styles.outcomeDataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Ring component — mirrors UsageDetailView's ToolRing: 160×160
 *  SVG, R=58, SW=8, center value + caption as SVG text. `unknown`
 *  outcome is excluded from arcs (caller pre-filters) because the
 *  arc has no audience signal; it surfaces instead as the small
 *  reported-count caption underneath the ring when its share is
 *  high enough to matter. */
function OutcomeRing({
  slices,
  cs,
  completionDelta,
  reported,
}: {
  slices: OutcomeSlice[];
  cs: UserAnalytics['completion_summary'];
  completionDelta: number | null;
  reported: number;
}) {
  const arcs = useMemo(
    () =>
      computeArcSlices(
        slices.map((s) => s.count),
        RING_GAP_DEG,
      ).map((seg, i) => ({ ...slices[i], ...seg })),
    [slices],
  );

  const rate = Math.round(cs.completion_rate);
  const highUnknown = cs.unknown > 0 && reported / cs.total_sessions < 0.7;

  return (
    <div className={styles.ringBlock}>
      <svg
        viewBox={`0 0 ${RING_VIEW} ${RING_VIEW}`}
        className={styles.ringSvg}
        role="img"
        aria-label={`Completion rate ${rate}%, ${cs.completed} of ${cs.total_sessions} sessions completed`}
      >
        <circle cx={RING_CX} cy={RING_CY} r={RING_R} className={styles.ringTrack} />
        {arcs
          .filter((a) => a.sweepDeg > 0.2)
          .map((a) => (
            <path
              key={a.key}
              d={arcPath(RING_CX, RING_CY, RING_R, a.startDeg, a.sweepDeg)}
              className={styles.ringArc}
              style={{ stroke: a.color, opacity: 0.9 }}
            >
              <title>
                {a.label}: {a.count}
              </title>
            </path>
          ))}
        <text
          x={RING_CX}
          y={RING_CY - 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--ink)"
          fontSize="30"
          fontWeight="200"
          fontFamily="var(--display)"
          letterSpacing="-0.04em"
        >
          {rate}%
        </text>
        <text
          x={RING_CX}
          y={RING_CY + 20}
          textAnchor="middle"
          fill="var(--soft)"
          fontSize="8"
          fontFamily="var(--mono)"
          letterSpacing="0.14em"
        >
          COMPLETED
        </text>
      </svg>
      {completionDelta != null && (
        <span className={styles.ringCaption}>
          <InlineDelta value={completionDelta} /> vs prior period
        </span>
      )}
      {highUnknown && (
        <span className={styles.ringCaption}>
          {reported} of {cs.total_sessions} reported
        </span>
      )}
    </div>
  );
}

// ── One-shot rate (3×2) ─────────────────────────────
//
// CodeBurn's killer metric. Coverage note appears ONLY in the empty
// state — populated state is chromeless, matching the edits/cost stat
// cards next to it in the default KPI strip.

function OneShotRateWidget({ analytics }: WidgetBodyProps) {
  const s = analytics.tool_call_stats;
  const drillable = useIsDrillable();
  if (s.one_shot_sessions === 0) {
    // capabilityCoverageNote is silent when every reporting tool declares
    // the capability — but today only Claude Code's JSONL parser actually
    // populates tool_calls end-to-end. A Cursor-only user would get `--`
    // with no note under the generic helper, which is the D3a lie the
    // rubric exists to prevent. Name the source instead of the capability.
    return (
      <>
        <StatWidget value="--" />
        <CoverageNote text="Needs tool call logs. Available from Claude Code today; other hook-enabled tools pending." />
      </>
    );
  }
  const value = `${s.one_shot_rate}%`;
  return (
    <StatWidget
      value={value}
      onOpenDetail={drillable ? openOutcomes('retries') : undefined}
      detailAriaLabel={drillable ? `Open outcomes detail · ${value} one-shot rate` : undefined}
    />
  );
}

// ── Stuckness (4×2) ─────────────────────────────────
//
// Bare hero stat, same primitive as every other KPI stat in the system
// (edits, cost, one-shot-rate). No caption below the value — the
// supporting facts (n/total, recovered%) live in the detail view.
// Widget bodies stay chromeless; the title tells you what the number
// means, the detail view tells you what to do about it.

function StucknessWidget({ analytics }: WidgetBodyProps) {
  const s = analytics.stuckness;
  const drillable = useIsDrillable();
  if (s.total_sessions === 0) {
    return <StatWidget value="--" />;
  }
  const pc = analytics.period_comparison;
  const prevStuck = pc.previous?.stuckness_rate;
  const stuckDelta: { current: number; previous: number } | null =
    prevStuck != null && prevStuck > 0 ? { current: s.stuckness_rate, previous: prevStuck } : null;

  const value = `${s.stuckness_rate}%`;
  return (
    <StatWidget
      value={value}
      delta={stuckDelta}
      deltaInvert
      onOpenDetail={drillable ? openOutcomes('sessions') : undefined}
      detailAriaLabel={drillable ? `Open outcomes detail · ${value} stuck rate` : undefined}
    />
  );
}

// ── Completion by scope (6×3) ───────────────────────
//
// Scope terrace. Scope is ordinal, so render a stepped terrain: each
// terrace is one file-scope bucket, with vertical position carrying
// completion. Labels stay in DOM outside the geometry to avoid overlap.

function ScopeComplexityWidget({ analytics }: WidgetBodyProps) {
  const sc = analytics.scope_complexity.filter((b) => b.sessions > 0);
  if (sc.length < 2) {
    return (
      <SectionEmpty>
        {sc.length === 0
          ? 'Appears after sessions touch files'
          : 'Needs at least two buckets with sessions'}
      </SectionEmpty>
    );
  }

  return (
    <div className={styles.scopeFrame}>
      <ScopeTerrace buckets={sc} />
    </div>
  );
}

function ScopeTerrace({ buckets }: { buckets: UserAnalytics['scope_complexity'] }) {
  return (
    <div
      className={styles.scopeTerrace}
      role="img"
      aria-label="Completion rate by touched-file scope"
    >
      <div className={styles.scopeTerraceViz} aria-hidden="true">
        {buckets.map((b, i) => {
          const color = completionColor(b.completion_rate);
          return (
            <span
              key={b.bucket}
              className={styles.scopeTerraceStep}
              style={
                {
                  '--row-index': i,
                  '--scope-y': `${100 - b.completion_rate}%`,
                  '--scope-color': color,
                } as CSSProperties
              }
            />
          );
        })}
      </div>
      <div className={styles.scopeTerraceLabels}>
        {buckets.map((b, i) => {
          const color = completionColor(b.completion_rate);
          return (
            <span
              key={b.bucket}
              className={styles.scopeTerraceLabel}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.scopeTerraceRate} style={{ color }}>
                {b.completion_rate}%
              </span>
              <span className={styles.scopeTerraceBucket}>{b.bucket}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Work-type outcomes (6×3) ────────────────────────
//
// Horizontal bars keyed on nominal work-type categories (no ordering,
// so no curve shape). Per-type color from the workTypeColor palette,
// matching the work-types widget vocabulary.

function WorkTypeOutcomesWidget({ analytics }: WidgetBodyProps) {
  const wto = analytics.work_type_outcomes;
  if (wto.length === 0) {
    return (
      <>
        <SectionEmpty>Appears after sessions touch files</SectionEmpty>
        <CoverageNote text="Only sessions that touched a file are classified" />
      </>
    );
  }
  return (
    <div className={shared.metricBars}>
      {wto.map((w, i) => (
        <div
          key={w.work_type}
          className={shared.metricRow}
          style={{ '--row-index': i } as CSSProperties}
          title={`${w.work_type}: ${w.completion_rate}% across ${w.sessions} sessions`}
        >
          <span className={shared.metricLabel}>{w.work_type}</span>
          <div className={shared.metricBarTrack}>
            <div
              className={shared.metricBarFill}
              style={{
                width: `${w.completion_rate}%`,
                background: workTypeColor(w.work_type),
                opacity: 'var(--opacity-bar-fill)',
              }}
            />
          </div>
          <span className={shared.metricValue}>
            {w.completion_rate}% · {w.sessions}
          </span>
        </div>
      ))}
    </div>
  );
}

export const outcomeWidgets: WidgetRegistry = {
  outcomes: OutcomesWidget,
  'one-shot-rate': OneShotRateWidget,
  stuckness: StucknessWidget,
  'scope-complexity': ScopeComplexityWidget,
  'work-type-outcomes': WorkTypeOutcomesWidget,
};
