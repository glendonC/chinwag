import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { StatWidget } from './shared.js';

function SessionsWidget({ analytics }: WidgetBodyProps) {
  const v = analytics.daily_trends.reduce((s, d) => s + d.sessions, 0);
  return <StatWidget value={v.toLocaleString()} />;
}

function EditsWidget({ analytics }: WidgetBodyProps) {
  const v = analytics.daily_trends.reduce((s, d) => s + d.edits, 0);
  return <StatWidget value={v.toLocaleString()} />;
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
  return <StatWidget value={`$${t.total_estimated_cost_usd.toFixed(2)}`} />;
}

export const usageWidgets: WidgetRegistry = {
  sessions: SessionsWidget,
  edits: EditsWidget,
  'lines-added': LinesAddedWidget,
  'lines-removed': LinesRemovedWidget,
  'files-touched': FilesTouchedWidget,
  cost: CostWidget,
};
