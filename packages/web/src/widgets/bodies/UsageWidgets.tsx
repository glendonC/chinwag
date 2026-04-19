import { setQueryParam } from '../../lib/router.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { StatWidget, CoverageNote, capabilityCoverageNote } from './shared.js';

function openUsage(tab: string) {
  return () => setQueryParam('usage', tab);
}

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
  return (
    <StatWidget
      value={v.toLocaleString()}
      delta={delta}
      onOpenDetail={openUsage('sessions')}
      detailAriaLabel={`Open usage detail · ${v.toLocaleString()} sessions`}
    />
  );
}

function EditsWidget({ analytics }: WidgetBodyProps) {
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  const v = analytics.daily_trends.reduce((s, d) => s + d.edits, 0);
  const pc = analytics.period_comparison;
  const delta = pc.previous
    ? { current: pc.current.edit_velocity, previous: pc.previous.edit_velocity }
    : null;
  return (
    <StatWidget
      value={v.toLocaleString()}
      delta={delta}
      onOpenDetail={openUsage('edits')}
      detailAriaLabel={`Open usage detail · ${v.toLocaleString()} edits`}
    />
  );
}

// Lines added/removed don't have a dedicated tab — they're a subset of the
// edits story, so they drill into the Edits tab where by-tool + most-touched
// file breakdowns give them context.
function LinesAddedWidget({ analytics }: WidgetBodyProps) {
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  const v = analytics.daily_trends.reduce((s, d) => s + d.lines_added, 0);
  return (
    <StatWidget
      value={`+${v.toLocaleString()}`}
      onOpenDetail={openUsage('edits')}
      detailAriaLabel={`Open usage detail · +${v.toLocaleString()} lines added`}
    />
  );
}

function LinesRemovedWidget({ analytics }: WidgetBodyProps) {
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  const v = analytics.daily_trends.reduce((s, d) => s + d.lines_removed, 0);
  return (
    <StatWidget
      value={`-${v.toLocaleString()}`}
      onOpenDetail={openUsage('edits')}
      detailAriaLabel={`Open usage detail · -${v.toLocaleString()} lines removed`}
    />
  );
}

function FilesTouchedWidget({ analytics }: WidgetBodyProps) {
  if (isEmptyPeriod(analytics)) return <StatWidget value="--" />;
  const n = analytics.file_heatmap.length;
  return (
    <StatWidget
      value={String(n)}
      onOpenDetail={openUsage('files-touched')}
      detailAriaLabel={`Open usage detail · ${n} files touched`}
    />
  );
}

function CostWidget({ analytics }: WidgetBodyProps) {
  const t = analytics.token_usage;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'tokenUsage');
  const hasData = t.sessions_with_token_data > 0;
  const value = hasData ? `$${t.total_estimated_cost_usd.toFixed(2)}` : '--';
  return (
    <>
      <StatWidget
        value={value}
        onOpenDetail={hasData ? openUsage('cost') : undefined}
        detailAriaLabel={hasData ? `Open usage detail · ${value} cost` : undefined}
      />
      <CoverageNote text={note} />
    </>
  );
}

function CostPerEditWidget({ analytics }: WidgetBodyProps) {
  const cpe = analytics.token_usage.cost_per_edit;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'tokenUsage');
  const hasData = cpe != null;
  const value = hasData ? `$${cpe.toFixed(3)}` : '--';
  return (
    <>
      <StatWidget
        value={value}
        onOpenDetail={hasData ? openUsage('cost-per-edit') : undefined}
        detailAriaLabel={hasData ? `Open usage detail · ${value} per edit` : undefined}
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
