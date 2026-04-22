import { useState, type CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import styles from '../widget-shared.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { CoverageNote } from './shared.js';

// Period-scoped: everything in here responds to the global date picker.
function MemoryActivityWidget({ analytics }: WidgetBodyProps) {
  const m = analytics.memory_usage;
  if (m.searches === 0 && m.memories_created_period === 0)
    return <SectionEmpty>No memory searches this period.</SectionEmpty>;
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
// Kept lean on purpose: three blocks for lifetime memory health. The
// protection-signal counters (consolidation queue, auditor flags, secret
// blocks, soft-merges) are in the sibling MemorySafetyWidget — separating
// health from safety keeps each widget readable at 6-col width and avoids
// the 7-block density problem the 04-19 audit flagged.
function MemoryHealthWidget({ analytics }: WidgetBodyProps) {
  const m = analytics.memory_usage;
  if (m.total_memories === 0) return <SectionEmpty>No memories saved yet.</SectionEmpty>;
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
    </div>
  );
}

// Live review queue for the memory pipeline. Three signals, all live:
//   review queue    — consolidation proposals awaiting decision
//   auditor-flagged — unaddressed formation observations (merge/evolve/discard)
//   secrets caught  — secret-detector blocks in the last 24h
// The widget has a single time scope (live) so the empty state is virtuous
// ("nothing needs review") like live-conflicts, not accusatory.
function MemorySafetyWidget({ analytics }: WidgetBodyProps) {
  const m = analytics.memory_usage;
  const formation = m.formation_observations_by_recommendation;
  const flagged = formation
    ? (formation.merge ?? 0) + (formation.evolve ?? 0) + (formation.discard ?? 0)
    : 0;
  const hasAny = m.pending_consolidation_proposals > 0 || flagged > 0 || m.secrets_blocked_24h > 0;
  if (!hasAny) return <SectionEmpty>Nothing needs review.</SectionEmpty>;
  return (
    <div className={styles.statRow}>
      {m.pending_consolidation_proposals > 0 && (
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{m.pending_consolidation_proposals}</span>
          <span className={styles.statBlockLabel}>review queue</span>
        </div>
      )}
      {flagged > 0 && (
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{flagged}</span>
          <span className={styles.statBlockLabel}>auditor-flagged</span>
        </div>
      )}
      {m.secrets_blocked_24h > 0 && (
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{m.secrets_blocked_24h}</span>
          <span className={styles.statBlockLabel}>secrets caught</span>
        </div>
      )}
    </div>
  );
}

// Sample-size gate. Below this, the 3-bucket split collapses visually (a
// single-bucket bar chart fails rubric C1), and completion_rate percentages
// off < 10 sessions are noise. Above, the correlation is load-bearing.
const MEMORY_OUTCOMES_MIN_SESSIONS = 10;

function MemoryOutcomesWidget({ analytics }: WidgetBodyProps) {
  const moc = analytics.memory_outcome_correlation;
  const totalSessions = moc.reduce((sum, m) => sum + m.sessions, 0);
  if (totalSessions === 0) return <SectionEmpty>No sessions this period.</SectionEmpty>;
  if (totalSessions < MEMORY_OUTCOMES_MIN_SESSIONS)
    return (
      <SectionEmpty>
        Need {MEMORY_OUTCOMES_MIN_SESSIONS}+ sessions for a reliable correlation.
      </SectionEmpty>
    );
  return (
    <>
      <div className={styles.metricBars}>
        {moc.map((m, i) => (
          <div
            key={m.bucket}
            className={styles.metricRow}
            style={{ '--row-index': i } as CSSProperties}
          >
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
      <CoverageNote text="Correlated with outcomes — sessions that remember may also differ in scope." />
    </>
  );
}

// How many top-memories rows render inline before the "+N more" affordance
// truncates. Above this, rows compete for vertical space at the default 6×3
// widget size; below, the list reads as sparse. SQL returns up to 20.
const TOP_MEMORIES_VISIBLE = 8;

function TopMemoriesWidget({ analytics }: WidgetBodyProps) {
  // Captured at mount so relative-time math in render stays pure. Accepted
  // staleness: a long-mounted dashboard may show "Xd ago" lagging by a day
  // until next remount.
  const [nowMs] = useState(() => Date.now());
  const tm = analytics.top_memories;
  if (tm.length === 0) return <SectionEmpty>No memories accessed.</SectionEmpty>;
  const visible = tm.slice(0, TOP_MEMORIES_VISIBLE);
  const hidden = tm.length - visible.length;
  return (
    <>
      <div className={styles.dataList}>
        {visible.map((m, i) => {
          const daysAgo = m.last_accessed_at
            ? Math.max(0, Math.floor((nowMs - new Date(m.last_accessed_at).getTime()) / 86_400_000))
            : null;
          return (
            <div
              key={m.id}
              className={styles.dataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
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
      {hidden > 0 && <div className={styles.moreHidden}>+{hidden} more</div>}
    </>
  );
}

export const memoryWidgets: WidgetRegistry = {
  'memory-activity': MemoryActivityWidget,
  'memory-health': MemoryHealthWidget,
  'memory-safety': MemorySafetyWidget,
  'memory-outcomes': MemoryOutcomesWidget,
  'top-memories': TopMemoriesWidget,
};
