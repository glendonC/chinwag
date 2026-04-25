import { useMemo, useState, type CSSProperties } from 'react';
import {
  DetailView,
  FocusedDetailView,
  Metric,
  ScopeChip,
  getCrossLinks,
  type DetailTabDef,
  type FocusedQuestion,
  type ScopeKind,
} from '../../components/DetailView/index.js';
import {
  BreakdownList,
  BreakdownMeta,
  DirectoryColumns,
  DotMatrix,
  FlowRow,
  HeroStatRow,
  TrueShareBars,
  type DirectoryColumnsFile,
  type HeroStatDef,
  type TrueShareEntry,
} from '../../components/viz/index.js';
import RangePills from '../../components/RangePills/RangePills.jsx';
import { useTabs } from '../../hooks/useTabs.js';
import { setQueryParam, useQueryParam } from '../../lib/router.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import { RANGES, formatScope, type RangeDays } from './overview-utils.js';
import { MISSING_DELTA } from './detailDelta.js';
import styles from './MemoryDetailView.module.css';

/* MemoryDetailView — substrate-axis on living team memory.
 *
 * Densest detail view in the catalog (5 tabs). Memory mixes three time
 * scopes on one surface — health/freshness/authorship are all-time,
 * cross-tool is period-scoped, hygiene is live — so each tab's panel
 * renders an explicit <ScopeChip> beside its summary so readers know
 * which clock the numbers below answer to. Other detail views are
 * period-only and omit the chip.
 *
 *   health     — total live memories, search→completion correlation,
 *                secrets shield, top-read memories (absorbed from the
 *                cut top-memories widget seat)
 *   freshness  — aging composition, accumulating-vs-replacing read
 *   cross-tool — author→consumer tool flow, category mix (catalog-only)
 *   authorship — single-author directory concentration (DirectoryColumns
 *                in two-color mode), category mix (gated)
 *   hygiene    — supersession counters, category leaderboard (autopilot-
 *                gated; honest empty until consolidation runs on cadence)
 *
 * Most tab deltas are MISSING_DELTA (em-dash) by design — only `period`
 * scope responds to the picker, and even there the schema lacks a
 * previous-period comparator for cross-tool flow today. Spec calls out
 * the asymmetry explicitly; the chip carries the explanation. */

const MEMORY_TABS = ['health', 'freshness', 'cross-tool', 'authorship', 'hygiene'] as const;
type MemoryTab = (typeof MEMORY_TABS)[number];

function isMemoryTab(value: string | null | undefined): value is MemoryTab {
  return (MEMORY_TABS as readonly string[]).includes(value ?? '');
}

interface Props {
  analytics: UserAnalytics;
  initialTab?: string | null;
  onBack: () => void;
  rangeDays: RangeDays;
  onRangeChange: (next: RangeDays) => void;
}

const MEMORY_OUTCOMES_MIN_SESSIONS = 10;

function fmtCount(n: number): string {
  return n.toLocaleString();
}

function freshShareUnder30d(a: UserAnalytics['memory_aging']): number {
  const total = a.recent_7d + a.recent_30d + a.recent_90d + a.older;
  if (total <= 0) return 0;
  return Math.round(((a.recent_7d + a.recent_30d) / total) * 100);
}

export default function MemoryDetailView({
  analytics,
  initialTab,
  onBack,
  rangeDays,
  onRangeChange,
}: Props) {
  const resolved: MemoryTab = isMemoryTab(initialTab) ? initialTab : 'health';
  const tabControl = useTabs(MEMORY_TABS, resolved);
  const { activeTab } = tabControl;

  const m = analytics.memory_usage;
  const aging = analytics.memory_aging;
  const flow = analytics.cross_tool_memory_flow;
  const dirs = analytics.memory_single_author_directories;
  const sup = analytics.memory_supersession;

  const distinctPairs = useMemo(() => {
    const set = new Set<string>();
    for (const f of flow) {
      if (f.memories > 0) set.add(`${f.author_tool}|${f.consumer_tool}`);
    }
    return set.size;
  }, [flow]);

  const tabs: Array<DetailTabDef<MemoryTab>> = [
    {
      id: 'health',
      label: 'Health',
      value: m.total_memories > 0 ? fmtCount(m.total_memories) : '--',
      delta: { ...MISSING_DELTA },
    },
    {
      id: 'freshness',
      label: 'Freshness',
      value:
        aging.recent_7d + aging.recent_30d + aging.recent_90d + aging.older > 0
          ? `${freshShareUnder30d(aging)}%`
          : '--',
      delta: { ...MISSING_DELTA },
    },
    {
      id: 'cross-tool',
      label: 'Cross-tool',
      value: distinctPairs > 0 ? fmtCount(distinctPairs) : '--',
      delta: { ...MISSING_DELTA },
    },
    {
      id: 'authorship',
      label: 'Authorship',
      value: dirs.length > 0 ? fmtCount(dirs.length) : '--',
      delta: { ...MISSING_DELTA },
    },
    {
      id: 'hygiene',
      label: 'Hygiene',
      value: sup.pending_proposals > 0 ? fmtCount(sup.pending_proposals) : '--',
      delta: { ...MISSING_DELTA },
    },
  ];

  const scopeSubtitle = useMemo(() => {
    const activeTools = analytics.tool_comparison.filter((t) => t.sessions > 0).length;
    return (
      formatScope([
        { count: activeTools, singular: 'tool' },
        { count: analytics.teams_included, singular: 'project' },
      ]) || undefined
    );
  }, [analytics]);

  return (
    <DetailView
      backLabel="Overview"
      onBack={onBack}
      title="memory"
      subtitle={scopeSubtitle}
      actions={<RangePills value={rangeDays} onChange={onRangeChange} options={RANGES} />}
      tabs={tabs}
      tabControl={tabControl}
      idPrefix="memory"
      tablistLabel="Memory sections"
    >
      {activeTab === 'health' && <HealthPanel analytics={analytics} />}
      {activeTab === 'freshness' && <FreshnessPanel analytics={analytics} />}
      {activeTab === 'cross-tool' && <CrossToolPanel analytics={analytics} />}
      {activeTab === 'authorship' && <AuthorshipPanel analytics={analytics} />}
      {activeTab === 'hygiene' && <HygienePanel analytics={analytics} />}
    </DetailView>
  );
}

// ── Scope row ───────────────────────────────────────
// Small lozenge that pins the active tab's time-scope above its
// FocusedDetailView. Memory is the only detail view that mixes scopes
// (live + period + all-time on one picker), so the chip is required
// reading at the top of every tab. The label carries the tab name so
// the reader can also confirm the question lens at a glance.

function ScopeRow({ scope, label }: { scope: ScopeKind; label: string }) {
  return (
    <div className={styles.scopeRow}>
      <ScopeChip scope={scope} />
      <span className={styles.scopeLabel}>{label}</span>
    </div>
  );
}

// ── Health panel (all-time scope) ───────────────────
//
// Three-question cluster. Hero is the live count + age + stale tri-stat;
// the outcomes question carries the search→completion correlation gated
// at MEMORY_OUTCOMES_MIN_SESSIONS; the secrets-shield question always
// renders one number even when zero so the panel never reads as broken.
// The optional fourth slot ("top-read memories") absorbs the cut
// top-memories widget seat — rendered only when the field has data.

function HealthPanel({ analytics }: { analytics: UserAnalytics }) {
  const activeId = useQueryParam('q');
  // Lazy-init now reference for relative-day formatting on top-read
  // memories. Capturing once at first render keeps re-renders pure
  // (react-hooks/purity rule) and the value stays stable across the
  // panel's lifetime so the same memory doesn't tick second-by-second.
  const [nowMs] = useState(() => Date.now());
  const m = analytics.memory_usage;
  const moc = analytics.memory_outcome_correlation;
  const ss = analytics.memory_secrets_shield;
  const tm = analytics.top_memories;

  // Stale share for the DotMatrix reference next to the steady-state hero.
  const stalePct = m.total_memories > 0 ? (m.stale_memories / m.total_memories) * 100 : 0;
  const staleTone = stalePct >= 30 ? 'warning' : 'neutral';

  if (m.total_memories === 0) {
    return (
      <div className={styles.panel}>
        <ScopeRow scope="all-time" label="health · all-time" />
        <span className={styles.empty}>
          No memories saved yet. They appear when agents call `chinmeister_save_memory`.
        </span>
      </div>
    );
  }

  // ── Q1 live ── HeroStatRow with three blocks. Stale share gets a
  // DotMatrix sibling on the third block so the reader sees both the
  // raw count and its proportion at the same altitude.
  const stats: HeroStatDef[] = [
    {
      key: 'live',
      value: fmtCount(m.total_memories),
      label: 'live memories',
    },
    {
      key: 'age',
      value: m.avg_memory_age_days > 0 ? String(Math.round(m.avg_memory_age_days)) : '0',
      unit: 'd',
      label: 'avg age',
    },
    {
      key: 'stale',
      value: fmtCount(m.stale_memories),
      label: 'stale (>90d)',
      sublabel: `${Math.round(stalePct)}% of live`,
      color: staleTone === 'warning' ? 'var(--warn)' : undefined,
      viz:
        m.stale_memories > 0 ? (
          <DotMatrix
            total={m.total_memories}
            filled={m.stale_memories}
            color={staleTone === 'warning' ? 'var(--warn)' : 'var(--soft)'}
          />
        ) : undefined,
    },
  ];

  const liveAnswer = (
    <>
      <Metric>{fmtCount(m.total_memories)}</Metric> live memories, averaging{' '}
      <Metric>{Math.round(m.avg_memory_age_days)}d</Metric> old
      {m.stale_memories > 0 && (
        <>
          ; <Metric tone={staleTone}>{fmtCount(m.stale_memories)}</Metric> over 90 days
        </>
      )}
      .
    </>
  );

  // ── Q2 outcomes ── per spec, search→completion across three buckets.
  // Coverage note carries the memory_search_results blocker. Gated under
  // MEMORY_OUTCOMES_MIN_SESSIONS in aggregate; per-memory attribution is
  // honestly named as pending.
  const totalOutcomeSessions = moc.reduce((s, b) => s + b.sessions, 0);
  const outcomesEntries: TrueShareEntry[] = moc.map((b) => ({
    key: b.bucket,
    label: b.bucket,
    value: b.sessions,
    color: completionColorRate(b.completion_rate),
    meta: <>{b.completion_rate}% complete</>,
  }));
  const searchedHit = moc.find((b) => /searched.*results/i.test(b.bucket));
  const noSearch = moc.find((b) => /no-search|without/i.test(b.bucket));
  const outcomesAnswer =
    searchedHit && noSearch && totalOutcomeSessions >= MEMORY_OUTCOMES_MIN_SESSIONS ? (
      <>
        <Metric tone="positive">{searchedHit.completion_rate}%</Metric> completion when memory was
        searched, vs <Metric>{noSearch.completion_rate}%</Metric> when it wasn&apos;t.
      </>
    ) : null;

  // ── Q3 secrets ── always renders one number per spec. Tone neutral
  // when zero, warning when n>0 (the day it fires, you want it loud).
  const secretsAnswer =
    ss.blocked_period === 0 && ss.blocked_24h === 0 ? (
      <>
        <Metric>0</Metric> blocked this period. The shield is on.
      </>
    ) : (
      <>
        <Metric tone="warning">{fmtCount(ss.blocked_period)}</Metric> blocked this period
        {ss.blocked_24h > 0 && (
          <>
            , <Metric>{fmtCount(ss.blocked_24h)}</Metric> in the last 24 hours
          </>
        )}
        .
      </>
    );

  const questions: FocusedQuestion[] = [
    {
      id: 'live',
      question: "How big is the team's living memory?",
      answer: liveAnswer,
      children: <HeroStatRow stats={stats} />,
    },
  ];

  if (outcomesAnswer) {
    questions.push({
      id: 'outcomes',
      question: 'Do sessions that read memory finish more often?',
      answer: outcomesAnswer,
      children: (
        <>
          <TrueShareBars entries={outcomesEntries} formatValue={(n) => `${fmtCount(n)} sessions`} />
          <p className={styles.coverageNote}>
            Available-vs-read attribution. Per-memory drill requires `memory_search_results`
            (pending).
          </p>
        </>
      ),
      relatedLinks: getCrossLinks('memory', 'health', 'outcomes'),
    });
  } else {
    questions.push({
      id: 'outcomes',
      question: 'Do sessions that read memory finish more often?',
      answer: (
        <>
          Need <Metric>{MEMORY_OUTCOMES_MIN_SESSIONS}+</Metric> sessions for a reliable correlation.
        </>
      ),
      children: (
        <>
          <span className={styles.empty}>
            Need {MEMORY_OUTCOMES_MIN_SESSIONS}+ sessions for a reliable correlation. Per-memory
            attribution requires `memory_search_results` (pending).
          </span>
        </>
      ),
      relatedLinks: getCrossLinks('memory', 'health', 'outcomes'),
    });
  }

  questions.push({
    id: 'secrets',
    question: 'Has the shield blocked anything?',
    answer: secretsAnswer,
    children: (
      <div className={styles.statRow}>
        <div className={styles.statBlock}>
          <span
            className={styles.statBlockValue}
            style={ss.blocked_period > 0 ? ({ color: 'var(--warn)' } as CSSProperties) : undefined}
          >
            {fmtCount(ss.blocked_period)}
          </span>
          <span className={styles.statBlockLabel}>blocked this period</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{fmtCount(ss.blocked_24h)}</span>
          <span className={styles.statBlockLabel}>last 24h</span>
        </div>
      </div>
    ),
  });

  // Optional Q4 — top-memories absorbed from the cut widget seat.
  // Renders only when the field has data; otherwise the slot quietly
  // disappears so the tab doesn't grow a permanent empty row.
  if (tm.length > 0) {
    const topRead = [...tm].sort((a, b) => b.access_count - a.access_count).slice(0, 8);
    const maxAccess = Math.max(...topRead.map((t) => t.access_count), 1);
    const leader = topRead[0];
    questions.push({
      id: 'top-read',
      question: 'Which memories does the team rely on most?',
      answer:
        leader != null ? (
          <>
            Top-read memory was searched <Metric>{fmtCount(leader.access_count)}</Metric>{' '}
            {leader.access_count === 1 ? 'time' : 'times'} this period.
          </>
        ) : (
          <>No memories accessed yet.</>
        ),
      children: (
        <BreakdownList
          items={topRead.map((t) => ({
            key: t.id,
            label: <span className={styles.memoryPreview}>{t.text_preview}</span>,
            fillPct: (t.access_count / maxAccess) * 100,
            value: (
              <>
                {fmtCount(t.access_count)} hits
                {t.last_accessed_at && (
                  <BreakdownMeta>
                    {' · last '}
                    {relativeDays(t.last_accessed_at, nowMs)}
                  </BreakdownMeta>
                )}
              </>
            ),
          }))}
        />
      ),
    });
  }

  return (
    <div className={styles.panel}>
      <ScopeRow scope="all-time" label="health · all-time" />
      <FocusedDetailView
        questions={questions}
        activeId={activeId}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </div>
  );
}

// ── Freshness panel (all-time scope) ────────────────
//
// Aging composition, presented as a proportional bar with a hero share
// inline above it (per Phase 3 widget rework spec — readable at 1s),
// followed by an accumulating-vs-replacing read across the four buckets.
// Both questions live in the all-time scope; the picker doesn't apply.

const AGE_COLORS: Record<string, string> = {
  '0-7d': 'var(--success)',
  '8-30d': 'var(--soft)',
  '31-90d': 'var(--warn)',
  '90d+': 'var(--ghost)',
};

function FreshnessPanel({ analytics }: { analytics: UserAnalytics }) {
  const activeId = useQueryParam('q');
  const a = analytics.memory_aging;
  const total = a.recent_7d + a.recent_30d + a.recent_90d + a.older;

  if (total === 0) {
    return (
      <div className={styles.panel}>
        <ScopeRow scope="all-time" label="freshness · all-time" />
        <span className={styles.empty}>Aging curve appears after the team saves memories.</span>
      </div>
    );
  }

  const buckets: Array<{ key: string; label: string; count: number }> = [
    { key: '0-7d', label: '0-7 days', count: a.recent_7d },
    { key: '8-30d', label: '8-30 days', count: a.recent_30d },
    { key: '31-90d', label: '31-90 days', count: a.recent_90d },
    { key: '90d+', label: '90+ days', count: a.older },
  ];

  const under30Pct = Math.round(((a.recent_7d + a.recent_30d) / total) * 100);
  const over90Pct = Math.round((a.older / total) * 100);

  const mixAnswer = (
    <>
      <Metric tone={under30Pct >= 50 ? 'positive' : 'warning'}>{under30Pct}%</Metric> of live
      memories are under 30 days old;{' '}
      <Metric tone={over90Pct >= 30 ? 'warning' : 'neutral'}>{over90Pct}%</Metric> are over 90.
    </>
  );

  // ── Q2 accumulation ── derived sentence comparing 0-7d vs 90d+.
  // The viz is a 4-segment vertical strip with explicit count labels,
  // not a bar chart — readers should see "is the front weighted or the
  // back?" without summing legend rows.
  const fresh = a.recent_7d;
  const old = a.older;
  let accumSentence: string;
  let accumTone: 'positive' | 'warning' | 'neutral';
  if (fresh + old < 4) {
    accumSentence = 'Need at least a few populated buckets to read the trend.';
    accumTone = 'neutral';
  } else if (fresh > old * 1.5) {
    accumSentence = 'Newer memories are outpacing old ones — replacement working.';
    accumTone = 'positive';
  } else if (old > fresh * 1.5) {
    accumSentence = 'Old memories dominate; pruning lags.';
    accumTone = 'warning';
  } else {
    accumSentence = 'New and old roughly balanced — accumulation, not replacement.';
    accumTone = 'neutral';
  }
  const accumAnswer = <Metric tone={accumTone}>{accumSentence}</Metric>;

  const questions: FocusedQuestion[] = [
    {
      id: 'mix',
      question: "How fresh is the team's living memory?",
      answer: mixAnswer,
      children: (
        <div className={styles.agingFrame}>
          <div className={styles.agingHero}>
            <span className={styles.agingHeroValue}>{under30Pct}</span>
            <span className={styles.agingHeroUnit}>%</span>
            <span className={styles.agingHeroLabel}>under 30 days</span>
          </div>
          <div className={styles.agingBar}>
            {buckets.map((b) => {
              const pct = (b.count / total) * 100;
              if (pct < 1) return null;
              return (
                <div
                  key={b.key}
                  className={styles.agingSegment}
                  style={{
                    width: `${pct}%`,
                    background: AGE_COLORS[b.key],
                  }}
                  title={`${b.label}: ${Math.round(pct)}% (${b.count})`}
                />
              );
            })}
          </div>
          <div className={styles.agingLegend}>
            {buckets.map((b, i) => {
              const pct = total > 0 ? Math.round((b.count / total) * 100) : 0;
              return (
                <div
                  key={b.key}
                  className={styles.agingLegendRow}
                  style={{ '--row-index': i } as CSSProperties}
                >
                  <span className={styles.agingDot} style={{ background: AGE_COLORS[b.key] }} />
                  <span className={styles.agingLegendLabel}>{b.label}</span>
                  <span className={styles.agingLegendValue}>
                    {pct}% · {fmtCount(b.count)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ),
    },
    {
      id: 'accumulation',
      question: 'Are we replacing or accumulating?',
      answer: accumAnswer,
      children: (
        <div className={styles.accumStrip}>
          {buckets.map((b, i) => {
            const pct = (b.count / total) * 100;
            return (
              <div
                key={b.key}
                className={styles.accumColumn}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span className={styles.accumValue}>{fmtCount(b.count)}</span>
                <div
                  className={styles.accumBar}
                  style={{
                    height: `${Math.max(4, pct)}%`,
                    background: AGE_COLORS[b.key],
                  }}
                  title={`${b.label}: ${b.count}`}
                />
                <span className={styles.accumLabel}>{b.label}</span>
              </div>
            );
          })}
        </div>
      ),
    },
  ];

  return (
    <div className={styles.panel}>
      <ScopeRow scope="all-time" label="freshness · all-time" />
      <FocusedDetailView
        questions={questions}
        activeId={activeId}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </div>
  );
}

// ── Cross-tool panel (period scope) ─────────────────
//
// Author→consumer flow with twin micro-bars (memories written, sessions
// reachable). Bar 1 max is the max memories across pairs; bar 2 max is
// the max consumer_sessions — heterogeneous scales let the eye compare
// strengths within each axis without one number dwarfing the other.
//
// Q2 (categories) lives in the panel as catalog copy with an honest
// empty state — the cross_tool × category cut isn't in the schema today.

function CrossToolPanel({ analytics }: { analytics: UserAnalytics }) {
  const activeId = useQueryParam('q');
  const flow = analytics.cross_tool_memory_flow;

  if (flow.length === 0) {
    return (
      <div className={styles.panel}>
        <ScopeRow scope="period" label="cross-tool · period" />
        <span className={styles.empty}>
          Cross-tool flow appears once two tools have memories AND active sessions in this window.
        </span>
      </div>
    );
  }

  const sortedFlow = [...flow].sort((a, b) => b.memories - a.memories);
  const visible = sortedFlow.slice(0, 8);
  const maxMemories = Math.max(...visible.map((f) => f.memories), 1);
  const maxSessions = Math.max(...visible.map((f) => f.consumer_sessions), 1);

  const top = visible[0];
  const flowAnswer = top ? (
    <>
      <Metric>{getToolMeta(top.author_tool).label}</Metric> writes the most memories that{' '}
      <Metric>{getToolMeta(top.consumer_tool).label}</Metric> sessions can read —{' '}
      <Metric>{fmtCount(top.memories)}</Metric> available across{' '}
      <Metric>{fmtCount(top.consumer_sessions)}</Metric> sessions.
    </>
  ) : null;

  const questions: FocusedQuestion[] = [
    {
      id: 'flow',
      question: 'Which tools share knowledge?',
      answer: flowAnswer ?? <>No author→consumer pairs in this window.</>,
      children: (
        <>
          <div className={styles.flowList}>
            {visible.map((f, i) => {
              const fromMeta = getToolMeta(f.author_tool);
              const toMeta = getToolMeta(f.consumer_tool);
              return (
                <FlowRow
                  key={`${f.author_tool}|${f.consumer_tool}`}
                  index={i}
                  from={{ id: f.author_tool, label: fromMeta.label, color: fromMeta.color }}
                  to={{ id: f.consumer_tool, label: toMeta.label, color: toMeta.color }}
                  bars={[
                    {
                      label: 'memories',
                      value: f.memories,
                      max: maxMemories,
                      color: fromMeta.color,
                      display: fmtCount(f.memories),
                    },
                    {
                      label: 'reachable sessions',
                      value: f.consumer_sessions,
                      max: maxSessions,
                      display: fmtCount(f.consumer_sessions),
                    },
                  ]}
                />
              );
            })}
          </div>
          <p className={styles.coverageNote}>
            Available-to, not read-by. Exact attribution requires per-memory search-result tracking
            (pending).
          </p>
        </>
      ),
      relatedLinks: getCrossLinks('memory', 'cross-tool', 'flow'),
    },
    {
      id: 'categories',
      question: 'Which categories cross tools?',
      answer: (
        <>Cross-tool category breakdown ships once the worker emits category arrays on flow rows.</>
      ),
      children: (
        <span className={styles.empty}>
          Needs a `cross_tool × category` cut on `cross_tool_memory_flow`. Today the join collapses
          category to the per-tool axis — see the categories question on the Hygiene tab for the
          live category mix.
        </span>
      ),
    },
  ];

  return (
    <div className={styles.panel}>
      <ScopeRow scope="period" label="cross-tool · period" />
      <FocusedDetailView
        questions={questions}
        activeId={activeId}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </div>
  );
}

// ── Authorship panel (all-time scope) ───────────────
//
// DirectoryColumns in two-color mode. The primitive expects a per-FILE
// shape (file path + touch_count + primary_share); Memory's payload is
// per-DIRECTORY (single_author_count / total_count). The adapter below
// fabricates one synthetic "file" per directory, weighted by total_count,
// so the column-height encoding still reads correctly. The directory
// path lands as both `file` and the primitive's grouping key.

function AuthorshipPanel({ analytics }: { analytics: UserAnalytics }) {
  const activeId = useQueryParam('q');
  const dirs = analytics.memory_single_author_directories;

  if (dirs.length === 0) {
    return (
      <div className={styles.panel}>
        <ScopeRow scope="all-time" label="authorship · all-time" />
        <span className={styles.empty}>
          Single-author directories appear when 2+ authors have saved memories and at least one
          directory has only one of them contributing.
        </span>
      </div>
    );
  }

  // Adapter: per-directory rows → per-file shape DirectoryColumns expects.
  // The primitive groups by directory key (depth=2 by default), so we
  // pass the directory path verbatim as `file` and let the primitive
  // collapse it to itself. touch_count carries total memories in the
  // directory; primary_share carries the touch-weighted single-author
  // fraction.
  const columnFiles: DirectoryColumnsFile[] = dirs
    .filter((d) => d.total_count > 0)
    .map((d) => ({
      file: d.directory,
      touch_count: d.total_count,
      primary_share: d.total_count > 0 ? d.single_author_count / d.total_count : 0,
    }));

  const sortedDirs = [...dirs].sort((a, b) => {
    const aShare = a.total_count > 0 ? a.single_author_count / a.total_count : 0;
    const bShare = b.total_count > 0 ? b.single_author_count / b.total_count : 0;
    return bShare - aShare;
  });
  const top = sortedDirs[0];
  const topPct =
    top && top.total_count > 0 ? Math.round((top.single_author_count / top.total_count) * 100) : 0;

  const concentrationAnswer = top ? (
    <>
      <Metric>{top.directory}</Metric> has{' '}
      <Metric tone={topPct >= 70 ? 'warning' : 'neutral'}>{topPct}%</Metric> single-author memories
      — <Metric>{fmtCount(top.single_author_count)}</Metric> of{' '}
      <Metric>{fmtCount(top.total_count)}</Metric>.
    </>
  ) : null;

  const questions: FocusedQuestion[] = [
    {
      id: 'concentration',
      question: 'Where does memory cluster on one author?',
      answer: concentrationAnswer ?? <>No single-author directories yet.</>,
      children: (
        <DirectoryColumns
          files={columnFiles}
          mode="two-color"
          depth={6}
          height={240}
          twoColorLabels={{ primary: 'Single-author share', other: 'Other authors' }}
        />
      ),
      relatedLinks: getCrossLinks('memory', 'authorship', 'concentration'),
    },
    {
      id: 'categories-mix',
      question: 'What kind of knowledge is concentrated?',
      answer: <>Category breakdown by directory ships when 2+ authors are present per dir.</>,
      children: (
        <span className={styles.empty}>
          Needs a per-directory category cut. Catalog-only today — surfaces in detail when the
          backend emits `memory_single_author_directories` with category arrays.
        </span>
      ),
    },
  ];

  return (
    <div className={styles.panel}>
      <ScopeRow scope="all-time" label="authorship · all-time" />
      <FocusedDetailView
        questions={questions}
        activeId={activeId}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </div>
  );
}

// ── Hygiene panel (live scope) ──────────────────────
//
// Quiet today by design — the panel exists as latent infrastructure for
// Memory Hygiene Autopilot. Empty states explain the cadence honestly
// rather than hiding the panel; once consolidation runs, the same shape
// fills in without any ceremony.

function HygienePanel({ analytics }: { analytics: UserAnalytics }) {
  const activeId = useQueryParam('q');
  const s = analytics.memory_supersession;
  const cats = analytics.memory_categories;

  const hasFlow = s.invalidated_period > 0 || s.merged_period > 0 || s.pending_proposals > 0;

  const flowAnswer = hasFlow ? (
    <>
      <Metric>{fmtCount(s.invalidated_period)}</Metric> invalidated,{' '}
      <Metric>{fmtCount(s.merged_period)}</Metric> merged,{' '}
      <Metric tone={s.pending_proposals > 0 ? 'warning' : 'neutral'}>
        {fmtCount(s.pending_proposals)}
      </Metric>{' '}
      waiting for review.
    </>
  ) : (
    <>Memory Hygiene Autopilot runs consolidation when it ships.</>
  );

  const questions: FocusedQuestion[] = [
    {
      id: 'flow',
      question: "What's moving through consolidation?",
      answer: flowAnswer,
      children: hasFlow ? (
        <div className={styles.statRow}>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{fmtCount(s.invalidated_period)}</span>
            <span className={styles.statBlockLabel}>invalidated</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{fmtCount(s.merged_period)}</span>
            <span className={styles.statBlockLabel}>merged</span>
          </div>
          <div className={styles.statBlock}>
            <span
              className={styles.statBlockValue}
              style={
                s.pending_proposals > 0 ? ({ color: 'var(--warn)' } as CSSProperties) : undefined
              }
            >
              {fmtCount(s.pending_proposals)}
            </span>
            <span className={styles.statBlockLabel}>pending review</span>
          </div>
        </div>
      ) : (
        <span className={styles.empty}>
          Memory Hygiene Autopilot runs consolidation when it ships. Pre-launch teams see manual
          proposals only.
        </span>
      ),
    },
    {
      id: 'categories',
      question: 'Which categories supersede most?',
      answer:
        cats.length > 0 ? (
          <>
            <Metric>{cats[0].category}</Metric> leads by volume; supersession-by-category unlocks
            once consolidation runs on cadence.
          </>
        ) : (
          <>Category supersession leaderboard ships with Memory Hygiene Autopilot.</>
        ),
      children: (
        <span className={styles.empty}>
          Counters move when consolidation runs. Catalog-only until autopilot lands.
        </span>
      ),
    },
  ];

  return (
    <div className={styles.panel}>
      <ScopeRow scope="live" label="hygiene · live" />
      <FocusedDetailView
        questions={questions}
        activeId={activeId}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────

// Completion-rate color cutoffs match the rest of the detail surface
// (70 / 40). Local copy because pulling in widgets/utils.ts for one
// helper would over-couple the detail view to the widget layer.
function completionColorRate(rate: number): string {
  if (rate >= 70) return 'var(--success)';
  if (rate >= 40) return 'var(--warn)';
  return 'var(--danger)';
}

function relativeDays(iso: string, nowMs: number): string {
  const days = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return 'today';
  return `${days}d ago`;
}
