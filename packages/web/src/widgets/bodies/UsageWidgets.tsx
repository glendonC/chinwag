import { setQueryParam, useRoute } from '../../lib/router.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import {
  StatWidget,
  CoverageNote,
  capabilityCoverageNote,
  hasCostData,
  costEmptyReason,
} from './shared.js';
import { formatCost } from '../utils.js';
import { WorkTypeStrip } from '../../components/WorkTypeStrip/index.js';

function openUsage(tab: string) {
  return () => setQueryParam('usage', tab);
}

/**
 * Both OverviewView and ProjectView now mount UsageDetailView in response to
 * the `?usage=` query param, so the drill affordance is honored on either
 * scope. Other views (tools, reports, settings) don't mount the detail view
 * and should not surface the drill-in click.
 */
function useIsDrillable(): boolean {
  const route = useRoute();
  return route.view === 'overview' || route.view === 'project';
}

// True when no day in the period was observed — distinct from "days were
// observed but every metric was zero." Widgets render `--` in the first
// case and `0` in the second, so the user can tell "system captured
// nothing" apart from "I genuinely did no work."
function isEmptyPeriod(analytics: UserAnalytics): boolean {
  return analytics.daily_trends.length === 0;
}

/**
 * In-window delta: split daily_trends in half by position and compare sums.
 * Preferred over `period_comparison` for stat deltas because the worker's
 * 30-day session retention (`SESSION_RETENTION_DAYS`) structurally empties
 * the `[days*2, days]`-ago previous window used by `queryPeriodComparison`,
 * so that delta is null for every production user. Splitting the current
 * window sidesteps retention and keeps the delta honest for any period.
 * Returns null with fewer than two observed days. For odd counts the single
 * middle day is dropped so both halves span the same day count.
 */
function splitPeriodDelta<T>(
  days: T[],
  select: (row: T) => number,
): { current: number; previous: number } | null {
  if (days.length < 2) return null;
  const mid = Math.floor(days.length / 2);
  const currentStart = days.length % 2 === 0 ? mid : mid + 1;
  const previous = days.slice(0, mid).reduce((s, d) => s + select(d), 0);
  const current = days.slice(currentStart).reduce((s, d) => s + select(d), 0);
  return { current, previous };
}

/**
 * Screen-reader suffix mirroring the visual delta glyph (↑/↓/→). Empty when
 * the visual delta is suppressed (null or previous <= 0).
 */
function deltaAriaSuffix(delta: { current: number; previous: number } | null): string {
  if (!delta || delta.previous <= 0) return '';
  const diff = delta.current - delta.previous;
  if (diff === 0) return ', no change from the previous half of this period';
  const magnitude = Math.abs(Math.round(diff * 10) / 10).toLocaleString();
  const direction = diff > 0 ? 'up' : 'down';
  return `, ${direction} ${magnitude} from the previous half of this period`;
}

function SessionsWidget({ analytics }: WidgetBodyProps) {
  const drillable = useIsDrillable();
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  const v = analytics.daily_trends.reduce((s, d) => s + d.sessions, 0);
  const delta = splitPeriodDelta(analytics.daily_trends, (d) => d.sessions);
  const ariaDelta = deltaAriaSuffix(delta);
  const display = v.toLocaleString();
  return (
    <StatWidget
      value={display}
      delta={delta}
      onOpenDetail={drillable ? openUsage('sessions') : undefined}
      detailAriaLabel={
        drillable ? `Open usage detail · ${display} sessions${ariaDelta}` : undefined
      }
    />
  );
}

function EditsWidget({ analytics }: WidgetBodyProps) {
  const drillable = useIsDrillable();
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  const v = analytics.daily_trends.reduce((s, d) => s + d.edits, 0);
  // Delta source is in-period split, not period_comparison.edit_velocity —
  // the latter mixes a rate (edits/hr) against a totals hero, and its
  // previous window is structurally empty under 30-day retention.
  const delta = splitPeriodDelta(analytics.daily_trends, (d) => d.edits);
  const ariaDelta = deltaAriaSuffix(delta);
  const display = v.toLocaleString();
  return (
    <StatWidget
      value={display}
      delta={delta}
      onOpenDetail={drillable ? openUsage('edits') : undefined}
      detailAriaLabel={drillable ? `Open usage detail · ${display} edits${ariaDelta}` : undefined}
    />
  );
}

// Lines added/removed drill into their own Lines tab — edit count and line
// volume are distinct questions (activity vs churn), so they get distinct
// viz. The Lines tab is built around the diverging-timeline + per-work-type
// + per-member/per-project splits that `member_daily_lines` and
// `per_project_lines` exist to power.
function LinesAddedWidget({ analytics }: WidgetBodyProps) {
  const drillable = useIsDrillable();
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  const v = analytics.daily_trends.reduce((s, d) => s + d.lines_added, 0);
  const delta = splitPeriodDelta(analytics.daily_trends, (d) => d.lines_added);
  const ariaDelta = deltaAriaSuffix(delta);
  const display = `+${v.toLocaleString()}`;
  return (
    <StatWidget
      value={display}
      delta={delta}
      onOpenDetail={drillable ? openUsage('lines') : undefined}
      detailAriaLabel={
        drillable ? `Open usage detail · ${display} lines added${ariaDelta}` : undefined
      }
    />
  );
}

function LinesRemovedWidget({ analytics }: WidgetBodyProps) {
  const drillable = useIsDrillable();
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  const v = analytics.daily_trends.reduce((s, d) => s + d.lines_removed, 0);
  const delta = splitPeriodDelta(analytics.daily_trends, (d) => d.lines_removed);
  const ariaDelta = deltaAriaSuffix(delta);
  const display = `-${v.toLocaleString()}`;
  return (
    <StatWidget
      value={display}
      delta={delta}
      onOpenDetail={drillable ? openUsage('lines') : undefined}
      detailAriaLabel={
        drillable ? `Open usage detail · ${display} lines removed${ariaDelta}` : undefined
      }
    />
  );
}

// files_touched_total comes from COUNT(DISTINCT file_path) on the edits
// table — uncapped. Distinct from file_heatmap.length, which is the
// ranked top-50 list and would silently cap this stat at 50. Capture
// gate is hook-enabled tools (Claude Code, Cursor, Windsurf); the
// CoverageNote discloses this when non-hook tools are active.
//
// The card face pairs the scalar with a 3px work-type strip — files_touched
// is breadth, and breadth has a native second dimension (what kind of
// surface). The strip decompresses the number without labels; one glance
// reveals "mostly backend + test" before the drill opens.
function FilesTouchedWidget({ analytics }: WidgetBodyProps) {
  const drillable = useIsDrillable();
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  const n = analytics.files_touched_total;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'hooks');
  const display = n.toLocaleString();
  const breakdown = analytics.files_by_work_type;
  return (
    <>
      <StatWidget
        value={display}
        onOpenDetail={drillable ? openUsage('files-touched') : undefined}
        detailAriaLabel={drillable ? `Open usage detail · ${display} files touched` : undefined}
      />
      {breakdown.length > 0 && (
        <WorkTypeStrip
          entries={breakdown}
          variant="card"
          ariaLabel={`${display} files touched by work type`}
        />
      )}
      <CoverageNote text={note} />
    </>
  );
}

function CostWidget({ analytics }: WidgetBodyProps) {
  const t = analytics.token_usage;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const drillable = useIsDrillable();
  // Widen beyond the old `sessions > 0` gate: stale pricing and
  // all-models-unpriced are both "can't honestly compute" states where
  // pricing-enrich zeros the total. Rendering $0.00 in those states would
  // lie. hasCostData folds all three degraded paths into one predicate.
  const reliable = hasCostData(t);
  const value = reliable ? formatCost(t.total_estimated_cost_usd, 2) : '--';
  const note = reliable ? capabilityCoverageNote(tools, 'tokenUsage') : costEmptyReason(t, tools);
  const canDrill = reliable && drillable;
  return (
    <>
      <StatWidget
        value={value}
        onOpenDetail={canDrill ? openUsage('cost') : undefined}
        detailAriaLabel={canDrill ? `Open usage detail · ${value} cost` : undefined}
      />
      <CoverageNote text={note} />
    </>
  );
}

function CostPerEditWidget({ analytics }: WidgetBodyProps) {
  const t = analytics.token_usage;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const drillable = useIsDrillable();
  // Lock-step with CostWidget: cost-per-edit is the numerator's ratio, so
  // whenever cost itself isn't showable, the ratio isn't either. Prevents
  // the "total says -- but the ratio shows a number" divergence.
  const reliable = hasCostData(t) && t.cost_per_edit != null;
  const value = reliable ? formatCost(t.cost_per_edit, 3) : '--';
  const note = reliable ? capabilityCoverageNote(tools, 'tokenUsage') : costEmptyReason(t, tools);
  const canDrill = reliable && drillable;
  // Period-over-period delta. Both windows are priced against the current
  // snapshot (via enrichPeriodComparisonCost) so the arrow reflects
  // behavior change, not price drift. `deltaInvert` renders a downward
  // move green — cheaper is the improvement direction here. Structurally
  // null at 30-day windows (previous is outside retention) and at any
  // window where either side has no priced token data; StatWidget's delta
  // gate then suppresses the pill without the widget needing to know why.
  const pc = analytics.period_comparison;
  const delta =
    reliable && pc
      ? {
          current: pc.current.cost_per_edit,
          previous: pc.previous?.cost_per_edit ?? null,
        }
      : null;
  return (
    <>
      <StatWidget
        value={value}
        delta={delta}
        deltaInvert
        deltaFormat="usd-fine"
        onOpenDetail={canDrill ? openUsage('cost-per-edit') : undefined}
        detailAriaLabel={canDrill ? `Open usage detail · ${value} per edit` : undefined}
      />
      <CoverageNote text={note} />
    </>
  );
}

export const usageWidgets: WidgetRegistry = {
  sessions: SessionsWidget,
  edits: EditsWidget,
  'lines-added': LinesAddedWidget,
  'lines-removed': LinesRemovedWidget,
  'files-touched': FilesTouchedWidget,
  cost: CostWidget,
  'cost-per-edit': CostPerEditWidget,
};
