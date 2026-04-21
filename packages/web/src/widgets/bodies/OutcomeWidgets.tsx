import type { CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { workTypeColor } from '../utils.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import shared from '../widget-shared.module.css';
import styles from './OutcomeWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import {
  GhostBars,
  GhostStatRow,
  StatWidget,
  CoverageNote,
  capabilityCoverageNote,
} from './shared.js';

function OutcomesWidget({ analytics }: WidgetBodyProps) {
  return <OutcomeBar cs={analytics.completion_summary} />;
}

function OutcomeBar({ cs }: { cs: UserAnalytics['completion_summary'] }) {
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
      <div
        className={styles.outcomeLegend}
        style={{ flexDirection: 'column', gap: 8, marginTop: 12 }}
      >
        {items.map((i) => (
          <div key={i.key} className={styles.outcomeItem}>
            <span className={styles.outcomeDot} style={{ background: i.color }} />
            <span className={styles.outcomeValue}>{i.count}</span>
            <span className={styles.outcomeLabel}>{i.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function StucknessWidget({ analytics }: WidgetBodyProps) {
  const s = analytics.stuckness;
  if (s.total_sessions === 0) return <GhostStatRow labels={['stuck rate', 'stuck sessions']} />;
  const pc = analytics.period_comparison;
  const prevStuck = pc.previous?.stuckness_rate;
  const stuckDelta =
    prevStuck != null && prevStuck > 0
      ? (() => {
          const d = s.stuckness_rate - prevStuck;
          const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
          const color = d === 0 ? 'var(--muted)' : d < 0 ? 'var(--success)' : 'var(--danger)';
          return (
            <span className={shared.statInlineDelta} style={{ color }}>
              {arrow}
              {Math.abs(Math.round(d * 10) / 10)}
            </span>
          );
        })()
      : null;
  return (
    <div className={shared.statRow}>
      <div className={shared.statBlock}>
        <span className={shared.statBlockValue}>
          {s.stuckness_rate}%{stuckDelta}
        </span>
        <span className={shared.statBlockLabel}>stuck rate</span>
      </div>
      <div className={shared.statBlock}>
        <span className={shared.statBlockValue}>{s.stuck_sessions}</span>
        <span className={shared.statBlockLabel}>stuck sessions</span>
      </div>
      {s.stuck_sessions > 0 && (
        <div className={shared.statBlock}>
          <span className={shared.statBlockValue}>{s.stuck_completion_rate}%</span>
          <span className={shared.statBlockLabel}>stuck completed</span>
        </div>
      )}
    </div>
  );
}

function WorkTypeOutcomesWidget({ analytics }: WidgetBodyProps) {
  const wto = analytics.work_type_outcomes;
  if (wto.length === 0) return <GhostBars count={4} />;
  return (
    <div className={shared.metricBars}>
      {wto.map((w) => (
        <div key={w.work_type} className={shared.metricRow}>
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

function ToolOutcomesWidget({ analytics }: WidgetBodyProps) {
  const to = analytics.tool_outcomes;
  if (to.length === 0) return <GhostBars count={3} />;
  const byTool = new Map<string, { completed: number; abandoned: number; failed: number }>();
  for (const t of to) {
    const entry = byTool.get(t.host_tool) || { completed: 0, abandoned: 0, failed: 0 };
    if (t.outcome === 'completed') entry.completed = t.count;
    else if (t.outcome === 'abandoned') entry.abandoned = t.count;
    else if (t.outcome === 'failed') entry.failed = t.count;
    byTool.set(t.host_tool, entry);
  }
  const tools = [...byTool.entries()]
    .map(([tool, counts]) => ({
      tool,
      ...counts,
      total: counts.completed + counts.abandoned + counts.failed,
    }))
    .sort((a, b) => b.total - a.total);
  const maxT = Math.max(...tools.map((t) => t.total), 1);
  return (
    <div className={shared.metricBars}>
      {tools.map((t) => (
        <div key={t.tool} className={shared.metricRow}>
          <span className={shared.metricLabel}>{getToolMeta(t.tool).label}</span>
          <div className={shared.metricBarTrack}>
            <div
              className={shared.metricBarFill}
              style={{
                width: `${(t.completed / maxT) * 100}%`,
                background: 'var(--success)',
                opacity: 'var(--opacity-bar-fill)',
              }}
            />
            <div
              className={shared.metricBarFill}
              style={{
                width: `${(t.abandoned / maxT) * 100}%`,
                background: 'var(--warn)',
                opacity: 'var(--opacity-bar-fill)',
              }}
            />
            <div
              className={shared.metricBarFill}
              style={{
                width: `${(t.failed / maxT) * 100}%`,
                background: 'var(--danger)',
                opacity: 'var(--opacity-bar-fill)',
              }}
            />
          </div>
          <span className={shared.metricValue}>
            {t.completed}/{t.abandoned}/{t.failed}
          </span>
        </div>
      ))}
    </div>
  );
}

function ConflictImpactWidget({ analytics }: WidgetBodyProps) {
  const cc = analytics.conflict_correlation;
  if (cc.length === 0) return <GhostStatRow labels={['with conflicts', 'without']} />;
  return (
    <div className={shared.statRow}>
      {cc.map((c) => (
        <div key={c.bucket} className={shared.statBlock}>
          <span className={shared.statBlockValue}>{c.completion_rate}%</span>
          <span className={shared.statBlockLabel}>
            {c.bucket} ({c.sessions})
          </span>
        </div>
      ))}
    </div>
  );
}

function ConflictsBlockedWidget({ analytics }: WidgetBodyProps) {
  const cs = analytics.conflict_stats;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'hooks');
  if (cs.blocked_period === 0 && cs.found_period === 0) {
    return (
      <>
        <GhostStatRow labels={['blocked', 'detected']} />
        <CoverageNote text={note} />
      </>
    );
  }
  return (
    <>
      <div className={shared.statRow}>
        <div className={shared.statBlock}>
          <span className={shared.statBlockValue}>{cs.blocked_period}</span>
          <span className={shared.statBlockLabel}>blocked</span>
        </div>
        <div className={shared.statBlock}>
          <span className={shared.statBlockValue}>{cs.found_period}</span>
          <span className={shared.statBlockLabel}>detected</span>
        </div>
      </div>
      <CoverageNote text={note} />
    </>
  );
}

function RetryPatternsWidget({ analytics }: WidgetBodyProps) {
  const rp = analytics.retry_patterns;
  if (rp.length === 0) return <SectionEmpty>No retry patterns</SectionEmpty>;
  return (
    <div className={shared.dataList}>
      {rp.slice(0, 10).map((r, i) => (
        <div
          key={`${r.handle}-${r.file}`}
          className={shared.dataRow}
          style={{ '--row-index': i } as CSSProperties}
        >
          <span className={shared.dataName} title={r.file}>
            {r.file.split('/').slice(-2).join('/')}
          </span>
          <div className={shared.dataMeta}>
            <span className={shared.dataStat}>
              <span className={shared.dataStatValue}>{r.attempts}</span> attempts
            </span>
            <span
              className={shared.dataStat}
              style={{ color: r.resolved ? 'var(--success)' : 'var(--danger)' }}
            >
              {r.resolved ? 'resolved' : r.final_outcome}
            </span>
          </div>
        </div>
      ))}
    </div>
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
  'tool-outcomes': ToolOutcomesWidget,
  'conflict-impact': ConflictImpactWidget,
  'conflicts-blocked': ConflictsBlockedWidget,
  'retry-patterns': RetryPatternsWidget,
};
