import type { CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { workTypeColor } from '../utils.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import shared from '../widget-shared.module.css';
import styles from './OutcomeWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import {
  GhostStatRow,
  InlineDelta,
  StatWidget,
  CoverageNote,
  capabilityCoverageNote,
} from './shared.js';

function OutcomesWidget({ analytics }: WidgetBodyProps) {
  // Completion-rate delta is the headline movement for this widget, paired
  // here with the "finished" legend row so the enriched-stat-card pattern
  // (inline delta next to the number) extends to the outcome-bar surface.
  const pc = analytics.period_comparison;
  const prevRate = pc.previous?.completion_rate;
  const currRate = pc.current.completion_rate;
  const completionDelta = prevRate != null && prevRate > 0 ? currRate - prevRate : null;
  return <OutcomeBar cs={analytics.completion_summary} completionDelta={completionDelta} />;
}

function OutcomeBar({
  cs,
  completionDelta,
}: {
  cs: UserAnalytics['completion_summary'];
  completionDelta: number | null;
}) {
  if (cs.total_sessions === 0) {
    return <SectionEmpty>No sessions yet</SectionEmpty>;
  }
  const items = [
    { key: 'completed', count: cs.completed, color: 'var(--success)', label: 'finished' },
    { key: 'abandoned', count: cs.abandoned, color: 'var(--warn)', label: 'abandoned' },
    { key: 'failed', count: cs.failed, color: 'var(--danger)', label: 'failed' },
    { key: 'unknown', count: cs.unknown, color: 'var(--ghost)', label: 'unknown' },
  ].filter((i) => i.count > 0);

  return (
    <>
      <div className={styles.outcomeBar}>
        {items.map((i) => (
          <div
            key={i.key}
            className={styles.outcomeSegment}
            style={{
              width: `${(i.count / cs.total_sessions) * 100}%`,
              background: i.color,
              opacity: i.key === 'unknown' ? 1 : 'var(--opacity-bar-fill)',
            }}
          />
        ))}
      </div>
      <div className={styles.outcomeLegend}>
        {items.map((i) => (
          <div key={i.key} className={styles.outcomeItem}>
            <span className={styles.outcomeDot} style={{ background: i.color }} />
            <span className={styles.outcomeValue}>
              {i.count}
              {i.key === 'completed' && completionDelta != null && (
                <InlineDelta value={completionDelta} />
              )}
            </span>
            <span className={styles.outcomeLabel}>{i.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function StucknessWidget({ analytics }: WidgetBodyProps) {
  const s = analytics.stuckness;
  // Stable 3-block layout: empty state ghosts all three labels so the grid
  // width doesn't jump when the first stuck session lands and the third
  // block appears. Populated state renders the same three blocks, with an
  // em-dash in the "stuck completed" slot when no stuck sessions exist
  // (division-by-zero would otherwise surface as 0% and read as "no
  // recovery," not "no stuck sessions yet").
  if (s.total_sessions === 0) {
    return <GhostStatRow labels={['stuck rate', 'stuck sessions', 'stuck completed']} />;
  }
  const pc = analytics.period_comparison;
  const prevStuck = pc.previous?.stuckness_rate;
  const stuckDelta = prevStuck != null && prevStuck > 0 ? s.stuckness_rate - prevStuck : null;
  return (
    <div className={shared.statRow}>
      <div className={shared.statBlock}>
        <span className={shared.statBlockValue}>
          {s.stuckness_rate}%{stuckDelta != null && <InlineDelta value={stuckDelta} invert />}
        </span>
        <span className={shared.statBlockLabel}>stuck rate</span>
      </div>
      <div className={shared.statBlock}>
        <span className={shared.statBlockValue}>{s.stuck_sessions}</span>
        <span className={shared.statBlockLabel}>stuck sessions</span>
      </div>
      <div className={shared.statBlock}>
        <span className={shared.statBlockValue}>
          {s.stuck_sessions > 0 ? `${s.stuck_completion_rate}%` : '—'}
        </span>
        <span className={shared.statBlockLabel}>stuck completed</span>
      </div>
    </div>
  );
}

function WorkTypeOutcomesWidget({ analytics }: WidgetBodyProps) {
  const wto = analytics.work_type_outcomes;
  // Work type is inferred from files_touched — a session with no files
  // cannot be classified. Disclose the scope inline so "completion rate
  // by work type" isn't read as "completion rate across all sessions."
  const scopeNote = 'Sessions that touched at least one file';
  if (wto.length === 0) {
    return (
      <>
        <SectionEmpty>Appears after sessions touch files</SectionEmpty>
        <CoverageNote text={scopeNote} />
      </>
    );
  }
  return (
    <>
      <div className={shared.metricBars}>
        {wto.map((w, i) => (
          <div
            key={w.work_type}
            className={shared.metricRow}
            style={{ '--row-index': i } as CSSProperties}
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
      <CoverageNote text={scopeNote} />
    </>
  );
}

function OneShotRateWidget({ analytics }: WidgetBodyProps) {
  const s = analytics.tool_call_stats;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note =
    s.one_shot_sessions > 0
      ? `Computed from ${s.one_shot_sessions} sessions with tool call data`
      : capabilityCoverageNote(tools, 'toolCallLogs');
  const value = s.one_shot_sessions === 0 ? '--' : `${s.one_shot_rate}%`;
  return (
    <>
      <StatWidget value={value} />
      <CoverageNote text={note} />
    </>
  );
}

export const outcomeWidgets: WidgetRegistry = {
  outcomes: OutcomesWidget,
  'one-shot-rate': OneShotRateWidget,
  stuckness: StucknessWidget,
  'work-type-outcomes': WorkTypeOutcomesWidget,
};
