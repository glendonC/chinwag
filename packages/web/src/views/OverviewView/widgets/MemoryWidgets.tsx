import { useState, type CSSProperties } from 'react';
import SectionEmpty from '../../../components/SectionEmpty/SectionEmpty.js';
import styles from '../OverviewView.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { GhostBars, GhostStatRow } from './shared.js';

function MemoryStatsWidget({ analytics }: WidgetBodyProps) {
  const m = analytics.memory_usage;
  if (m.total_memories === 0 && m.searches === 0)
    return <GhostStatRow labels={['memories', 'searches', 'created']} />;
  return (
    <div className={styles.statRow}>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{m.total_memories}</span>
        <span className={styles.statBlockLabel}>memories</span>
      </div>
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
      {m.stale_memories > 0 && (
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{m.stale_memories}</span>
          <span className={styles.statBlockLabel}>stale</span>
        </div>
      )}
      {m.avg_memory_age_days > 0 && (
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{Math.round(m.avg_memory_age_days)}d</span>
          <span className={styles.statBlockLabel}>avg age</span>
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
                opacity: 0.6,
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
  'memory-stats': MemoryStatsWidget,
  'memory-outcomes': MemoryOutcomesWidget,
  'top-memories': TopMemoriesWidget,
};
