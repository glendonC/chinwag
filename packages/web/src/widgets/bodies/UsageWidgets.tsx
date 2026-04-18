import type { UserAnalytics } from '../../../lib/apiSchemas.js';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { StatWidget, CoverageNote, capabilityCoverageNote } from './shared.js';

// True when no day in the period was observed — distinct from "days were
// observed but every metric was zero." Widgets render `--` in the first
// case and `0` in the second, so the user can tell "system captured
// nothing" apart from "I genuinely did no work."
function isEmptyPeriod(analytics: UserAnalytics): boolean {
  return analytics.daily_trends.length === 0;
}

function SessionsWidget({ analytics }: WidgetBodyProps) {
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  const v = analytics.daily_trends.reduce((s, d) => s + d.sessions, 0);
  const pc = analytics.period_comparison;
  const delta = pc.previous
    ? { current: pc.current.total_sessions, previous: pc.previous.total_sessions }
    : null;
  return <StatWidget value={v.toLocaleString()} delta={delta} />;
}

function EditsWidget({ analytics }: WidgetBodyProps) {
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  const v = analytics.daily_trends.reduce((s, d) => s + d.edits, 0);
  const pc = analytics.period_comparison;
  const delta = pc.previous
    ? { current: pc.current.edit_velocity, previous: pc.previous.edit_velocity }
    : null;
  return <StatWidget value={v.toLocaleString()} delta={delta} />;
}

function LinesAddedWidget({ analytics }: WidgetBodyProps) {
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  const v = analytics.daily_trends.reduce((s, d) => s + d.lines_added, 0);
  return <StatWidget value={`+${v.toLocaleString()}`} />;
}

function LinesRemovedWidget({ analytics }: WidgetBodyProps) {
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  const v = analytics.daily_trends.reduce((s, d) => s + d.lines_removed, 0);
  return <StatWidget value={`-${v.toLocaleString()}`} />;
}

function FilesTouchedWidget({ analytics }: WidgetBodyProps) {
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  return <StatWidget value={String(analytics.file_heatmap.length)} />;
}

function CostWidget({ analytics }: WidgetBodyProps) {
  const t = analytics.token_usage;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'tokenUsage');
  const value =
    t.sessions_with_token_data === 0 ? '--' : `$${t.total_estimated_cost_usd.toFixed(2)}`;
  return (
    <>
      <StatWidget value={value} />
      <CoverageNote text={note} />
    </>
  );
}

function CostPerEditWidget({ analytics }: WidgetBodyProps) {
  const cpe = analytics.token_usage.cost_per_edit;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'tokenUsage');
  const value = cpe == null ? '--' : `$${cpe.toFixed(3)}`;
  return (
    <>
      <StatWidget value={value} />
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
