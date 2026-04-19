import { useState, type CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import styles from '../widget-shared.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { GhostBars, GhostStatRow } from './shared.js';

// Period-scoped: everything in here responds to the global date picker.
function MemoryActivityWidget({ analytics }: WidgetBodyProps) {
  const m = analytics.memory_usage;
  if (m.searches === 0 && m.memories_created_period === 0)
    return <GhostStatRow labels={['searches', 'hit rate', 'created']} />;
  return (
    <div className={styles.statRow}>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{m.searches}</span>
        <span className={styles.statBlockLabel}>searches</span>
      </div>
      {m.search_hit_rate > 0 && (
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{m.search_hit_rate}%</span>
          <span className={styles.statBlockLabel}>hit rate</span>
        </div>
      )}
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{m.memories_created_period}</span>
        <span className={styles.statBlockLabel}>created</span>
      </div>
    </div>
  );
}

// All-time: none of these respond to the date picker. Widget renders the
// 'all-time' scope tag in its header (see WidgetRenderer).
//
// Surfaces the four lifetime + live signals plus three period-scoped
// substrate signals from the memory pipeline:
//   memories  — live count (excludes soft-merged)
//   avg age   — over live memories only
//   stale     — last_accessed > 30d, live only
//   reviews   — live consolidation proposals awaiting decision
//   flagged   — formation observations recommending merge/evolve/discard
//   blocked   — secret-detector blocks this period
//   merged    — lifetime soft-merge total (audit signal)
function MemoryHealthWidget({ analytics }: WidgetBodyProps) {
  const m = analytics.memory_usage;
  if (m.total_memories === 0 && m.merged_memories === 0)
    return <GhostStatRow labels={['memories', 'avg age', 'stale']} />;
  const formation = m.formation_observations_by_recommendation;
  const flagged = formation
    ? (formation.merge ?? 0) + (formation.evolve ?? 0) + (formation.discard ?? 0)
    : 0;
  return (
    <div className={styles.statRow}>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{m.total_memories}</span>
        <span className={styles.statBlockLabel}>memories</span>
      </div>
      {m.avg_memory_age_days > 0 && (
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{Math.round(m.avg_memory_age_days)}d</span>
          <span className={styles.statBlockLabel}>avg age</span>
        </div>
      )}
      {m.stale_memories > 0 && (
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{m.stale_memories}</span>
          <span className={styles.statBlockLabel}>stale</span>
        </div>
      )}
      {m.pending_consolidation_proposals > 0 && (
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{m.pending_consolidation_proposals}</span>
          <span className={styles.statBlockLabel}>reviews</span>
        </div>
      )}
      {flagged > 0 && (
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{flagged}</span>
          <span className={styles.statBlockLabel}>flagged</span>
        </div>
      )}
      {m.secrets_blocked_period > 0 && (
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{m.secrets_blocked_period}</span>
          <span className={styles.statBlockLabel}>blocked</span>
        </div>
      )}
      {m.merged_memories > 0 && (
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{m.merged_memories}</span>
          <span className={styles.statBlockLabel}>merged</span>
        </div>
      )}
    </div>
  );
}

function MemoryOutcomesWidget({ analytics }: WidgetBodyProps) {
  const moc = analytics.memory_outcome_correlation;
  if (moc.length === 0) return <GhostBars count={2} />;
  return (
    <div className={styles.metricBars}>
      {moc.map((m) => (
        <div key={m.bucket} className={styles.metricRow}>
          <span className={styles.metricLabel}>{m.bucket}</span>
          <div className={styles.metricBarTrack}>
            <div
              className={styles.metricBarFill}
              style={{
                width: `${m.completion_rate}%`,
                background: 'var(--success)',
                opacity: 'var(--opacity-bar-fill)',
              }}
            />
          </div>
          <span className={styles.metricValue}>
            {m.completion_rate}% · {m.sessions}
          </span>
        </div>
      ))}
    </div>
  );
}

// Period-scoped: shows what the formation auditor flagged in the current
// date window. The four recommendation buckets (keep / merge / evolve /
// discard) come from analytics.memory_usage; no extra fetch needed.
//
// 'keep' is the trivial case (most writes), so it's shown as the muted
// baseline. The non-keep buckets are the actionable signal — those are
// the writes a reviewer should look at via chinwag_review_formation_
// observations or the (eventually) interactive feed widget.
function FormationSummaryWidget({ analytics }: WidgetBodyProps) {
  const f = analytics.memory_usage.formation_observations_by_recommendation;
  const total = (f?.keep ?? 0) + (f?.merge ?? 0) + (f?.evolve ?? 0) + (f?.discard ?? 0);
  if (!f || total === 0) {
    return (
      <SectionEmpty>
        Run formation sweep to populate. Auditor classifies new memories as keep / merge / evolve /
        discard.
      </SectionEmpty>
    );
  }
  const buckets: Array<{ label: string; value: number; color: string }> = [
    { label: 'keep', value: f.keep ?? 0, color: 'var(--text-muted)' },
    { label: 'merge', value: f.merge ?? 0, color: 'var(--accent)' },
    { label: 'evolve', value: f.evolve ?? 0, color: 'var(--warning)' },
    { label: 'discard', value: f.discard ?? 0, color: 'var(--danger)' },
  ];
  return (
    <div className={styles.metricBars}>
      {buckets.map((b) => (
        <div key={b.label} className={styles.metricRow}>
          <span className={styles.metricLabel}>{b.label}</span>
          <div className={styles.metricBarTrack}>
            <div
              className={styles.metricBarFill}
              style={{
                width: `${total > 0 ? (b.value / total) * 100 : 0}%`,
                background: b.color,
                opacity: 'var(--opacity-bar-fill)',
              }}
            />
          </div>
          <span className={styles.metricValue}>{b.value}</span>
        </div>
      ))}
    </div>
  );
}

function TopMemoriesWidget({ analytics }: WidgetBodyProps) {
  // Captured at mount so relative-time math in render stays pure. Accepted
  // staleness: a long-mounted dashboard may show "Xd ago" lagging by a day
  // until next remount.
  const [nowMs] = useState(() => Date.now());
  const tm = analytics.top_memories;
  if (tm.length === 0) return <SectionEmpty>No memories accessed</SectionEmpty>;
  return (
    <div className={styles.dataList}>
      {tm.slice(0, 8).map((m, i) => {
        const daysAgo = m.last_accessed_at
          ? Math.max(0, Math.floor((nowMs - new Date(m.last_accessed_at).getTime()) / 86_400_000))
          : null;
        return (
          <div key={m.id} className={styles.dataRow} style={{ '--row-index': i } as CSSProperties}>
            <span className={styles.dataName} style={{ fontSize: 'var(--text-2xs)' }}>
              {m.text_preview}
            </span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{m.access_count}</span> hits
              </span>
              {daysAgo !== null && (
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>
                    {daysAgo === 0 ? 'today' : `${daysAgo}d`}
                  </span>
                  {daysAgo > 0 ? ' ago' : ''}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const memoryWidgets: WidgetRegistry = {
  'memory-activity': MemoryActivityWidget,
  'memory-health': MemoryHealthWidget,
  'memory-outcomes': MemoryOutcomesWidget,
  'top-memories': TopMemoriesWidget,
  'formation-summary': FormationSummaryWidget,
};
