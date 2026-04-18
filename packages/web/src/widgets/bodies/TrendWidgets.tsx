import { Sparkline } from '../overview-charts.js';
import { completionColor } from '../overview-utils.js';
import styles from '../OverviewView.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { CoverageNote, GhostBars, GhostSparkline, capabilityCoverageNote } from './shared.js';

function SessionTrendWidget({ analytics }: WidgetBodyProps) {
  const data = analytics.daily_trends.map((d) => d.sessions);
  if (data.length < 2) return <GhostSparkline />;
  return <Sparkline data={data} height={80} />;
}

function EditVelocityWidget({ analytics }: WidgetBodyProps) {
  const data = analytics.edit_velocity.map((d) => d.edits_per_hour);
  if (data.length < 2) return <GhostSparkline />;
  return <Sparkline data={data} height={80} />;
}

function PromptEfficiencyWidget({ analytics }: WidgetBodyProps) {
  const pe = analytics.prompt_efficiency;
  const data = pe.map((d) => d.avg_turns_per_edit);
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'conversationLogs');
  if (data.length < 2) {
    return (
      <>
        <GhostSparkline />
        <CoverageNote text={note} />
      </>
    );
  }
  return (
    <>
      <Sparkline data={data} height={80} />
      <CoverageNote text={note} />
    </>
  );
}

function HourlyEffectivenessWidget({ analytics }: WidgetBodyProps) {
  const he = analytics.hourly_effectiveness;
  if (he.length === 0) return <GhostBars count={6} />;
  const maxS = Math.max(...he.map((h) => h.sessions), 1);
  return (
    <div className={styles.metricBars}>
      {he
        .filter((h) => h.sessions > 0)
        .slice(0, 12)
        .map((h) => (
          <div key={h.hour} className={styles.metricRow}>
            <span className={styles.metricLabel}>
              {h.hour === 0
                ? '12a'
                : h.hour < 12
                  ? `${h.hour}a`
                  : h.hour === 12
                    ? '12p'
                    : `${h.hour - 12}p`}
            </span>
            <div className={styles.metricBarTrack}>
              <div
                className={styles.metricBarFill}
                style={{
                  width: `${(h.sessions / maxS) * 100}%`,
                  background: completionColor(h.completion_rate),
                  opacity: 'var(--opacity-bar-fill)',
                }}
              />
            </div>
            <span className={styles.metricValue}>
              {h.completion_rate}% · {h.sessions}
            </span>
          </div>
        ))}
    </div>
  );
}

export const trendWidgets: WidgetRegistry = {
  'session-trend': SessionTrendWidget,
  'edit-velocity': EditVelocityWidget,
  'prompt-efficiency': PromptEfficiencyWidget,
  'hourly-effectiveness': HourlyEffectivenessWidget,
};
