import { useMemo, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import {
  BreakdownList,
  BreakdownMeta,
  DetailView,
  DirectoryConstellation,
  DirectoryColumns,
  DivergingColumns,
  DivergingRows,
  DotMatrix,
  FileChurnScatter,
  FileConstellation,
  FileTreemap,
  FocusedDetailView,
  Metric,
  SmallMultiples,
  HeroStatRow,
  DeltaChip,
  InteractiveDailyChurn,
  LegendDot,
  LegendHatch,
  StackedArea,
  TrueShareBars,
  type DetailTabDef,
  type DivergingRowEntry,
  type DivergingSeries,
  type FocusedQuestion,
  type HeroStatDef,
  type InteractiveDailyChurnEntry,
  type SmallMultipleItem,
  type StackedAreaEntry,
  type TrueShareEntry,
} from '../../components/DetailView/index.js';
import RangePills from '../../components/RangePills/RangePills.jsx';
import ToolIcon from '../../components/ToolIcon/ToolIcon.js';
import { WorkTypeStrip } from '../../components/WorkTypeStrip/index.js';
import { useTabs } from '../../hooks/useTabs.js';
import { arcPath } from '../../lib/svgArcs.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { navigate, setQueryParam, useQueryParam } from '../../lib/router.js';
import { Sparkline } from '../../widgets/charts.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import { formatCost } from '../../widgets/utils.js';
import { hasCostData } from '../../widgets/bodies/shared.js';
import { RANGES, formatScope, type RangeDays } from './overview-utils.js';
import styles from './UsageDetailView.module.css';

const USAGE_TABS = [
  'sessions',
  'edits',
  'lines',
  'cost',
  'cost-per-edit',
  'files-touched',
] as const;
type UsageTab = (typeof USAGE_TABS)[number];

function isUsageTab(value: string | null | undefined): value is UsageTab {
  return (USAGE_TABS as readonly string[]).includes(value ?? '');
}

interface Props {
  analytics: UserAnalytics;
  initialTab?: string | null;
  onBack: () => void;
  rangeDays: RangeDays;
  onRangeChange: (next: RangeDays) => void;
}

// Formatting helpers kept inline for the non-currency paths. USD goes
// through `formatCost` (widgets/utils) so the detail view gets the same
// thousands-separator behavior as the KPI strip and null→em-dash fallback.
function fmtCount(n: number): string {
  return n.toLocaleString();
}
function fmtPct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

// Em-dash placeholder for tabs without a comparable previous-period
// value (e.g. files-touched has no per-day breakdown). Keeps the delta
// caption visible on every tab so the strip stays visually uniform —
// no conditional renders that hide treatment during testing.
const MISSING_DELTA = { text: '—', color: 'var(--soft)' } as const;

/**
 * In-window delta: split a daily series in half by position and compare
 * sums. Matches the widget convention (see `splitPeriodDelta` in
 * `widgets/bodies/UsageWidgets.tsx`) — preferred over `period_comparison`
 * because the worker's 30-day session retention empties the previous
 * window for production users, which would null every cross-window
 * delta. Splitting the current window sidesteps retention and keeps the
 * arrow honest at any range.
 */
function splitDelta<T>(
  days: ReadonlyArray<T>,
  select: (row: T) => number,
): { current: number; previous: number } | null {
  if (days.length < 2) return null;
  const mid = Math.floor(days.length / 2);
  const currentStart = days.length % 2 === 0 ? mid : mid + 1;
  const previous = days.slice(0, mid).reduce((s, d) => s + select(d), 0);
  const current = days.slice(currentStart).reduce((s, d) => s + select(d), 0);
  return { current, previous };
}

/**
 * Format a numeric delta into an arrow + magnitude pill matching the
 * StatWidget convention (`↑26`, `↓4`, `→0`). Returns the placeholder
 * em-dash when the comparison can't be established (no previous data,
 * or `previous <= 0` which is divide-by-infinity territory).
 */
function formatCountDelta(
  delta: { current: number; previous: number } | null,
  invert = false,
): { text: string; color: string } {
  if (!delta || delta.previous <= 0) return MISSING_DELTA;
  const d = delta.current - delta.previous;
  if (d === 0) return { text: '→0', color: 'var(--muted)' };
  const arrow = d > 0 ? '↑' : '↓';
  const magnitude = String(Math.abs(Math.round(d * 10) / 10));
  const isGood = invert ? d < 0 : d > 0;
  return { text: `${arrow}${magnitude}`, color: isGood ? 'var(--success)' : 'var(--danger)' };
}

/**
 * USD-flavored delta formatter. Matches StatWidget's `usd-fine` path
 * (sub-cent precision) for cost-per-edit, and falls back to plain
 * cost formatting for whole-dollar deltas.
 */
function formatUsdDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  digits: number,
  invert = false,
): { text: string; color: string } {
  if (current == null || previous == null || previous <= 0) return MISSING_DELTA;
  const d = current - previous;
  if (d === 0) return { text: '→0', color: 'var(--muted)' };
  const arrow = d > 0 ? '↑' : '↓';
  const isGood = invert ? d < 0 : d > 0;
  return {
    text: `${arrow}${formatCost(Math.abs(d), digits)}`,
    color: isGood ? 'var(--success)' : 'var(--danger)',
  };
}

export default function UsageDetailView({
  analytics,
  initialTab,
  onBack,
  rangeDays,
  onRangeChange,
}: Props) {
  const totals = useMemo(() => {
    const sessions = analytics.daily_trends.reduce((s, d) => s + d.sessions, 0);
    const edits = analytics.daily_trends.reduce((s, d) => s + d.edits, 0);
    const linesAdded = analytics.daily_trends.reduce((s, d) => s + d.lines_added, 0);
    const linesRemoved = analytics.daily_trends.reduce((s, d) => s + d.lines_removed, 0);
    const linesNet = linesAdded - linesRemoved;
    const cost = analytics.token_usage.total_estimated_cost_usd;
    const cpe = analytics.token_usage.cost_per_edit;
    const filesTouched = analytics.files_touched_total;
    return { sessions, edits, linesAdded, linesRemoved, linesNet, cost, cpe, filesTouched };
  }, [analytics]);

  const resolvedInitialTab: UsageTab = isUsageTab(initialTab) ? initialTab : 'sessions';
  const tabControl = useTabs(USAGE_TABS, resolvedInitialTab);
  const { activeTab } = tabControl;

  // Tab value for lines is the net signed delta — "+647" or "−120" reads
  // "did the codebase grow or shrink in this window". Total churn
  // (added + removed) also makes sense as a scalar but doesn't answer the
  // at-a-glance question the hero stats in the panel carry; net is the
  // decision-relevant summary for a tab header.
  const linesTabValue =
    totals.linesAdded === 0 && totals.linesRemoved === 0
      ? '--'
      : `${totals.linesNet >= 0 ? '+' : '−'}${fmtCount(Math.abs(totals.linesNet))}`;

  // Tab deltas mirror the overview KPI widgets one-for-one so the same
  // metric can't show two different numbers between views. Sources match
  // each widget's choice in `widgets/bodies/UsageWidgets.tsx`:
  //   - Sessions / Edits / Lines: in-window split (avoids 30-day retention
  //     emptying period_comparison.previous in production)
  //   - Cost: in-window split on daily_trends.cost (the per-day cost is
  //     already pricing-enriched server-side)
  //   - Cost / edit: period_comparison.cost_per_edit + invert (matches the
  //     CostPerEditWidget exactly; null at 30-day windows by design)
  //   - Files: no per-day breakdown exists yet; placeholder em-dash
  const trends = analytics.daily_trends;
  const pc = analytics.period_comparison;

  const tabs: Array<DetailTabDef<UsageTab>> = [
    {
      id: 'sessions',
      label: 'Sessions',
      value: fmtCount(totals.sessions),
      delta: formatCountDelta(splitDelta(trends, (d) => d.sessions)),
    },
    {
      id: 'edits',
      label: 'Edits',
      value: fmtCount(totals.edits),
      delta: formatCountDelta(splitDelta(trends, (d) => d.edits)),
    },
    {
      id: 'lines',
      label: 'Lines',
      value: linesTabValue,
      delta: formatCountDelta(splitDelta(trends, (d) => d.lines_added - d.lines_removed)),
    },
    {
      id: 'cost',
      label: 'Cost',
      value: hasCostData(analytics.token_usage) ? formatCost(totals.cost, 2) : '--',
      delta: (() => {
        const s = splitDelta(trends, (d) => d.cost ?? 0);
        return formatUsdDelta(s?.current ?? null, s?.previous ?? null, 2);
      })(),
    },
    {
      id: 'cost-per-edit',
      label: 'Cost / edit',
      value:
        hasCostData(analytics.token_usage) && totals.cpe != null ? formatCost(totals.cpe, 3) : '--',
      delta: formatUsdDelta(pc.current.cost_per_edit, pc.previous?.cost_per_edit ?? null, 3, true),
    },
    {
      id: 'files-touched',
      label: 'Files',
      value: fmtCount(totals.filesTouched),
      delta: MISSING_DELTA,
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
      title="usage"
      subtitle={scopeSubtitle}
      actions={<RangePills value={rangeDays} onChange={onRangeChange} options={RANGES} />}
      tabs={tabs}
      tabControl={tabControl}
      idPrefix="usage"
      tablistLabel="Usage sections"
    >
      {activeTab === 'sessions' && <SessionsPanel analytics={analytics} />}
      {activeTab === 'edits' && <EditsPanel analytics={analytics} />}
      {activeTab === 'lines' && <LinesPanel analytics={analytics} />}
      {activeTab === 'cost' && <CostPanel analytics={analytics} />}
      {activeTab === 'cost-per-edit' && <CostPerEditPanel analytics={analytics} />}
      {activeTab === 'files-touched' && <FilesTouchedPanel analytics={analytics} />}
    </DetailView>
  );
}

// ── Sessions tab (fully fleshed) ─────────────────

function SessionsPanel({ analytics }: { analytics: UserAnalytics }) {
  const cs = analytics.completion_summary;
  const totalSessions = analytics.daily_trends.reduce((s, d) => s + d.sessions, 0);
  const stuck = analytics.stuckness;
  const firstEdit = analytics.first_edit_stats;

  const byTool = useMemo(() => {
    return [...analytics.tool_comparison]
      .filter((t) => t.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions);
  }, [analytics]);

  // Active question id from `?q=` — read at the top so subsequent early
  // returns don't violate hooks rules. FocusedDetailView tolerates null
  // and falls back to the first question.
  const activeId = useQueryParam('q');

  const durationDist = analytics.duration_distribution.filter((b) => b.count > 0);

  // Daily outcome strip — per-day stacked column (completed/abandoned/failed,
  // unknown on top). Replaces separate outcome-split bar + daily-trend
  // sparkline: one viz answers "what's the mix" and "how is it trending".
  const dailyMaxTotal = Math.max(1, ...analytics.daily_trends.map((row) => row.sessions));

  if (totalSessions === 0) {
    return <span className={styles.empty}>No sessions captured in this window.</span>;
  }

  // Session-health hero: two ratio-based quality stats (completed,
  // stalled), each paired with a DotMatrix so the number has literal
  // visual reference. First-edit is timing/onboarding (lives next to
  // duration); period delta lives on the SESSIONS tab itself — both
  // intentionally excluded here so the row stays cohesive and visually
  // balanced against the BY TOOL column across the gap.
  const heroStats: HeroStatDef[] = [];
  if (cs.total_sessions > 0 && cs.completion_rate > 0) {
    heroStats.push({
      key: 'completed',
      value: String(Math.round(cs.completion_rate)),
      unit: '%',
      label: 'completed',
      sublabel: `${fmtCount(cs.completed)} of ${fmtCount(cs.total_sessions)} sessions`,
      color: 'var(--success)',
      viz: <DotMatrix total={cs.total_sessions} filled={cs.completed} color="var(--success)" />,
    });
  }
  if (stuck.total_sessions > 0 && stuck.stuck_sessions > 0) {
    const rate = Math.round(stuck.stuckness_rate);
    const color = rate >= 40 ? 'var(--danger)' : rate >= 15 ? 'var(--warn)' : 'var(--ink)';
    heroStats.push({
      key: 'stalled',
      value: String(rate),
      unit: '%',
      label: 'stalled 15+ min',
      sublabel: `${fmtCount(stuck.stuck_sessions)} of ${fmtCount(stuck.total_sessions)} sessions`,
      color,
      viz: <DotMatrix total={stuck.total_sessions} filled={stuck.stuck_sessions} color={color} />,
    });
  }

  const hasHero = heroStats.length > 0;
  const firstEditMin = firstEdit.median_minutes_to_first_edit;
  const firstEditDisplay =
    firstEditMin > 0
      ? firstEditMin >= 10
        ? String(Math.round(firstEditMin))
        : firstEditMin.toFixed(1)
      : null;

  // Editorial answers: one concrete sentence per section, computed from
  // the same data the viz below renders. Numbers get <strong> so the
  // answer can be scanned at a glance without losing prose voice.
  // Answers lead with the finding, not the metric name ("73% completed",
  // not "Completion rate: 73%"). Empty-data branches degrade to the
  // honest subset rather than fabricating a narrative.

  // Metric tones tie prose numbers to viz colors. Completion = positive
  // (green dots), stall = warning (amber), neutral counts/times = ink.
  // See Metric.tsx for the tone guide. Don't tone a number just because
  // it's a number — tone only what has inherent good/bad direction.
  const healthAnswer = (() => {
    const rate = Math.round(cs.completion_rate);
    const stalledRate = stuck.total_sessions > 0 ? Math.round(stuck.stuckness_rate) : null;
    if (rate > 0 && stalledRate != null && stalledRate > 0) {
      return (
        <>
          <Metric tone="positive">{rate}%</Metric> completed.{' '}
          <Metric tone="warning">{stalledRate}%</Metric> stalled past 15 minutes.
        </>
      );
    }
    if (rate > 0) {
      return (
        <>
          <Metric tone="positive">{rate}%</Metric> of {fmtCount(cs.total_sessions)} sessions
          completed.
        </>
      );
    }
    return null;
  })();

  const byToolAnswer = (() => {
    if (byTool.length === 0) return null;
    if (byTool.length === 1) {
      const only = byTool[0];
      return (
        <>
          All sessions ran through <Metric>{getToolMeta(only.host_tool).label}</Metric> at{' '}
          <Metric tone="positive">{Math.round(only.completion_rate)}%</Metric> completion.
        </>
      );
    }
    // Leader = highest completion rate among tools with meaningful volume
    // (at least 5 sessions OR 10% of total, whichever is higher). Prevents
    // a 1-session 100%-completion tool from pretending to lead.
    const threshold = Math.max(5, Math.floor(totalSessions * 0.1));
    const qualified = byTool.filter((t) => t.sessions >= threshold);
    const leader = qualified.sort((a, b) => b.completion_rate - a.completion_rate)[0];
    if (!leader) {
      return <>Completion is close across the {byTool.length} tools in this window.</>;
    }
    return (
      <>
        <Metric>{getToolMeta(leader.host_tool).label}</Metric> leads at{' '}
        <Metric tone="positive">{Math.round(leader.completion_rate)}%</Metric> completion across{' '}
        <Metric>{fmtCount(leader.sessions)}</Metric> sessions.
      </>
    );
  })();

  const dailyAnswer = (() => {
    if (analytics.daily_trends.length < 2) return null;
    const peak = analytics.daily_trends.reduce((best, row) =>
      row.sessions > best.sessions ? row : best,
    );
    if (peak.sessions === 0) return null;
    return (
      <>
        Busiest day <Metric>{peak.day}</Metric> at{' '}
        <Metric>{fmtCount(peak.sessions)} sessions</Metric>.
      </>
    );
  })();

  const durationAnswer = (() => {
    if (durationDist.length === 0) return null;
    const total = durationDist.reduce((s, b) => s + b.count, 0);
    const shortBuckets = durationDist
      .filter((b) => b.bucket === '0-5m' || b.bucket === '5-15m')
      .reduce((s, b) => s + b.count, 0);
    const shortPct = total > 0 ? Math.round((shortBuckets / total) * 100) : 0;
    if (firstEditDisplay && shortPct > 0) {
      return (
        <>
          First edit lands at <Metric>{firstEditDisplay} min</Metric> median.{' '}
          <Metric>{shortPct}%</Metric> of sessions finish under 15 minutes.
        </>
      );
    }
    if (firstEditDisplay) {
      return (
        <>
          First edit lands at <Metric>{firstEditDisplay} min</Metric> median.
        </>
      );
    }
    if (shortPct > 0) {
      return (
        <>
          <Metric>{shortPct}%</Metric> of sessions finish under 15 minutes.
        </>
      );
    }
    return null;
  })();

  // Each question is a self-contained entry: id for URL, Q + A for the
  // sidebar, viz as children. Declared top-down in the order the user
  // would naturally read them — finding → where → when → how long.
  // Entries without data drop out via the `if` guards so a new user
  // with no tool-level data never sees a question that can't answer.
  const questions: FocusedQuestion[] = [];
  if (hasHero && healthAnswer) {
    questions.push({
      id: 'finishing',
      question: 'Are sessions finishing?',
      answer: healthAnswer,
      children: <HeroStatRow stats={heroStats} direction="column" />,
    });
  }
  if (byTool.length > 0 && byToolAnswer) {
    questions.push({
      id: 'by-tool',
      question: 'Which tool finishes the job?',
      answer: byToolAnswer,
      children: <ToolRing entries={byTool} total={totalSessions} />,
    });
  }
  if (analytics.daily_trends.length >= 2 && dailyAnswer) {
    questions.push({
      id: 'peak',
      question: 'When did the week peak?',
      answer: dailyAnswer,
      children: (
        <>
          <DailyOutcomeStrip trends={analytics.daily_trends} maxTotal={dailyMaxTotal} />
          <div className={styles.stripLegend}>
            <LegendDot color="var(--success)" label="completed" />
            <LegendDot color="var(--warn)" label="abandoned" />
            <LegendDot color="var(--danger)" label="failed" />
            <LegendHatch label="no outcome" />
          </div>
        </>
      ),
    });
  }
  if (durationDist.length > 0 && durationAnswer) {
    questions.push({
      id: 'duration',
      question: 'How long do sessions run?',
      answer: durationAnswer,
      children: <DurationStrip buckets={durationDist} />,
    });
  }

  if (questions.length === 0) {
    return <span className={styles.empty}>No sessions captured in this window.</span>;
  }

  return (
    <FocusedDetailView
      questions={questions}
      activeId={activeId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

// Mini share ring — same visual DNA as the Tools tab ring. Slices are
// tool-brand-colored, total sessions centered, legend below carries count
// and completion %. Clicking any slice or legend row navigates to the
// Tools tab so users can drill into that tool's config/health.
const RING_CX = 80;
const RING_CY = 80;
const RING_R = 56;
const RING_SW = 10;
// Gap must exceed 2×(SW/2)/R in degrees so round linecaps don't overlap
// into neighboring slices. At SW=10, R=56 that floor is ~10.24°.
const RING_GAP_DEG = 12;
// Top-N branded slices; the rest aggregate into a muted Other slice. Keeps
// every rendered arc above the cap-overlap floor regardless of tool count.
const RING_TOP_N = 5;
const OTHER_KEY = '__other';

function ToolRing({
  entries,
  total,
}: {
  entries: UserAnalytics['tool_comparison'];
  total: number;
}) {
  const arcs = useMemo(() => {
    const out: Array<{
      tool: string;
      color: string;
      startDeg: number;
      sweepDeg: number;
      sessions: number;
    }> = [];
    const safeTotal = Math.max(1, total);
    const sorted = [...entries].sort((a, b) => b.sessions - a.sessions);
    const top = sorted.slice(0, RING_TOP_N);
    const tail = sorted.slice(RING_TOP_N);
    const tailSessions = tail.reduce((s, e) => s + e.sessions, 0);
    const slices = [
      ...top.map((e) => ({
        tool: e.host_tool,
        color: getToolMeta(e.host_tool).color,
        sessions: e.sessions,
      })),
      ...(tailSessions > 0
        ? [{ tool: OTHER_KEY, color: 'var(--soft)', sessions: tailSessions }]
        : []),
    ].filter((s) => s.sessions > 0);
    const gaps = slices.length * RING_GAP_DEG;
    const available = Math.max(0, 360 - gaps);
    let cursor = 0;
    for (const s of slices) {
      const sweep = (s.sessions / safeTotal) * available;
      if (sweep > 0.2) {
        out.push({
          tool: s.tool,
          color: s.color,
          startDeg: cursor,
          sweepDeg: sweep,
          sessions: s.sessions,
        });
      }
      cursor += sweep + RING_GAP_DEG;
    }
    return out;
  }, [entries, total]);

  return (
    <div className={styles.ringBlock}>
      <div className={styles.ringMedia}>
        <svg viewBox="0 0 160 160" className={styles.ringSvg} role="img" aria-label="Tool share">
          <circle
            cx={RING_CX}
            cy={RING_CY}
            r={RING_R}
            fill="none"
            stroke="var(--hover-bg)"
            strokeWidth={RING_SW}
          />
          {arcs.map((arc) => (
            <path
              key={arc.tool}
              d={arcPath(RING_CX, RING_CY, RING_R, arc.startDeg, arc.sweepDeg)}
              fill="none"
              stroke={arc.color}
              strokeWidth={RING_SW}
              strokeLinecap="round"
              opacity={0.9}
            />
          ))}
          <text
            x={RING_CX}
            y={RING_CY - 4}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--ink)"
            fontSize="26"
            fontWeight="200"
            fontFamily="var(--display)"
            letterSpacing="-0.04em"
          >
            {fmtCount(total)}
          </text>
          <text
            x={RING_CX}
            y={RING_CY + 16}
            textAnchor="middle"
            fill="var(--soft)"
            fontSize="8"
            fontFamily="var(--mono)"
            letterSpacing="0.14em"
          >
            SESSIONS
          </text>
        </svg>
      </div>
      <div className={styles.ringPanel}>
        <table className={styles.toolTable}>
          <thead>
            <tr>
              <th scope="col" className={styles.toolTh}>
                Tool
              </th>
              <th scope="col" className={clsx(styles.toolTh, styles.toolThNum)}>
                Sessions
              </th>
              <th scope="col" className={clsx(styles.toolTh, styles.toolThNum)}>
                Share
              </th>
              <th scope="col" className={clsx(styles.toolTh, styles.toolThNum)}>
                Done
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((t, i) => {
              const meta = getToolMeta(t.host_tool);
              const share = total > 0 ? Math.round((t.sessions / total) * 100) : 0;
              return (
                <tr
                  key={t.host_tool}
                  className={styles.toolRow}
                  style={{ '--row-index': i } as CSSProperties}
                >
                  <td className={styles.toolCellName}>
                    <ToolIcon tool={t.host_tool} size={14} />
                    <span>{meta.label}</span>
                  </td>
                  <td className={styles.toolCellNum}>{fmtCount(t.sessions)}</td>
                  <td className={styles.toolCellNum}>{share}%</td>
                  <td className={styles.toolCellNum}>
                    {t.completion_rate > 0 ? `${Math.round(t.completion_rate)}%` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" className={styles.toolsCta} onClick={() => navigate('tools')}>
          <span>Open Tools tab</span>
          <span className={styles.toolsCtaArrow} aria-hidden="true">
            ↗
          </span>
        </button>
      </div>
    </div>
  );
}

// Edits-flavored share ring — same visual DNA as ToolRing above, but
// sized by edits (not sessions). Center reads "EDITS", table columns are
// Tool / Edits / Share / Rate so the pair reads as the edit story.
function EditsToolRing({
  entries,
  total,
}: {
  entries: UserAnalytics['tool_comparison'];
  total: number;
}) {
  const arcs = useMemo(() => {
    const out: Array<{
      tool: string;
      color: string;
      startDeg: number;
      sweepDeg: number;
      edits: number;
    }> = [];
    const safeTotal = Math.max(1, total);
    const sorted = [...entries].sort((a, b) => b.total_edits - a.total_edits);
    const top = sorted.slice(0, RING_TOP_N);
    const tail = sorted.slice(RING_TOP_N);
    const tailEdits = tail.reduce((s, e) => s + e.total_edits, 0);
    const slices = [
      ...top.map((e) => ({
        tool: e.host_tool,
        color: getToolMeta(e.host_tool).color,
        edits: e.total_edits,
      })),
      ...(tailEdits > 0 ? [{ tool: OTHER_KEY, color: 'var(--soft)', edits: tailEdits }] : []),
    ].filter((s) => s.edits > 0);
    const gaps = slices.length * RING_GAP_DEG;
    const available = Math.max(0, 360 - gaps);
    let cursor = 0;
    for (const s of slices) {
      const sweep = (s.edits / safeTotal) * available;
      if (sweep > 0.2) {
        out.push({
          tool: s.tool,
          color: s.color,
          startDeg: cursor,
          sweepDeg: sweep,
          edits: s.edits,
        });
      }
      cursor += sweep + RING_GAP_DEG;
    }
    return out;
  }, [entries, total]);

  const rows = useMemo(
    () =>
      [...entries].filter((e) => e.total_edits > 0).sort((a, b) => b.total_edits - a.total_edits),
    [entries],
  );

  // Single-tool empty state: a full ring is decorative, not informative.
  if (rows.length <= 1) {
    const only = rows[0];
    if (!only) return null;
    const meta = getToolMeta(only.host_tool);
    const rate = only.total_session_hours > 0 ? only.total_edits / only.total_session_hours : 0;
    return (
      <div className={styles.ringBlock}>
        <div className={styles.singleTool}>
          <div className={styles.singleToolHead} style={{ color: meta.color }}>
            <ToolIcon tool={only.host_tool} size={18} />
            <span>{meta.label}</span>
          </div>
          <div className={styles.singleToolValue}>
            {fmtCount(only.total_edits)}
            <span className={styles.singleToolUnit}>edits</span>
          </div>
          {rate > 0 && (
            <div className={styles.singleToolMeta}>
              {rate.toFixed(1)}/hr · {only.total_session_hours.toFixed(1)}h
            </div>
          )}
          <button type="button" className={styles.toolsCta} onClick={() => navigate('tools')}>
            <span>Open Tools tab</span>
            <span className={styles.toolsCtaArrow} aria-hidden="true">
              ↗
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.ringBlock}>
      <div className={styles.ringMedia}>
        <svg viewBox="0 0 160 160" className={styles.ringSvg} role="img" aria-label="Tool mix">
          <circle
            cx={RING_CX}
            cy={RING_CY}
            r={RING_R}
            fill="none"
            stroke="var(--hover-bg)"
            strokeWidth={RING_SW}
          />
          {arcs.map((arc) => (
            <path
              key={arc.tool}
              d={arcPath(RING_CX, RING_CY, RING_R, arc.startDeg, arc.sweepDeg)}
              fill="none"
              stroke={arc.color}
              strokeWidth={RING_SW}
              strokeLinecap="round"
              opacity={0.9}
            />
          ))}
          <text
            x={RING_CX}
            y={RING_CY - 4}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--ink)"
            fontSize="26"
            fontWeight="200"
            fontFamily="var(--display)"
            letterSpacing="-0.04em"
          >
            {fmtCount(total)}
          </text>
          <text
            x={RING_CX}
            y={RING_CY + 16}
            textAnchor="middle"
            fill="var(--soft)"
            fontSize="8"
            fontFamily="var(--mono)"
            letterSpacing="0.14em"
          >
            EDITS
          </text>
        </svg>
      </div>
      <div className={styles.ringPanel}>
        <table className={styles.toolTable}>
          <thead>
            <tr>
              <th scope="col" className={styles.toolTh}>
                Tool
              </th>
              <th scope="col" className={clsx(styles.toolTh, styles.toolThNum)}>
                Edits
              </th>
              <th scope="col" className={clsx(styles.toolTh, styles.toolThNum)}>
                Share
              </th>
              <th scope="col" className={clsx(styles.toolTh, styles.toolThNum)}>
                Rate
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const meta = getToolMeta(t.host_tool);
              const share = total > 0 ? Math.round((t.total_edits / total) * 100) : 0;
              const rate = t.total_session_hours > 0 ? t.total_edits / t.total_session_hours : 0;
              return (
                <tr
                  key={t.host_tool}
                  className={styles.toolRow}
                  style={{ '--row-index': i } as CSSProperties}
                >
                  <td className={styles.toolCellName}>
                    <ToolIcon tool={t.host_tool} size={14} />
                    <span>{meta.label}</span>
                  </td>
                  <td className={styles.toolCellNum}>{fmtCount(t.total_edits)}</td>
                  <td className={styles.toolCellNum}>{share}%</td>
                  <td className={styles.toolCellNum}>{rate > 0 ? `${rate.toFixed(1)}/hr` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" className={styles.toolsCta} onClick={() => navigate('tools')}>
          <span>Open Tools tab</span>
          <span className={styles.toolsCtaArrow} aria-hidden="true">
            ↗
          </span>
        </button>
      </div>
    </div>
  );
}

// Horizontal stacked strip — labels on top, continuous bar in the middle,
// counts beneath each segment. Segments share a baseline so label/bar/count
// stay in columns that flex to the bucket's share. Palette-wide ink-alpha
// spread so adjacent buckets read as distinctly different steps, not a
// single murky gray.
function DurationStrip({ buckets }: { buckets: UserAnalytics['duration_distribution'] }) {
  const total = Math.max(
    1,
    buckets.reduce((s, b) => s + b.count, 0),
  );
  const n = Math.max(1, buckets.length);
  // Spread from 20% → 100% ink so even 3 buckets read as three distinct
  // steps. Reference point: the FACIAL THIRDS pattern uses three visibly
  // different grays; linear alpha interpolation gives the same feel.
  const tintPct = (i: number): number => Math.round(20 + (i / Math.max(1, n - 1)) * 80);
  return (
    <div className={styles.durationCols}>
      {buckets.map((b, i) => {
        const pct = tintPct(i);
        const share = Math.round((b.count / total) * 100);
        return (
          <div
            key={b.bucket}
            className={styles.durationCol}
            style={
              {
                flex: Math.max(1, b.count),
                '--row-index': i,
              } as CSSProperties
            }
            title={`${b.bucket} · ${b.count} sessions`}
          >
            <span className={styles.durationColLabel}>{b.bucket}</span>
            <div
              className={styles.durationColSeg}
              style={{
                background: `color-mix(in srgb, var(--ink) ${pct}%, transparent)`,
              }}
            />
            <span className={styles.durationColValue}>
              {fmtCount(b.count)}
              <span className={styles.durationColMeta}> · {share}%</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Per-day stacked column strip. Column height = total sessions / max total.
// Segments stack bottom-up: completed, abandoned, failed, then unknown.
// Animation delay staggers left-to-right via --col-index to match the
// rowReveal pattern elsewhere.
function DailyOutcomeStrip({
  trends,
  maxTotal,
}: {
  trends: UserAnalytics['daily_trends'];
  maxTotal: number;
}) {
  const labelSpacing = Math.max(1, Math.floor(trends.length / 6));
  return (
    <div className={styles.strip}>
      <div className={styles.stripGrid}>
        {trends.map((row, i) => {
          const total = row.sessions;
          const unknown = Math.max(0, total - row.completed - row.abandoned - row.failed);
          const columnHeightPct = (total / maxTotal) * 100;
          return (
            <div
              key={row.day}
              className={styles.stripCol}
              style={{ '--col-index': i } as CSSProperties}
              title={`${row.day} · ${total} sessions`}
            >
              <div className={styles.stripColInner}>
                <div className={styles.stripColStack} style={{ height: `${columnHeightPct}%` }}>
                  {row.completed > 0 && (
                    <div
                      className={styles.stripSeg}
                      style={{
                        flex: row.completed,
                        background: 'var(--success)',
                      }}
                    />
                  )}
                  {row.abandoned > 0 && (
                    <div
                      className={styles.stripSeg}
                      style={{
                        flex: row.abandoned,
                        background: 'var(--warn)',
                      }}
                    />
                  )}
                  {row.failed > 0 && (
                    <div
                      className={styles.stripSeg}
                      style={{
                        flex: row.failed,
                        background: 'var(--danger)',
                      }}
                    />
                  )}
                  {unknown > 0 && (
                    <div
                      className={clsx(styles.stripSeg, styles.stripSegHatch)}
                      style={{ flex: unknown }}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.stripAxis}>
        {trends.map((row, i) => (
          <span
            key={row.day}
            className={styles.stripAxisLabel}
            data-visible={
              i === 0 || i === trends.length - 1 || i % labelSpacing === 0 ? 'true' : 'false'
            }
          >
            {formatStripDate(row.day)}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatStripDate(iso: string): string {
  // YYYY-MM-DD → MM-DD, keep mono-friendly
  if (iso.length >= 10) return iso.slice(5);
  return iso;
}

// ── Edits tab ────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Humanize a duration expressed in minutes: seconds under one minute,
 *  minutes up to an hour, hours past that. Returns the pair the hero
 *  stat expects so callers spread it into HeroStatDef. */
function formatWarmup(minutes: number): { value: string; unit?: string } {
  if (minutes < 1) return { value: `${Math.max(1, Math.round(minutes * 60))}`, unit: 's' };
  if (minutes < 60) return { value: minutes.toFixed(1), unit: 'min' };
  return { value: (minutes / 60).toFixed(1), unit: 'h' };
}

function EditsPanel({ analytics }: { analytics: UserAnalytics }) {
  // Row 4 cross-filter: clicking a directory column scopes the file
  // treemap to that directory. Keeps Row 4 as one connected lens on the
  // repo instead of two parallel viz.
  const [selectedDir, setSelectedDir] = useState<string | null>(null);

  const total = analytics.daily_trends.reduce((s, d) => s + d.edits, 0);

  const peak = analytics.daily_trends.reduce<{ day: string; edits: number }>(
    (best, d) => (d.edits > best.edits ? { day: d.day, edits: d.edits } : best),
    { day: '', edits: 0 },
  );

  const ratesWithHours = analytics.edit_velocity
    .filter((v) => v.total_session_hours > 0)
    .map((v) => v.edits_per_hour);
  const medianRate = median(ratesWithHours);
  const activeDays = ratesWithHours.length;

  const byMember = useMemo<TrueShareEntry[]>(
    () =>
      [...analytics.member_analytics]
        .filter((m) => m.total_edits > 0)
        .sort((a, b) => b.total_edits - a.total_edits)
        .map((m) => {
          const rate = m.total_session_hours > 0 ? m.total_edits / m.total_session_hours : 0;
          return {
            key: m.handle,
            label: (
              <>
                {m.primary_tool && <ToolIcon tool={m.primary_tool} size={12} />}
                {m.handle}
              </>
            ),
            value: m.total_edits,
            color: m.primary_tool ? getToolMeta(m.primary_tool).color : undefined,
            meta: rate > 0 ? `${rate.toFixed(1)}/hr · ${m.total_session_hours.toFixed(1)}h` : null,
          };
        }),
    [analytics.member_analytics],
  );

  const byProject = useMemo<TrueShareEntry[]>(
    () =>
      [...analytics.per_project_velocity]
        .filter((p) => p.total_edits > 0)
        .sort((a, b) => b.total_edits - a.total_edits)
        .map((p) => ({
          key: p.team_id,
          label: (
            <>
              {p.primary_tool && <ToolIcon tool={p.primary_tool} size={12} />}
              {p.team_name ?? p.team_id}
            </>
          ),
          value: p.total_edits,
          color: p.primary_tool ? getToolMeta(p.primary_tool).color : undefined,
          meta:
            p.edits_per_hour > 0
              ? `${p.edits_per_hour.toFixed(1)}/hr · ${p.total_session_hours.toFixed(1)}h`
              : null,
        })),
    [analytics.per_project_velocity],
  );

  const rankedFiles = useMemo(
    () =>
      [...analytics.file_heatmap]
        .filter((f) => f.touch_count > 0)
        .sort((a, b) => b.touch_count - a.touch_count),
    [analytics.file_heatmap],
  );

  const projectPulse = useMemo<SmallMultipleItem[]>(() => {
    const rows = analytics.per_project_lines ?? [];
    if (rows.length === 0) return [];
    const byId = new Map<
      string,
      {
        team_id: string;
        team_name: string | null;
        series: { day: string; edits: number }[];
        total: number;
      }
    >();
    for (const r of rows) {
      const entry = byId.get(r.team_id) ?? {
        team_id: r.team_id,
        team_name: r.team_name ?? null,
        series: [],
        total: 0,
      };
      entry.series.push({ day: r.day, edits: r.edits });
      entry.total += r.edits;
      byId.set(r.team_id, entry);
    }
    const toolByProject = new Map<string, string | null>();
    for (const p of analytics.per_project_velocity) {
      toolByProject.set(p.team_id, p.primary_tool ?? null);
    }
    const items = [...byId.values()].filter((e) => e.total > 0);
    items.sort((a, b) => b.total - a.total);
    return items.map((p) => {
      p.series.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
      const primaryTool = toolByProject.get(p.team_id) ?? null;
      const color = primaryTool ? getToolMeta(primaryTool).color : 'var(--muted)';
      return {
        key: p.team_id,
        label: (
          <>
            {primaryTool && <ToolIcon tool={primaryTool} size={12} />}
            {p.team_name ?? p.team_id}
          </>
        ),
        meta: `${fmtCount(p.total)} edits`,
        body: <Sparkline data={p.series.map((s) => s.edits)} height={48} color={color} />,
      };
    });
  }, [analytics.per_project_lines, analytics.per_project_velocity]);

  const teamMode = byMember.length >= 2;
  const contributionEntries = teamMode ? byMember : byProject;

  const toolDailyStacked = useMemo<StackedAreaEntry[]>(() => {
    const rows = analytics.tool_daily ?? [];
    if (rows.length === 0) return [];
    const byTool = new Map<string, { day: string; value: number }[]>();
    for (const r of rows) {
      const key = r.host_tool ?? 'unknown';
      const bucket = byTool.get(key) ?? [];
      bucket.push({ day: r.day, value: r.edits });
      byTool.set(key, bucket);
    }
    const out: StackedAreaEntry[] = [];
    for (const [tool, series] of byTool) {
      const total = series.reduce((s, p) => s + p.value, 0);
      if (total <= 0) continue;
      series.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
      const meta = getToolMeta(tool);
      out.push({ key: tool, label: meta.label, series, color: meta.color });
    }
    return out;
  }, [analytics.tool_daily]);

  const toolRingRows = useMemo(
    () => analytics.tool_comparison.filter((t) => t.total_edits > 0),
    [analytics.tool_comparison],
  );
  const hasRing = toolRingRows.length > 0;

  const editsActiveId = useQueryParam('q');

  if (total === 0) {
    return <span className={styles.empty}>No edits captured in this window.</span>;
  }

  const currentRate = analytics.period_comparison.current.edit_velocity;
  const previousRate = analytics.period_comparison.previous?.edit_velocity ?? null;
  const warmup = analytics.first_edit_stats.median_minutes_to_first_edit;

  const heroStats: HeroStatDef[] = [];
  if (currentRate > 0) {
    heroStats.push({
      key: 'rate',
      value: currentRate.toFixed(1),
      unit: '/hr',
      label: 'edits per hour',
      sublabel:
        previousRate != null && previousRate > 0 ? (
          <DeltaChip current={currentRate} previous={previousRate} sense="up" suffix="vs prev" />
        ) : undefined,
    });
  } else if (medianRate > 0) {
    // Fallback for legacy payloads where period_comparison isn't populated yet.
    heroStats.push({
      key: 'rate',
      value: medianRate.toFixed(1),
      unit: '/hr',
      label: 'edits per hour',
      sublabel: `median across ${activeDays} active days`,
    });
  }
  if (peak.edits > 0) {
    heroStats.push({
      key: 'peak',
      value: fmtCount(peak.edits),
      label: 'peak day',
      sublabel: formatStripDate(peak.day),
    });
  }
  if (warmup > 0) {
    heroStats.push({
      key: 'warmup',
      ...formatWarmup(warmup),
      label: 'time to first edit',
      sublabel: 'median across sessions',
    });
  }

  // Build per-question answers from data computed above. Tones: pace
  // per-hour is neutral (it's context, not a verdict); peak/contribution
  // numbers are neutral (names aren't good or bad); tool shares are
  // neutral too since volume share isn't inherently positive.
  const cadenceAnswer = (() => {
    const rateStat = heroStats.find((h) => h.key === 'rate');
    const rate = rateStat ? String(rateStat.value) : null;
    if (rate && peak.edits > 0) {
      return (
        <>
          <Metric>{rate}/hr</Metric> median pace. Peak day hit{' '}
          <Metric>{fmtCount(peak.edits)} edits</Metric>.
        </>
      );
    }
    if (rate) {
      return (
        <>
          <Metric>{rate}/hr</Metric> median pace across <Metric>{activeDays}</Metric> active days.
        </>
      );
    }
    if (peak.edits > 0) {
      return (
        <>
          Peak day hit <Metric>{fmtCount(peak.edits)} edits</Metric>.
        </>
      );
    }
    return null;
  })();

  const toolMixAnswer = (() => {
    if (toolRingRows.length === 0) return null;
    const sorted = [...toolRingRows].sort((a, b) => b.total_edits - a.total_edits);
    const top = sorted[0];
    const share = total > 0 ? Math.round((top.total_edits / total) * 100) : 0;
    return (
      <>
        <Metric>{getToolMeta(top.host_tool).label}</Metric> drives <Metric>{share}%</Metric> of
        edits.
      </>
    );
  })();

  const contributionAnswer = (() => {
    if (contributionEntries.length === 0) return null;
    const top = contributionEntries[0];
    const topVal = typeof top.value === 'number' ? top.value : 0;
    return (
      <>
        <Metric>{typeof top.label === 'string' ? top.label : top.key}</Metric> leads with{' '}
        <Metric>{fmtCount(topVal)} edits</Metric>.
      </>
    );
  })();

  const projectRhythmAnswer = (() => {
    if (projectPulse.length === 0) return null;
    const top = projectPulse[0];
    return (
      <>
        <Metric>{typeof top.label === 'string' ? top.label : top.key}</Metric> carries the strongest
        daily cadence across <Metric>{projectPulse.length} projects</Metric>.
      </>
    );
  })();

  const dailyRhythmAnswer = (() => {
    if (toolDailyStacked.length === 0) return null;
    const sorted = [...toolDailyStacked].sort((a, b) => {
      const aSum = a.series.reduce((s, p) => s + p.value, 0);
      const bSum = b.series.reduce((s, p) => s + p.value, 0);
      return bSum - aSum;
    });
    const top = sorted[0];
    return (
      <>
        <Metric>{top.label}</Metric> accounts for the largest share of daily edit volume.
      </>
    );
  })();

  const landscapeAnswer = (() => {
    if (rankedFiles.length === 0) return null;
    const topFile = rankedFiles[0];
    return (
      <>
        <Metric>{topFile.file.split('/').pop() ?? topFile.file}</Metric> leads the map at{' '}
        <Metric>{fmtCount(topFile.touch_count)} touches</Metric>.
      </>
    );
  })();

  const questions: FocusedQuestion[] = [];
  if (heroStats.length > 0 && cadenceAnswer) {
    questions.push({
      id: 'cadence',
      question: 'How fast are edits coming?',
      answer: cadenceAnswer,
      children: <HeroStatRow stats={heroStats} direction="column" />,
    });
  }
  if (hasRing && toolMixAnswer) {
    questions.push({
      id: 'tool-mix',
      question: 'Which tool does most of the editing?',
      answer: toolMixAnswer,
      children: <EditsToolRing entries={toolRingRows} total={total} />,
    });
  }
  if (contributionEntries.length >= 2 && contributionAnswer) {
    questions.push({
      id: 'contribution',
      question: teamMode ? 'Who is doing the work?' : 'Which project is getting edits?',
      answer: contributionAnswer,
      children: (
        <TrueShareBars entries={contributionEntries} formatValue={(n) => `${fmtCount(n)} edits`} />
      ),
    });
  }
  if (projectPulse.length >= 2 && projectRhythmAnswer) {
    questions.push({
      id: 'project-rhythm',
      question: 'When is each project busy?',
      answer: projectRhythmAnswer,
      children: <SmallMultiples items={projectPulse} />,
    });
  }
  if (toolDailyStacked.length >= 1 && dailyRhythmAnswer) {
    questions.push({
      id: 'daily-rhythm',
      question: 'How does daily editing break down?',
      answer: dailyRhythmAnswer,
      children: (
        <StackedArea
          entries={toolDailyStacked}
          unitLabel="edits per day"
          ariaLabel="Edits per day, stacked by tool"
        />
      ),
    });
  }
  if (rankedFiles.length > 0 && landscapeAnswer) {
    questions.push({
      id: 'landscape',
      question: 'Where do edits land?',
      answer: landscapeAnswer,
      children: (
        <div className={styles.landscapeGrid}>
          <div className={styles.landscapePane}>
            <span className={styles.landscapeSublabel}>File landscape</span>
            <FileTreemap
              entries={rankedFiles}
              totalFiles={analytics.files_touched_total}
              filterPrefix={selectedDir}
            />
          </div>
          <div className={styles.landscapePane}>
            <span className={styles.landscapeSublabel}>
              Filter by directory
              {selectedDir && (
                <button
                  type="button"
                  className={styles.landscapeClear}
                  onClick={() => setSelectedDir(null)}
                  aria-label="Clear directory filter"
                >
                  × clear
                </button>
              )}
            </span>
            <DirectoryColumns
              files={rankedFiles}
              selectedKey={selectedDir}
              onSelect={setSelectedDir}
            />
          </div>
        </div>
      ),
    });
  }

  if (questions.length === 0) {
    return <span className={styles.empty}>No edits captured in this window.</span>;
  }

  return (
    <FocusedDetailView
      questions={questions}
      activeId={editsActiveId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

// ── Lines tab ────────────────────────────────────

function LinesPanel({ analytics }: { analytics: UserAnalytics }) {
  const totalAdded = analytics.daily_trends.reduce((s, d) => s + d.lines_added, 0);
  const totalRemoved = analytics.daily_trends.reduce((s, d) => s + d.lines_removed, 0);
  const net = totalAdded - totalRemoved;
  const churn = totalAdded + totalRemoved;

  const peakDay = analytics.daily_trends.reduce<{
    day: string;
    net: number;
    added: number;
    removed: number;
    score: number;
  }>(
    (best, d) => {
      const score = d.lines_added + d.lines_removed;
      return score > best.score
        ? {
            day: d.day,
            net: d.lines_added - d.lines_removed,
            added: d.lines_added,
            removed: d.lines_removed,
            score,
          }
        : best;
    },
    { day: '', net: 0, added: 0, removed: 0, score: 0 },
  );

  const series: DivergingSeries[] = analytics.daily_trends.map((d) => ({
    day: d.day,
    added: d.lines_added,
    removed: d.lines_removed,
  }));

  const workTypeRows: DivergingRowEntry[] = analytics.work_type_distribution
    .filter((w) => w.lines_added + w.lines_removed > 0)
    .sort((a, b) => b.lines_added + b.lines_removed - (a.lines_added + a.lines_removed))
    .map((w) => ({
      key: w.work_type,
      label: w.work_type,
      added: w.lines_added,
      removed: w.lines_removed,
    }));

  // Top files by churn (added + removed). file_heatmap rows for MCP-only
  // tools leave total_lines_added / total_lines_removed undefined, so they
  // naturally filter out below.
  // Keep 50 (heatmap cap) rather than the old top-10 slice — the scatter
  // reads fine at that density and a wider dataset reveals the tail that
  // a ranked list would have hidden.
  const topChurnFiles = analytics.file_heatmap
    .map((f) => ({
      file: f.file,
      added: f.total_lines_added ?? 0,
      removed: f.total_lines_removed ?? 0,
      touches: f.touch_count,
      work_type: f.work_type,
    }))
    .filter((f) => f.added + f.removed > 0)
    .sort((a, b) => b.added + b.removed - (a.added + a.removed));

  // Per-member small multiples. Group member_daily_lines by handle, sort
  // by total churn desc, keep only members with any line activity.
  const perMember = useMemo(() => {
    const byHandle = new Map<string, DivergingSeries[]>();
    for (const row of analytics.member_daily_lines) {
      const existing = byHandle.get(row.handle) ?? [];
      existing.push({
        day: row.day,
        added: row.lines_added,
        removed: row.lines_removed,
      });
      byHandle.set(row.handle, existing);
    }
    return [...byHandle.entries()]
      .map(([handle, s]) => {
        const mAdded = s.reduce((acc, r) => acc + r.added, 0);
        const mRemoved = s.reduce((acc, r) => acc + r.removed, 0);
        return { handle, series: s, totalAdded: mAdded, totalRemoved: mRemoved };
      })
      .filter((m) => m.totalAdded + m.totalRemoved > 0)
      .sort((a, b) => b.totalAdded + b.totalRemoved - (a.totalAdded + a.totalRemoved));
  }, [analytics.member_daily_lines]);

  const perProject = useMemo(() => {
    const byTeam = new Map<string, { team_name: string | null; series: DivergingSeries[] }>();
    for (const row of analytics.per_project_lines) {
      const entry = byTeam.get(row.team_id) ?? { team_name: row.team_name, series: [] };
      entry.series.push({
        day: row.day,
        added: row.lines_added,
        removed: row.lines_removed,
      });
      byTeam.set(row.team_id, entry);
    }
    return [...byTeam.entries()]
      .map(([team_id, { team_name, series: s }]) => {
        const pAdded = s.reduce((acc, r) => acc + r.added, 0);
        const pRemoved = s.reduce((acc, r) => acc + r.removed, 0);
        return { team_id, team_name, series: s, totalAdded: pAdded, totalRemoved: pRemoved };
      })
      .filter((p) => p.totalAdded + p.totalRemoved > 0)
      .sort((a, b) => b.totalAdded + b.totalRemoved - (a.totalAdded + a.totalRemoved));
  }, [analytics.per_project_lines]);

  const linesActiveId = useQueryParam('q');

  if (totalAdded === 0 && totalRemoved === 0) {
    return <span className={styles.empty}>No line changes captured in this window.</span>;
  }

  const netSign = net >= 0 ? '+' : '−';
  const heroStats: HeroStatDef[] = [
    {
      key: 'added',
      value: `+${fmtCount(totalAdded)}`,
      label: 'lines added',
      color: 'var(--success)',
    },
    {
      key: 'removed',
      value: `−${fmtCount(totalRemoved)}`,
      label: 'lines removed',
      color: 'var(--danger)',
    },
    {
      key: 'net',
      value: `${netSign}${fmtCount(Math.abs(net))}`,
      label: 'net change',
      sublabel: churn > 0 ? `${fmtCount(churn)} total churn` : undefined,
    },
  ];
  if (peakDay.score > 0) {
    heroStats.push({
      key: 'peak',
      value: `${peakDay.net >= 0 ? '+' : '−'}${fmtCount(Math.abs(peakDay.net))}`,
      label: 'peak day',
      sublabel: `${formatStripDate(peakDay.day)} · +${fmtCount(peakDay.added)}/−${fmtCount(peakDay.removed)}`,
    });
  }

  // Tones: added lines → positive (green), removed → negative (red),
  // net sign neutral (its own sign carries the semantic).
  const churnAnswer = (
    <>
      <Metric tone="positive">+{fmtCount(totalAdded)}</Metric> added,{' '}
      <Metric tone="negative">−{fmtCount(totalRemoved)}</Metric> removed. Net{' '}
      <Metric>
        {netSign}
        {fmtCount(Math.abs(net))}
      </Metric>
      .
    </>
  );

  const dailyGrowthAnswer = (() => {
    if (peakDay.score === 0) return null;
    return (
      <>
        Peak churn on <Metric>{peakDay.day}</Metric> at{' '}
        <Metric tone="positive">+{fmtCount(peakDay.added)}</Metric> /{' '}
        <Metric tone="negative">−{fmtCount(peakDay.removed)}</Metric>.
      </>
    );
  })();

  const workTypeAnswer = (() => {
    if (workTypeRows.length === 0) return null;
    const top = workTypeRows[0];
    const topChurn = top.added + top.removed;
    return (
      <>
        <Metric>{top.label}</Metric> carries the biggest slice at{' '}
        <Metric>{fmtCount(topChurn)} lines</Metric>.
      </>
    );
  })();

  const filesChurnAnswer = (() => {
    if (topChurnFiles.length === 0) return null;
    const top = topChurnFiles[0];
    const topTotal = top.added + top.removed;
    return (
      <>
        <Metric>{top.file.split('/').pop() ?? top.file}</Metric> tops the scatter at{' '}
        <Metric>{fmtCount(topTotal)} lines</Metric> across{' '}
        <Metric>{fmtCount(top.touches)} touches</Metric>.
      </>
    );
  })();

  const dailyChurnAnswer = (() => {
    const memberAvailable = perMember.length >= 2;
    const projectAvailable = perProject.length >= 2;
    if (!memberAvailable && !projectAvailable) return null;
    if (memberAvailable) {
      const top = perMember[0];
      const topTotal = top.totalAdded + top.totalRemoved;
      return (
        <>
          <Metric>{top.handle}</Metric> leads churn volume at{' '}
          <Metric>{fmtCount(topTotal)} lines</Metric>.
        </>
      );
    }
    const top = perProject[0];
    const topTotal = top.totalAdded + top.totalRemoved;
    return (
      <>
        <Metric>{top.team_name ?? top.team_id}</Metric> leads churn volume at{' '}
        <Metric>{fmtCount(topTotal)} lines</Metric>.
      </>
    );
  })();

  const questions: FocusedQuestion[] = [
    {
      id: 'churn',
      question: 'How much code is moving?',
      answer: churnAnswer,
      children: <HeroStatRow stats={heroStats} />,
    },
  ];
  if (series.length >= 2 && dailyGrowthAnswer) {
    questions.push({
      id: 'daily-growth',
      question: 'Which days grew the code base?',
      answer: dailyGrowthAnswer,
      children: (
        <>
          <DivergingColumns data={series} />
          <div className={styles.stripLegend}>
            <LegendDot color="var(--success)" label="added" />
            <LegendDot color="var(--danger)" label="removed" />
          </div>
        </>
      ),
    });
  }
  if (workTypeRows.length > 0 && workTypeAnswer) {
    questions.push({
      id: 'by-work-type',
      question: 'Where does the churn concentrate?',
      answer: workTypeAnswer,
      children: <DivergingRows entries={workTypeRows} />,
    });
  }
  if (topChurnFiles.length > 0 && filesChurnAnswer) {
    questions.push({
      id: 'files-churn',
      question: 'Which files churn the most?',
      answer: filesChurnAnswer,
      children: (
        <FileChurnScatter
          entries={topChurnFiles.map((f) => ({
            file: f.file,
            lines_added: f.added,
            lines_removed: f.removed,
            work_type: f.work_type,
            touch_count: f.touches,
          }))}
          ariaLabel={`${topChurnFiles.length} files plotted by lines added vs lines removed`}
        />
      ),
    });
  }
  if (dailyChurnAnswer) {
    questions.push({
      id: 'daily-churn',
      question: 'Who is churning the code?',
      answer: dailyChurnAnswer,
      children: <DailyChurnSection memberEntries={perMember} projectEntries={perProject} />,
    });
  }

  return (
    <FocusedDetailView
      questions={questions}
      activeId={linesActiveId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

interface MemberChurnEntry {
  handle: string;
  series: DivergingSeries[];
  totalAdded: number;
  totalRemoved: number;
}

interface ProjectChurnEntry {
  team_id: string;
  team_name: string | null;
  series: DivergingSeries[];
  totalAdded: number;
  totalRemoved: number;
}

type ChurnPivot = 'teammate' | 'project';

// Inline pivot selector + stacked area chart. Lives inside the Lines panel
// since it's the only caller; if another tab grows an equivalent pair of
// entity lists it's straightforward to lift into DetailView/viz/.
function DailyChurnSection({
  memberEntries,
  projectEntries,
}: {
  memberEntries: MemberChurnEntry[];
  projectEntries: ProjectChurnEntry[];
}) {
  const memberAvailable = memberEntries.length >= 2;
  const projectAvailable = projectEntries.length >= 2;

  // Default pivot prefers teammate; falls through to project when that's
  // the only populated substrate. If neither substrate is populated, the
  // section renders nothing at all.
  const [pivot, setPivot] = useState<ChurnPivot>(memberAvailable ? 'teammate' : 'project');

  // If the preferred pivot disappears (e.g. teammate list drops below 2
  // when filters change upstream), switch to whichever is still populated
  // so the chart stays meaningful. React's "adjust state during render"
  // pattern — setState during render re-queues immediately, with no
  // cascading-effect warning and no intermediate stale paint.
  if (pivot === 'teammate' && !memberAvailable && projectAvailable) {
    setPivot('project');
  } else if (pivot === 'project' && !projectAvailable && memberAvailable) {
    setPivot('teammate');
  }

  const entries = useMemo<InteractiveDailyChurnEntry[]>(() => {
    if (pivot === 'teammate') {
      return memberEntries.map((m) => ({
        key: m.handle,
        label: m.handle,
        series: m.series.map((s) => ({
          day: s.day,
          added: s.added,
          removed: s.removed,
        })),
      }));
    }
    return projectEntries.map((p) => ({
      key: p.team_id,
      label: p.team_name ?? p.team_id,
      series: p.series.map((s) => ({
        day: s.day,
        added: s.added,
        removed: s.removed,
      })),
    }));
  }, [pivot, memberEntries, projectEntries]);

  if (!memberAvailable && !projectAvailable) return null;
  const showSelector = memberAvailable && projectAvailable;

  // No wrapping DetailSection — the caller is a FocusedQuestion which
  // owns the title. Pivot bar + chart render bare.
  return (
    <>
      {showSelector && (
        <div className={styles.pivotBar} role="tablist" aria-label="Breakdown pivot">
          <button
            type="button"
            role="tab"
            aria-selected={pivot === 'teammate'}
            className={clsx(styles.pivotButton, pivot === 'teammate' && styles.pivotButtonActive)}
            onClick={() => setPivot('teammate')}
          >
            by teammate
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pivot === 'project'}
            className={clsx(styles.pivotButton, pivot === 'project' && styles.pivotButtonActive)}
            onClick={() => setPivot('project')}
          >
            by project
          </button>
        </div>
      )}

      <InteractiveDailyChurn
        entries={entries}
        unitLabel="lines"
        ariaLabel={`Daily churn per ${pivot} with toggleable legend`}
      />
    </>
  );
}

// ── Cost tab ─────────────────────────────────────

function CostPanel({ analytics }: { analytics: UserAnalytics }) {
  const t = analytics.token_usage;
  const costActiveId = useQueryParam('q');
  // Matches the KPI widget's gate — if the total is an em-dash at overview,
  // the detail shouldn't render $0.00. Three reasons fold in: zero token
  // sessions, stale pricing (pricing-enrich zeros total), or every observed
  // model unpriced (totalCost sums to zero for a non-zero reason).
  if (!hasCostData(t)) {
    const reason = t.pricing_is_stale
      ? 'Pricing snapshot is stale — cost estimates paused until it refreshes.'
      : t.by_model.length > 0 && t.models_without_pricing_total >= t.by_model.length
        ? 'None of the models used in this window have pricing yet — cost estimates paused.'
        : 'No tools in this window captured token or cost data yet.';
    return <span className={styles.empty}>{reason}</span>;
  }
  const byModel = [...t.by_model].sort(
    (a, b) => (b.estimated_cost_usd ?? 0) - (a.estimated_cost_usd ?? 0),
  );
  const maxModelCost = Math.max(1, ...byModel.map((m) => m.estimated_cost_usd ?? 0));
  const byTool = [...t.by_tool].sort((a, b) => b.input_tokens - a.input_tokens);
  const maxToolTokens = Math.max(1, ...byTool.map((m) => m.input_tokens + m.cache_read_tokens));
  const totalCost = t.total_estimated_cost_usd ?? 0;

  // Tones: cache hit rate is positive (higher cache share = lower cost),
  // cost totals stay neutral (dollars in chinmeister's voice are context,
  // not a verdict — we don't tell users their spend is "bad").
  const byModelAnswer = (() => {
    if (byModel.length === 0) return null;
    const top = byModel[0];
    return (
      <>
        <Metric>{top.agent_model}</Metric> accounts for{' '}
        <Metric>{formatCost(top.estimated_cost_usd, 2)}</Metric> of{' '}
        <Metric>{formatCost(totalCost, 2)}</Metric> total.
      </>
    );
  })();

  const byToolAnswer = (() => {
    if (byTool.length === 0) return null;
    const top = byTool[0];
    const topTokens = top.input_tokens + top.cache_read_tokens;
    return (
      <>
        <Metric>{getToolMeta(top.host_tool).label}</Metric> sends the most at{' '}
        <Metric>{fmtCount(Math.round(topTokens / 1000))}k tokens</Metric>.
      </>
    );
  })();

  const cacheAnswer = (() => {
    if (t.cache_hit_rate == null) return null;
    const tone = t.cache_hit_rate >= 0.5 ? 'positive' : 'neutral';
    const cachedK = Math.round(t.total_cache_read_tokens / 1000);
    const totalK = Math.round((t.total_input_tokens + t.total_cache_read_tokens) / 1000);
    return (
      <>
        <Metric tone={tone}>{fmtPct(t.cache_hit_rate, 1)}</Metric> of input tokens served from
        cache. <Metric>{fmtCount(cachedK)}k</Metric> of <Metric>{fmtCount(totalK)}k</Metric>.
      </>
    );
  })();

  const questions: FocusedQuestion[] = [];
  if (byModel.length > 0 && byModelAnswer) {
    questions.push({
      id: 'by-model',
      question: 'Where is the spend going?',
      answer: byModelAnswer,
      children: (
        <BreakdownList
          items={byModel.map((m) => ({
            key: m.agent_model,
            label: m.agent_model,
            fillPct: ((m.estimated_cost_usd ?? 0) / maxModelCost) * 100,
            value: (
              <>
                {formatCost(m.estimated_cost_usd, 2)}
                <BreakdownMeta> · {fmtCount(m.sessions)} sessions</BreakdownMeta>
              </>
            ),
          }))}
        />
      ),
    });
  }
  if (byTool.length > 0 && byToolAnswer) {
    questions.push({
      id: 'by-tool',
      question: 'Which tool sends the most tokens?',
      answer: byToolAnswer,
      children: (
        <BreakdownList
          items={byTool.map((m) => {
            const meta = getToolMeta(m.host_tool);
            const tokens = m.input_tokens + m.cache_read_tokens;
            return {
              key: m.host_tool,
              label: (
                <>
                  <ToolIcon tool={m.host_tool} size={14} />
                  {meta.label}
                </>
              ),
              fillPct: (tokens / maxToolTokens) * 100,
              fillColor: meta.color,
              value: `${fmtCount(Math.round(tokens / 1000))}k tok`,
            };
          })}
        />
      ),
    });
  }
  if (t.cache_hit_rate != null && cacheAnswer) {
    questions.push({
      id: 'cache',
      question: 'Is caching pulling its weight?',
      answer: cacheAnswer,
      children: (
        <div className={styles.outcomeLegend}>
          <div className={styles.outcomeItem}>
            <span className={styles.outcomeValue}>{fmtPct(t.cache_hit_rate, 1)}</span>
            <span className={styles.outcomeLabel}>
              {fmtCount(Math.round(t.total_cache_read_tokens / 1000))}k of{' '}
              {fmtCount(Math.round((t.total_input_tokens + t.total_cache_read_tokens) / 1000))}k
              input tokens served from cache
            </span>
          </div>
        </div>
      ),
    });
  }

  if (questions.length === 0) {
    return <span className={styles.empty}>No cost data available in this window.</span>;
  }

  return (
    <FocusedDetailView
      questions={questions}
      activeId={costActiveId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

// ── Cost-per-edit tab ────────────────────────────

function CostPerEditPanel({ analytics }: { analytics: UserAnalytics }) {
  const t = analytics.token_usage;
  const cpe = t.cost_per_edit;
  const byTool = t.by_tool;
  const toolCompare = new Map(analytics.tool_comparison.map((x) => [x.host_tool, x.total_edits]));
  const cpeActiveId = useQueryParam('q');

  // Lock-step with the KPI: cost-per-edit inherits the cost total's
  // reliability gate (stale pricing, all-unpriced) plus its own null case.
  // Pricing-specific reasons pre-empt the default empty copy so the user
  // knows why the em-dash is there, not just that it is.
  if (!hasCostData(t) || cpe == null) {
    const reason = t.pricing_is_stale
      ? 'Pricing snapshot is stale — cost estimates paused until it refreshes.'
      : t.by_model.length > 0 && t.models_without_pricing_total >= t.by_model.length
        ? 'None of the models used in this window have pricing yet — cost estimates paused.'
        : 'Cost per edit needs sessions with both token and edit data — none recorded yet.';
    return <span className={styles.empty}>{reason}</span>;
  }

  const perTool = byTool
    .map((m) => {
      const edits = toolCompare.get(m.host_tool) ?? 0;
      // Rough per-tool cost estimate: proportional input-token share of total
      // cost. Accurate breakdown would need model-joined math; this stays
      // coarse and honest.
      const inputShare =
        (m.input_tokens + m.cache_read_tokens * 0.1) /
        Math.max(1, t.total_input_tokens + t.total_cache_read_tokens * 0.1);
      const estCost = t.total_estimated_cost_usd * inputShare;
      const rate = edits > 0 ? estCost / edits : null;
      return { host_tool: m.host_tool, edits, estCost, rate };
    })
    .filter((x) => x.rate != null && x.edits > 0)
    .sort((a, b) => (a.rate ?? Infinity) - (b.rate ?? Infinity));

  const maxRate = Math.max(0.001, ...perTool.map((x) => x.rate ?? 0));

  if (perTool.length === 0) {
    return <span className={styles.empty}>No per-tool cost data available in this window.</span>;
  }

  // Cheapest tool → positive tone (the answer to the question). Most
  // expensive gets warning when it's notably above the cheapest.
  const cheapest = perTool[0];
  const priciest = perTool[perTool.length - 1];
  const cheapestAnswer = (
    <>
      <Metric>{getToolMeta(cheapest.host_tool).label}</Metric> edits cheapest at{' '}
      <Metric tone="positive">{formatCost(cheapest.rate, 3)}</Metric> each
      {perTool.length > 1 &&
      priciest.rate &&
      cheapest.rate &&
      priciest.rate > cheapest.rate * 1.2 ? (
        <>
          , vs <Metric>{getToolMeta(priciest.host_tool).label}</Metric> at{' '}
          <Metric tone="warning">{formatCost(priciest.rate, 3)}</Metric>.
        </>
      ) : (
        '.'
      )}
    </>
  );

  const questions: FocusedQuestion[] = [
    {
      id: 'by-tool-cost',
      question: 'Which tool gives the best dollar per edit?',
      answer: cheapestAnswer,
      children: (
        <>
          <BreakdownList
            items={perTool.map((x) => {
              const meta = getToolMeta(x.host_tool);
              return {
                key: x.host_tool,
                label: (
                  <>
                    <ToolIcon tool={x.host_tool} size={14} />
                    {meta.label}
                  </>
                ),
                fillPct: ((x.rate ?? 0) / maxRate) * 100,
                fillColor: meta.color,
                value: (
                  <>
                    {formatCost(x.rate, 3)}
                    <BreakdownMeta> / {fmtCount(x.edits)} edits</BreakdownMeta>
                  </>
                ),
              };
            })}
          />
          <p className={styles.cpeCaveat}>
            Per-tool rates are proportional estimates from input-token share, not model-joined exact
            costs.
          </p>
        </>
      ),
    },
  ];

  return (
    <FocusedDetailView
      questions={questions}
      activeId={cpeActiveId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

// ── Files-touched tab ────────────────────────────

// NVR (new vs revisited) two-segment bar. Scoped to this panel — the viz is
// specific to the files-touched story (was this week's breadth expansion or
// familiar ground?) and doesn't generalise enough to earn a slot in the
// shared viz primitives. Ink carries "new"; revisited drops to a muted ink
// tint so the expansion slice reads as the answer.
function NewVsRevisitedBar({ newFiles, revisited }: { newFiles: number; revisited: number }) {
  const total = newFiles + revisited;
  if (total <= 0) return null;
  const newShare = Math.round((newFiles / total) * 100);
  return (
    <div className={styles.nvr}>
      <div
        className={styles.nvrBar}
        role="img"
        aria-label={`${newFiles} new, ${revisited} revisited`}
      >
        {newFiles > 0 && <div className={styles.nvrSegNew} style={{ flex: newFiles }} />}
        {revisited > 0 && <div className={styles.nvrSegRevisited} style={{ flex: revisited }} />}
      </div>
      <ul className={styles.nvrLegend}>
        <li className={styles.nvrLegendItem}>
          <span className={styles.nvrLegendCount}>{fmtCount(newFiles)}</span>
          <span className={styles.nvrLegendLabel}>new</span>
          <span className={styles.nvrLegendShare}>{newShare}%</span>
        </li>
        <li className={styles.nvrLegendItem}>
          <span className={styles.nvrLegendCount}>{fmtCount(revisited)}</span>
          <span className={styles.nvrLegendLabel}>revisited</span>
          <span className={styles.nvrLegendShare}>{100 - newShare}%</span>
        </li>
      </ul>
    </div>
  );
}

function FilesTouchedPanel({ analytics }: { analytics: UserAnalytics }) {
  const files = analytics.file_heatmap;
  const dirs = analytics.directory_heatmap;
  const filesTotal = analytics.files_touched_total;
  const workTypeBreakdown = analytics.files_by_work_type;
  const nvr = analytics.files_new_vs_revisited;
  const nvrTotal = nvr.new_files + nvr.revisited_files;

  // Hero work-type strip doubles as a filter for the File Constellation —
  // clicking a segment dims every dot whose work_type doesn't match. Clicking
  // the active segment clears. Scoped to the panel so navigation to other
  // tabs resets the filter without extra state plumbing.
  const [activeWorkType, setActiveWorkType] = useState<string | null>(null);
  const filesActiveId = useQueryParam('q');

  if (filesTotal === 0 && files.length === 0) {
    return <span className={styles.empty}>No files touched in this window.</span>;
  }

  // Tones: new-file share can read as positive expansion when it's the
  // larger slice, otherwise neutral. File/directory counts stay neutral —
  // "lots of files touched" isn't inherently good or bad without context.
  const breadthAnswer = (() => {
    if (filesTotal === 0) return null;
    const topWT =
      workTypeBreakdown.length > 0
        ? [...workTypeBreakdown].sort((a, b) => b.file_count - a.file_count)[0]
        : null;
    if (topWT) {
      return (
        <>
          <Metric>{fmtCount(filesTotal)}</Metric> distinct files touched.{' '}
          <Metric>{topWT.work_type}</Metric> carries the biggest share at{' '}
          <Metric>{fmtCount(topWT.file_count)}</Metric>.
        </>
      );
    }
    return (
      <>
        <Metric>{fmtCount(filesTotal)}</Metric> distinct files touched.
      </>
    );
  })();

  const nvrAnswer = (() => {
    if (nvrTotal === 0) return null;
    const newShare = Math.round((nvr.new_files / nvrTotal) * 100);
    const tone = newShare >= 60 ? 'positive' : newShare <= 30 ? 'neutral' : 'neutral';
    return (
      <>
        <Metric tone={tone}>{newShare}%</Metric> new, <Metric>{100 - newShare}%</Metric> revisited
        across <Metric>{fmtCount(nvrTotal)}</Metric> files.
      </>
    );
  })();

  const constellationAnswer = (() => {
    if (files.length === 0) return null;
    const top = [...files].sort((a, b) => b.touch_count - a.touch_count)[0];
    const completion = top.outcome_rate != null ? Math.round(top.outcome_rate) : null;
    const fileName = top.file.split('/').pop() ?? top.file;
    if (completion != null) {
      const tone = completion >= 70 ? 'positive' : completion >= 40 ? 'warning' : 'negative';
      return (
        <>
          <Metric>{fileName}</Metric> leads at <Metric>{fmtCount(top.touch_count)} touches</Metric>{' '}
          and <Metric tone={tone}>{completion}%</Metric> completion.
        </>
      );
    }
    return (
      <>
        <Metric>{fileName}</Metric> is the hottest at{' '}
        <Metric>{fmtCount(top.touch_count)} touches</Metric>.
      </>
    );
  })();

  const directoriesAnswer = (() => {
    if (dirs.length === 0) return null;
    const top = [...dirs].sort((a, b) => b.touch_count - a.touch_count)[0];
    return (
      <>
        <Metric>{top.directory}</Metric> takes the most work with{' '}
        <Metric>{fmtCount(top.file_count)} files</Metric> and{' '}
        <Metric>{fmtCount(top.touch_count)} touches</Metric>.
      </>
    );
  })();

  const questions: FocusedQuestion[] = [];
  if (breadthAnswer) {
    questions.push({
      id: 'breadth',
      question: 'How much surface is being touched?',
      answer: breadthAnswer,
      children: (
        <div className={styles.filesHero}>
          <span className={styles.filesHeroValue}>{fmtCount(filesTotal)}</span>
          {workTypeBreakdown.length > 0 && (
            <WorkTypeStrip
              entries={workTypeBreakdown}
              variant="hero"
              ariaLabel={`${filesTotal} distinct files by work type`}
              activeWorkType={activeWorkType}
              onSelect={setActiveWorkType}
            />
          )}
        </div>
      ),
    });
  }
  if (nvrTotal > 0 && nvrAnswer) {
    questions.push({
      id: 'new-vs-revisited',
      question: 'Expanding or returning?',
      answer: nvrAnswer,
      children: <NewVsRevisitedBar newFiles={nvr.new_files} revisited={nvr.revisited_files} />,
    });
  }
  if (files.length > 0 && constellationAnswer) {
    questions.push({
      id: 'constellation',
      question: 'Which files are hot?',
      answer: constellationAnswer,
      children: (
        <FileConstellation
          entries={files}
          activeWorkType={activeWorkType}
          ariaLabel={`${files.length} files plotted by touches × completion rate`}
        />
      ),
    });
  }
  if (dirs.length > 0 && directoriesAnswer) {
    questions.push({
      id: 'directories',
      question: 'Which directories take the most work?',
      answer: directoriesAnswer,
      children: (
        <DirectoryConstellation
          entries={dirs}
          ariaLabel={`${dirs.length} directories plotted by breadth × depth`}
        />
      ),
    });
  }

  if (questions.length === 0) {
    return <span className={styles.empty}>No files touched in this window.</span>;
  }

  return (
    <FocusedDetailView
      questions={questions}
      activeId={filesActiveId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}
