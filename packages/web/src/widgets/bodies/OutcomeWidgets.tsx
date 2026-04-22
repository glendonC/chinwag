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

// Audit 2026-04-21: Wire unused `completed` into the label so each bucket shows
// its sample size ("27 of 60 · with conflicts") rather than just the percent —
// prevents misreading a small-sample 100% as validated. The correlation caveat
// is surfaced inline because this widget is the first place users encounter the
// conflicts-hurt-completion framing, and the honest story is "correlated, not
// cause" — per REPORTS.md rule 3. Empty-state gates on whether the user has any
// team at all; a solo user sees the explicit "requires 2+ agents" copy instead
// of ghosts, since collisions require parallel sessions by definition.
function ConflictImpactWidget({ analytics }: WidgetBodyProps) {
  const cc = analytics.conflict_correlation;
  const isSolo = analytics.member_analytics.length <= 1;
  if (cc.length === 0) {
    return (
      <>
        <GhostStatRow labels={['with conflicts', 'without']} />
        <CoverageNote
          text={
            isSolo
              ? 'Requires 2+ agents — collisions only surface between parallel sessions.'
              : 'No sessions in this window.'
          }
        />
      </>
    );
  }
  return (
    <>
      <div className={shared.statRow}>
        {cc.map((c) => (
          <div key={c.bucket} className={shared.statBlock}>
            <span className={shared.statBlockValue}>{c.completion_rate}%</span>
            <span className={shared.statBlockLabel}>
              {c.completed} of {c.sessions} · {c.bucket}
            </span>
          </div>
        ))}
      </div>
      <CoverageNote text="Correlated with outcomes — complex sessions also collide more." />
    </>
  );
}

// Audit 2026-04-21: When empty AND solo, the capability note ("Hook-driven data
// from …") is the wrong answer — the user's question is "why zero," and the
// honest answer is "you're alone," not "your tool lacks hooks." Prefer the solo
// note in that case. Populated state keeps the capability attribution as-is
// because partial hook coverage does affect the number's interpretation.
function ConflictsBlockedWidget({ analytics }: WidgetBodyProps) {
  const cs = analytics.conflict_stats;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const isSolo = analytics.member_analytics.length <= 1;
  const empty = cs.blocked_period === 0 && cs.found_period === 0;
  const note =
    empty && isSolo
      ? 'Requires 2+ agents — collisions only detectable between parallel sessions.'
      : capabilityCoverageNote(tools, 'hooks');
  if (empty) {
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

// Audit 2026-04-21: Post-regroup render. New shape is file-keyed (one row per
// file, attempts summed across agents) so a single noisy agent can no longer
// dominate the top-10. The agents + tools columns surface the substrate-unique
// angle — "this file hurts multiple people using multiple tools" is a claim
// only chinwag can make. Path truncation adapts to disambiguation: if two
// visible rows share a basename (e.g., two `Button.tsx`), show up to four
// trailing segments so they aren't visually identical; otherwise keep last
// two for compactness. A muted "+N more" line surfaces when the SQL returns
// more than ten patterns, so users know the list is truncated.
function RetryPatternsWidget({ analytics }: WidgetBodyProps) {
  const rp = analytics.retry_patterns;
  if (rp.length === 0) return <SectionEmpty>No retry patterns</SectionEmpty>;

  const visible = rp.slice(0, 10);
  const basenameCount = new Map<string, number>();
  for (const r of visible) {
    const base = r.file.split('/').pop() || r.file;
    basenameCount.set(base, (basenameCount.get(base) ?? 0) + 1);
  }
  const displayPath = (file: string) => {
    const parts = file.split('/');
    const base = parts[parts.length - 1] ?? file;
    const collides = (basenameCount.get(base) ?? 0) > 1;
    const segments = collides ? Math.min(parts.length, 4) : Math.min(parts.length, 2);
    return parts.slice(-segments).join('/');
  };
  const hidden = Math.max(0, rp.length - visible.length);

  return (
    <>
      <div className={shared.dataList}>
        {visible.map((r, i) => (
          <div
            key={r.file}
            className={shared.dataRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={shared.dataName} title={r.file}>
              {displayPath(r.file)}
            </span>
            <div className={shared.dataMeta}>
              <span className={shared.dataStat}>
                <span className={shared.dataStatValue}>{r.attempts}</span> attempts
              </span>
              {r.agents > 1 && (
                <span className={shared.dataStat}>
                  <span className={shared.dataStatValue}>{r.agents}</span> agents
                </span>
              )}
              {r.tools.length > 1 && (
                <span className={shared.dataStat}>
                  <span className={shared.dataStatValue}>{r.tools.length}</span> tools
                </span>
              )}
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
      {hidden > 0 && (
        <CoverageNote
          text={`+${hidden} more file${hidden === 1 ? '' : 's'} with retry patterns.`}
        />
      )}
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
  'conflict-impact': ConflictImpactWidget,
  'conflicts-blocked': ConflictsBlockedWidget,
  'retry-patterns': RetryPatternsWidget,
};
