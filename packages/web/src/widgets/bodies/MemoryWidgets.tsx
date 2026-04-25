import { useState, type CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import FlowRow from '../../components/viz/flow/FlowRow.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import styles from '../widget-shared.module.css';
import memoryStyles from './MemoryWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { CoverageNote } from './shared.js';

// Memory category was contracted in the 2026-04-25 audit (4 cuts: memory-
// activity, memory-health, memory-safety, top-memories) and re-expanded the
// same day with widgets that anchor multi-question detail views per the
// rubric's Widget ↔ Detail-View Disposition. Each widget below documents
// the 4-5 English questions its detail view will answer (when built). All
// new widgets are catalog-only at the catalog default sizes.

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

// memory-cross-tool-flow: pairs of (author_tool, consumer_tool) where the
// consumer tool ran sessions in the period that COULD have read memories
// authored by author_tool. Honest framing: this measures co-presence and
// available-memory volume, NOT exact read attribution. Per ANALYTICS_SPEC
// §10, the per-memory `memory_search_results` join table is unbuilt —
// without it, the renderer says "available to N sessions of," not "read
// by N sessions of."
function MemoryCrossToolFlowWidget({ analytics }: WidgetBodyProps) {
  const flow = analytics.cross_tool_memory_flow;
  if (flow.length === 0) {
    return (
      <>
        <SectionEmpty>
          Cross-tool flow appears once two or more tools have memories and active sessions.
        </SectionEmpty>
        <CoverageNote text="Memory available to other-tool sessions — not exact read attribution." />
      </>
    );
  }
  const visible = flow.slice(0, 8);
  const hidden = flow.length - visible.length;
  // Twin-bar shared scales: per-pair share against the strongest pair, so
  // a reader compares strengths without an axis. Memories drives the
  // primary signal (the connector arrow's opacity scales with it); the
  // sessions-reachable secondary stays muted-tone --soft.
  const maxMemories = Math.max(...visible.map((f) => f.memories), 1);
  const maxSessions = Math.max(...visible.map((f) => f.consumer_sessions), 1);
  return (
    <>
      <div className={styles.dataList}>
        {visible.map((f, i) => {
          const author = getToolMeta(f.author_tool);
          const consumer = getToolMeta(f.consumer_tool);
          return (
            <FlowRow
              key={`${f.author_tool}-${f.consumer_tool}`}
              index={i}
              from={{ id: author.id, label: author.label, color: author.color }}
              to={{ id: consumer.id, label: consumer.label, color: consumer.color }}
              bars={[
                {
                  label: 'memories',
                  value: f.memories,
                  max: maxMemories,
                  color: 'var(--accent)',
                  display: String(f.memories),
                },
                {
                  label: 'sessions',
                  value: f.consumer_sessions,
                  max: maxSessions,
                  color: 'var(--soft)',
                  display: String(f.consumer_sessions),
                },
              ]}
            />
          );
        })}
      </div>
      {hidden > 0 && <div className={styles.moreHidden}>+{hidden} more pairs</div>}
      <CoverageNote text="Available-to, not read-by. Exact attribution requires memory-search-result tracking." />
    </>
  );
}

// memory-aging-curve: composition of currently-live memories by age bucket.
// Lifetime scope (catalog timeScope='all-time'); picker doesn't apply.
const AGE_COLORS: Record<string, string> = {
  '0-7d': 'var(--success)',
  '8-30d': 'var(--soft)',
  '31-90d': 'var(--warn)',
  '90d+': 'var(--ghost)',
};

function MemoryAgingCurveWidget({ analytics }: WidgetBodyProps) {
  const a = analytics.memory_aging;
  const total = a.recent_7d + a.recent_30d + a.recent_90d + a.older;
  if (total === 0) {
    return <SectionEmpty>Aging curve appears after the team saves memories.</SectionEmpty>;
  }
  const buckets = [
    { key: '0-7d', label: '0-7 days', count: a.recent_7d },
    { key: '8-30d', label: '8-30 days', count: a.recent_30d },
    { key: '31-90d', label: '31-90 days', count: a.recent_90d },
    { key: '90d+', label: '90+ days', count: a.older },
  ];
  // Hero "fresh share" — the 0-7d + 8-30d buckets as a percent of all
  // currently-live memories. Renders above the proportional bar so the
  // headline answer reads in 1s without summing legend rows.
  const freshPct = Math.round(((a.recent_7d + a.recent_30d) / total) * 100);
  return (
    <>
      <div className={memoryStyles.agingHero}>
        <span className={memoryStyles.agingHeroValue}>{freshPct}%</span>
        <span className={memoryStyles.agingHeroSuffix}>under 30d</span>
      </div>
      <div className={styles.workBar}>
        {buckets.map((b) => {
          const pct = (b.count / total) * 100;
          return pct < 1 ? null : (
            <div
              key={b.key}
              className={styles.workSegment}
              style={{ width: `${pct}%`, background: AGE_COLORS[b.key] }}
              title={`${b.label}: ${Math.round(pct)}% (${b.count})`}
            />
          );
        })}
      </div>
      <div className={styles.workLegend}>
        {buckets.map((b, i) => {
          const pct = Math.round((b.count / total) * 100);
          return pct < 1 ? null : (
            <div
              key={b.key}
              className={styles.workLegendItem}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.workDot} style={{ background: AGE_COLORS[b.key] }} />
              <span className={styles.workLegendLabel}>{b.label}</span>
              <span className={styles.workLegendValue}>
                {pct}% · {b.count}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// memory-categories: top agent-assigned categories on currently-live
// memories. Coverage depends on agent adoption of the category-aware save
// pattern; the empty state names the gate.
const TOP_CATEGORIES_VISIBLE = 8;

function MemoryCategoriesWidget({ analytics }: WidgetBodyProps) {
  const [nowMs] = useState(() => Date.now());
  const cats = analytics.memory_categories;
  if (cats.length === 0) {
    return (
      <SectionEmpty>
        Categories appear when agents tag memories on save (`chinmeister_save_memory` with
        categories).
      </SectionEmpty>
    );
  }
  const visible = cats.slice(0, TOP_CATEGORIES_VISIBLE);
  const hidden = cats.length - visible.length;
  const maxCount = Math.max(...visible.map((c) => c.count), 1);
  return (
    <>
      <div className={styles.metricBars}>
        {visible.map((c, i) => {
          const daysAgo = c.last_used_at
            ? Math.max(0, Math.floor((nowMs - new Date(c.last_used_at).getTime()) / 86_400_000))
            : null;
          return (
            <div
              key={c.category}
              className={styles.metricRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.metricLabel}>{c.category}</span>
              <div className={styles.metricBarTrack}>
                <div
                  className={styles.metricBarFill}
                  style={{
                    width: `${(c.count / maxCount) * 100}%`,
                    opacity: 'var(--opacity-bar-fill)',
                  }}
                />
              </div>
              <span className={styles.metricValue}>
                {c.count}
                {daysAgo != null ? ` · ${daysAgo === 0 ? 'today' : `${daysAgo}d ago`}` : ''}
              </span>
            </div>
          );
        })}
      </div>
      {hidden > 0 && <div className={styles.moreHidden}>+{hidden} more categories</div>}
    </>
  );
}

// top-memories revived 2026-04-25. Cut-then-reinstated when the rubric bar
// shifted from "passes the rubric in isolation" to "anchors a multi-question
// detail view." The widget answers "what does the team rely on" — most-read
// shared memories with last-touch hint. Click drills to memory detail (when
// MemoryDetailView ships) for the underlying questions: most-read, never-
// read, heaviest categories, work-type dependencies, composition shifts.
const TOP_MEMORIES_VISIBLE = 8;

function TopMemoriesWidget({ analytics }: WidgetBodyProps) {
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

// memory-health revived 2026-04-25 (post 18-month re-audit). Three lifetime
// stats: total live memories, average age, stale count. Renders the steady-
// state shape of the team's living memory. Catalog-only with timeScope='all-
// time' so the picker doesn't apply. Detail-view questions: total live vs
// invalidated trend, formation-observation rate, hygiene-action backlog,
// per-category live count, last-touched age distribution.
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

// memory-bus-factor (handle-blind directory variant). Per directory, share
// of memories with single-author concentration. Surface is directory-axis,
// never names handles. Detail questions: which directories carry single-
// author memory, period delta, second-author resilience trend, concentrated
// dirs by traffic, team-wide authorship spread.
const SINGLE_AUTHOR_VISIBLE = 8;

function MemoryBusFactorWidget({ analytics }: WidgetBodyProps) {
  const dirs = analytics.memory_single_author_directories;
  if (dirs.length === 0) {
    return (
      <SectionEmpty>
        Single-author directories appear when 2+ authors have saved memories and at least one
        directory has only one of them contributing.
      </SectionEmpty>
    );
  }
  const visible = dirs.slice(0, SINGLE_AUTHOR_VISIBLE);
  const hidden = dirs.length - visible.length;
  // Three-column row: directory / warn-tinted single-author share bar /
  // `n/m` numeric. Tracks the file-friction visual family (severity bar +
  // dimmed meta) without adopting FileFrictionRow directly because the
  // meta carries two values (`n/m`) rather than the single-string blob
  // FileFrictionRow's API expects. Inline keeps the row honest about the
  // dual-value meta and avoids forcing an awkward stringification.
  return (
    <>
      <div className={styles.dataList}>
        {visible.map((d, i) => {
          const share = d.total_count > 0 ? d.single_author_count / d.total_count : 0;
          return (
            <div
              key={d.directory}
              className={memoryStyles.busRow}
              style={{ '--row-index': i } as CSSProperties}
              title={d.directory}
            >
              <span className={memoryStyles.busLabel}>{d.directory}</span>
              <div className={memoryStyles.busBarTrack}>
                <div
                  className={memoryStyles.busBarFill}
                  style={{ width: `${Math.min(100, share * 100)}%` }}
                />
              </div>
              <span className={memoryStyles.busMeta}>
                <span className={memoryStyles.busMetaValue}>{d.single_author_count}</span>
                <span>/{d.total_count}</span>
              </span>
            </div>
          );
        })}
      </div>
      {hidden > 0 && <div className={styles.moreHidden}>+{hidden} more directories</div>}
    </>
  );
}

// memory-supersession-flow: live counters for the consolidation pipeline.
// Latent infrastructure for Memory Hygiene Autopilot — quiet today, load-
// bearing once consolidation runs on cadence. Detail questions: retired vs
// merged this period, queue depth + age, categories with most supersession,
// merge clustering by directory, median memory lifespan.
function MemorySupersessionFlowWidget({ analytics }: WidgetBodyProps) {
  const s = analytics.memory_supersession;
  const hasAny = s.invalidated_period > 0 || s.merged_period > 0 || s.pending_proposals > 0;
  if (!hasAny) {
    return (
      <SectionEmpty>
        Supersession activity appears when consolidation runs. Memory Hygiene runs on cadence in
        active teams.
      </SectionEmpty>
    );
  }
  return (
    <div className={styles.statRow}>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{s.invalidated_period}</span>
        <span className={styles.statBlockLabel}>invalidated</span>
      </div>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{s.merged_period}</span>
        <span className={styles.statBlockLabel}>merged</span>
      </div>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{s.pending_proposals}</span>
        <span className={styles.statBlockLabel}>pending review</span>
      </div>
    </div>
  );
}

// memory-secrets-shield: secret writes blocked by the prompt-injection /
// secret-detection layer. Quiet most of the time today; latent security
// posture signal as memory volume grows. Substrate-unique (only chinmeister
// sees cross-tool memory writes). Detail questions: leaks attempted, which
// tools tried, trend, patterns caught most, false-positive cost.
function MemorySecretsShieldWidget({ analytics }: WidgetBodyProps) {
  const s = analytics.memory_secrets_shield;
  // Always render both stat blocks, even when 0, so the corner seat never
  // reads as "broken empty" and the row stays balanced. Tone is warn when
  // n>0 and idle (ink) when 0. Idle subline appears only when both windows
  // are 0, signalling "shield on, no traffic." Substrate-unique D1 (only
  // chinmeister sees cross-tool memory writes); the value of the seat is
  // permanent, the day-to-day signal is usually quiet.
  const idle = s.blocked_period === 0 && s.blocked_24h === 0;
  const periodClass =
    s.blocked_period > 0 ? memoryStyles.shieldValueWarn : memoryStyles.shieldValueIdle;
  const recentClass =
    s.blocked_24h > 0 ? memoryStyles.shieldValueWarn : memoryStyles.shieldValueIdle;
  return (
    <>
      <div className={styles.statRow}>
        <div className={styles.statBlock}>
          <span className={`${styles.statBlockValue} ${periodClass}`}>{s.blocked_period}</span>
          <span className={styles.statBlockLabel}>blocked this period</span>
        </div>
        <div className={styles.statBlock}>
          <span className={`${styles.statBlockValue} ${recentClass}`}>{s.blocked_24h}</span>
          <span className={styles.statBlockLabel}>last 24h</span>
        </div>
      </div>
      {idle && <div className={memoryStyles.shieldSubline}>shield on, working as designed</div>}
    </>
  );
}

export const memoryWidgets: WidgetRegistry = {
  'memory-outcomes': MemoryOutcomesWidget,
  'memory-cross-tool-flow': MemoryCrossToolFlowWidget,
  'memory-aging-curve': MemoryAgingCurveWidget,
  'memory-categories': MemoryCategoriesWidget,
  'top-memories': TopMemoriesWidget,
  'memory-health': MemoryHealthWidget,
  'memory-bus-factor': MemoryBusFactorWidget,
  'memory-supersession-flow': MemorySupersessionFlowWidget,
  'memory-secrets-shield': MemorySecretsShieldWidget,
};
