import { useMemo, type CSSProperties, type KeyboardEvent } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { setQueryParam, useRoute } from '../../lib/router.js';
import { arcPath } from '../../lib/svgArcs.js';
import { completionColor, workTypeColor } from '../utils.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import shared from '../widget-shared.module.css';
import styles from './OutcomeWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { InlineDelta, StatWidget, CoverageNote } from './shared.js';

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
 *   scope-complexity     — curve (6×3)
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

// ── Hero ring ───────────────────────────────────────
//
// 4×3 cell = ~317w × 240h body. Side-by-side layout fits a 140px ring
// + 3-4 legend rows without clipping. Arc stroke-width 8 at R=58 keeps
// the round-cap overlap floor at ~10° — RING_GAP_DEG 14° has headroom.

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

  return (
    <OutcomeRing slices={slices} cs={cs} completionDelta={completionDelta} drillable={drillable} />
  );
}

function OutcomeRing({
  slices,
  cs,
  completionDelta,
  drillable,
}: {
  slices: OutcomeSlice[];
  cs: UserAnalytics['completion_summary'];
  completionDelta: number | null;
  drillable: boolean;
}) {
  // Match UsageDetailView's ToolRing exactly — 160px ring, R=58, SW=8,
  // center number rendered as SVG text at fontSize 30 (ToolRing uses
  // 26; we bump slightly for the % sign to still read). HTML overlay
  // was overkill and clipped the top arc. Ring renders reported
  // outcomes only; `unknown` stays out of arcs and legend.
  const reportedSlices = useMemo(() => slices.filter((s) => !s.muted), [slices]);

  // Functional reduce — `let cursor` with in-map mutation trips React
  // Compiler's immutability rule. Accumulate arcs + running cursor in
  // a single reduce pass, then read arcs off the end.
  const arcs = useMemo(() => {
    const total = reportedSlices.reduce((s, x) => s + x.count, 0);
    const safeTotal = Math.max(1, total);
    const gaps = reportedSlices.length > 1 ? reportedSlices.length * RING_GAP_DEG : 0;
    const available = Math.max(0, 360 - gaps);
    const gap = reportedSlices.length > 1 ? RING_GAP_DEG : 0;
    return reportedSlices.reduce<{
      arcs: Array<(typeof reportedSlices)[number] & { startDeg: number; sweepDeg: number }>;
      cursor: number;
    }>(
      (acc, slice) => {
        const sweep = (slice.count / safeTotal) * available;
        return {
          arcs: [...acc.arcs, { ...slice, startDeg: acc.cursor, sweepDeg: sweep }],
          cursor: acc.cursor + sweep + gap,
        };
      },
      { arcs: [], cursor: 0 },
    ).arcs;
  }, [reportedSlices]);

  const rate = Math.round(cs.completion_rate);
  const onClick = drillable ? openOutcomes('sessions') : undefined;
  const highUnknown = cs.unknown > 0 && cs.unknown / cs.total_sessions > 0.3;

  return (
    <div
      className={styles.ringFrame}
      {...(onClick
        ? {
            role: 'button',
            tabIndex: 0,
            onClick,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            },
            style: { cursor: 'pointer' },
            'aria-label': `Open outcomes detail · ${rate}% completion rate`,
          }
        : {})}
    >
      <div className={styles.ringMedia}>
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
      </div>
      <div className={styles.ringLegend}>
        {reportedSlices.map((s, i) => (
          <div
            key={s.key}
            className={styles.ringLegendRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.ringLegendDot} style={{ background: s.color }} />
            <span className={styles.ringLegendLabel}>{s.label}</span>
            <span className={styles.ringLegendValue}>
              {s.count}
              {s.key === 'completed' && completionDelta != null && (
                <InlineDelta value={completionDelta} />
              )}
            </span>
          </div>
        ))}
        {highUnknown && (
          <span className={styles.ringLegendFoot}>
            {cs.total_sessions - cs.unknown} of {cs.total_sessions} reported
          </span>
        )}
      </div>
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
// Row-per-bucket layout matching the `tools` widget's factual-grid
// pattern the user referenced. Each row carries four facts the SVG
// curve hid inside dots: the bucket label, the completion bar, the
// rate %, and a small caption with session count + avg duration.
// The bar color comes from the `completionColor` threshold so the
// ordinal decline (1 file → 7+ files) reads as a visual gradient
// from green at the top to warn/danger at the bottom. Substrate
// value: chinmeister aggregates files_touched across every tool the
// user runs, so this bucket mix is cross-tool by construction.

function ScopeComplexityWidget({ analytics }: WidgetBodyProps) {
  const drillable = useIsDrillable();
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

  const onClick = drillable ? openOutcomes('retries') : undefined;
  const interactiveProps: Record<string, unknown> = onClick
    ? {
        role: 'button',
        tabIndex: 0,
        onClick,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        },
        style: { cursor: 'pointer' },
        'aria-label': 'Open outcomes detail · completion by scope',
      }
    : {};

  return (
    <div className={styles.scopeList} {...interactiveProps}>
      {sc.map((b, i) => {
        const color = completionColor(b.completion_rate);
        const minutes = Math.round(b.avg_duration_min);
        return (
          <div
            key={b.bucket}
            className={styles.scopeRow}
            style={{ '--row-index': i } as CSSProperties}
            title={`${b.bucket}: ${b.completion_rate}% across ${b.sessions} sessions, ${minutes}m avg`}
          >
            <span className={styles.scopeLabel}>{b.bucket}</span>
            <div className={styles.scopeTrack}>
              <div
                className={styles.scopeFill}
                style={{
                  width: `${b.completion_rate}%`,
                  background: color,
                }}
              />
            </div>
            <span className={styles.scopeRate} style={{ color }}>
              {b.completion_rate}%
            </span>
            <span className={styles.scopeMeta}>
              {b.sessions.toLocaleString()} sessions · {minutes}m avg
            </span>
          </div>
        );
      })}
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
