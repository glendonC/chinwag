import type { CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { Sparkline } from '../charts.js';
import { completionColor } from '../utils.js';
import styles from '../widget-shared.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { CoverageNote, GhostSparkline, capabilityCoverageNote } from './shared.js';

function SessionTrendWidget({ analytics }: WidgetBodyProps) {
  const data = analytics.daily_trends.map((d) => d.sessions);
  if (data.length < 2) return <GhostSparkline />;
  return <Sparkline data={data} height={80} />;
}

function OutcomeTrendWidget({ analytics }: WidgetBodyProps) {
  // Completion rate per day, in percent. Days with no sessions are skipped
  // so a zero-session day doesn't drag the line to 0 and swamp the signal.
  const points = analytics.daily_trends
    .filter((d) => d.sessions > 0)
    .map((d) => {
      const completed = d.completed ?? 0;
      return Math.round((completed / d.sessions) * 1000) / 10;
    });
  // A flat GhostSparkline under the title "completion rate trend" reads as
  // "completion rate is zero and flat." PromptEfficiency swapped the ghost
  // for a named empty state for the same reason — match that pattern here
  // rather than let the ghost line tell a false story.
  if (points.length < 2) {
    return <SectionEmpty>Appears once sessions run on 2+ different days</SectionEmpty>;
  }
  return <Sparkline data={points} height={80} />;
}

function EditVelocityWidget({ analytics }: WidgetBodyProps) {
  const data = analytics.edit_velocity.map((d) => d.edits_per_hour);
  if (data.length < 2) return <GhostSparkline />;
  return <Sparkline data={data} height={80} />;
}

function PromptEfficiencyWidget({ analytics }: WidgetBodyProps) {
  const pe = analytics.prompt_efficiency;
  // avg_turns_per_edit is nullable by contract: the worker emits null
  // for dead days (no conversation + edit activity) and the cross-team
  // projector does the same when every team is silent on a day. Keep
  // real zeros if they ever appear (a user who edits without messaging).
  const data = pe.map((d) => d.avg_turns_per_edit).filter((v): v is number => v != null);
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'conversationLogs');
  if (data.length < 2) {
    // A flat ghost sparkline reads as "efficiency is perfectly constant"
    // per the D3a rule — never render a ghost line that implies the
    // system is working while the user has nothing.
    return (
      <>
        <SectionEmpty>Trend fills in after a few sessions with conversation capture</SectionEmpty>
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
  if (he.length === 0) {
    return <SectionEmpty>Hourly pattern appears after a few completed sessions</SectionEmpty>;
  }
  const activeHours = he.filter((h) => h.sessions > 0);
  const visibleHours = activeHours.slice(0, 12);
  const hiddenCount = activeHours.length - visibleHours.length;
  const maxS = Math.max(...visibleHours.map((h) => h.sessions), 1);
  return (
    <>
      <div className={styles.metricBars}>
        {visibleHours.map((h, i) => (
          <div
            key={h.hour}
            className={styles.metricRow}
            style={{ '--row-index': i } as CSSProperties}
          >
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
      {hiddenCount > 0 && (
        <CoverageNote text={`Top 12 of ${activeHours.length} active hours shown`} />
      )}
    </>
  );
}

export const trendWidgets: WidgetRegistry = {
  'session-trend': SessionTrendWidget,
  'edit-velocity': EditVelocityWidget,
  'outcome-trend': OutcomeTrendWidget,
  'prompt-efficiency': PromptEfficiencyWidget,
  'hourly-effectiveness': HourlyEffectivenessWidget,
};
