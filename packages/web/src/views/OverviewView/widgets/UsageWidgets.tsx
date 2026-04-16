import { getToolsWithCapability } from '@chinwag/shared/tool-registry.js';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { StatWidget, CoverageNote } from './shared.js';

function tokenCoverageNote(toolsReporting: string[]): string | null {
  const capable = getToolsWithCapability('tokenUsage');
  const reporting = toolsReporting.filter((t) => capable.includes(t));
  if (reporting.length === 0 || reporting.length === toolsReporting.length) return null;
  return `Estimated from ${reporting.join(', ')}`;
}

function SessionsWidget({ analytics }: WidgetBodyProps) {
  const v = analytics.daily_trends.reduce((s, d) => s + d.sessions, 0);
  const pc = analytics.period_comparison;
  const delta = pc.previous
    ? { current: pc.current.total_sessions, previous: pc.previous.total_sessions }
    : null;
  return <StatWidget value={v.toLocaleString()} delta={delta} />;
}

function EditsWidget({ analytics }: WidgetBodyProps) {
  const v = analytics.daily_trends.reduce((s, d) => s + d.edits, 0);
  const pc = analytics.period_comparison;
  const delta = pc.previous
    ? { current: pc.current.edit_velocity, previous: pc.previous.edit_velocity }
    : null;
  return <StatWidget value={v.toLocaleString()} delta={delta} />;
}

function LinesAddedWidget({ analytics }: WidgetBodyProps) {
  const v = analytics.daily_trends.reduce((s, d) => s + d.lines_added, 0);
  return <StatWidget value={`+${v.toLocaleString()}`} />;
}

function LinesRemovedWidget({ analytics }: WidgetBodyProps) {
  const v = analytics.daily_trends.reduce((s, d) => s + d.lines_removed, 0);
  return <StatWidget value={`-${v.toLocaleString()}`} />;
}

function FilesTouchedWidget({ analytics }: WidgetBodyProps) {
  return <StatWidget value={String(analytics.file_heatmap.length)} />;
}

function CostWidget({ analytics }: WidgetBodyProps) {
  const t = analytics.token_usage;
  if (t.sessions_with_token_data === 0) return <StatWidget value="--" />;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  return (
    <>
      <StatWidget value={`$${t.total_estimated_cost_usd.toFixed(2)}`} />
      <CoverageNote text={tokenCoverageNote(tools)} />
    </>
  );
}

function CostPerEditWidget({ analytics }: WidgetBodyProps) {
  const cpe = analytics.token_usage.cost_per_edit;
  if (cpe == null) return <StatWidget value="--" />;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  return (
    <>
      <StatWidget value={`$${cpe.toFixed(3)}`} />
      <CoverageNote text={tokenCoverageNote(tools)} />
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
