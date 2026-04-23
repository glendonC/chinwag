import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  BreakdownList,
  BreakdownMeta,
  DetailSection,
  DetailView,
  DirectoryConstellation,
  DirectoryColumns,
  DivergingColumns,
  DivergingRows,
  DotMatrix,
  FileChurnScatter,
  FileConstellation,
  FileTreemap,
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
import { navigate } from '../../lib/router.js';
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
  /** Label for the back button. Defaults to "Overview" so existing callers
   *  are unchanged; project-hosted drills pass "Project". */
  backLabel?: string;
  /** Host-provided scope control rendered in the header actions row before
   *  the range pills. Overview slots in its ProjectFilter so mid-drill
   *  filter changes refetch in place; Project slots in a scope-up link
   *  that navigates to the same drill at cross-project scope. Omit to
   *  render only the range pills. */
  scopeControl?: ReactNode;
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
  backLabel = 'Overview',
  scopeControl,
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
      backLabel={backLabel}
      onBack={onBack}
      title="usage"
      subtitle={scopeSubtitle}
      actions={
        <>
          {scopeControl}
          <RangePills value={rangeDays} onChange={onRangeChange} options={RANGES} />
        </>
      }
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

  return (
    <>
      {/* Top grid: hero stats (left) + tool share (right). Both sit at the
          fold, establishing the session story: what happened (hero) and
          where (by tool). Session duration lives below as its own full
          width band since it answers a different question (how long). */}
      {(hasHero || byTool.length > 0) && (
        <div className={clsx(styles.topGrid, styles.topGridSessions)}>
          {hasHero && (
            <DetailSection label="Session health" className={styles.sectionHero}>
              <HeroStatRow stats={heroStats} direction="column" />
            </DetailSection>
          )}
          {byTool.length > 0 && (
            <DetailSection label="By tool">
              <ToolRing entries={byTool} total={totalSessions} />
            </DetailSection>
          )}
        </div>
      )}

      {/* Daily outcome strip — subsumes outcome split + daily trend */}
      {analytics.daily_trends.length >= 2 && (
        <DetailSection label="Daily outcome mix">
          <DailyOutcomeStrip trends={analytics.daily_trends} maxTotal={dailyMaxTotal} />
          <div className={styles.stripLegend}>
            <LegendDot color="var(--success)" label="completed" />
            <LegendDot color="var(--warn)" label="abandoned" />
            <LegendDot color="var(--danger)" label="failed" />
            <LegendHatch label="no outcome" />
          </div>
        </DetailSection>
      )}

      {/* Session duration — full-width band. First-edit median rides
          along as a small lead-in caption since both metrics answer
          "how long did things take" (warmup vs total session length). */}
      {durationDist.length > 0 && (
        <DetailSection label="Session duration">
          {firstEditDisplay && (
            <p className={styles.durationLeadIn}>
              <span className={styles.durationLeadValue}>{firstEditDisplay}</span>
              <span className={styles.durationLeadUnit}>min</span>
              <span className={styles.durationLeadLabel}>median to first edit</span>
              {totalSessions > 0 && (
                <span className={styles.durationLeadContext}>
                  · across {fmtCount(totalSessions)} sessions
                </span>
              )}
            </p>
          )}
          <DurationStrip buckets={durationDist} />
        </DetailSection>
      )}
    </>
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
  const contributionLabel = teamMode ? 'Contribution' : 'Project mix';

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

  return (
    <>
      {(heroStats.length > 0 || hasRing) && (
        <div className={clsx(styles.topGrid, styles.topGridSessions)}>
          {heroStats.length > 0 && (
            <DetailSection label="Edit cadence" className={styles.sectionHero}>
              <HeroStatRow stats={heroStats} direction="column" />
            </DetailSection>
          )}
          {hasRing && (
            <DetailSection label="Tool mix">
              <EditsToolRing entries={toolRingRows} total={total} />
            </DetailSection>
          )}
        </div>
      )}

      {(contributionEntries.length >= 2 || projectPulse.length > 0) && (
        <div className={styles.topGrid}>
          {contributionEntries.length >= 2 && (
            <DetailSection label={contributionLabel}>
              <TrueShareBars
                entries={contributionEntries}
                formatValue={(n) => `${fmtCount(n)} edits`}
              />
            </DetailSection>
          )}
          {projectPulse.length > 0 && (
            <DetailSection label="Project rhythm">
              <SmallMultiples items={projectPulse} />
            </DetailSection>
          )}
        </div>
      )}

      {toolDailyStacked.length >= 1 && (
        <DetailSection label="Daily rhythm">
          <StackedArea
            entries={toolDailyStacked}
            unitLabel="edits per day"
            ariaLabel="Edits per day, stacked by tool"
          />
        </DetailSection>
      )}

      {rankedFiles.length > 0 && (
        <section className={styles.landscapeBlock}>
          <header className={styles.landscapeHead}>
            <span className={styles.landscapeLabel}>Where work lands</span>
            <span className={styles.landscapeHint}>
              {selectedDir ? (
                <>
                  Scoped to <span className={styles.landscapeHintValue}>{selectedDir}</span>
                  <button
                    type="button"
                    className={styles.landscapeClear}
                    onClick={() => setSelectedDir(null)}
                    aria-label="Clear directory filter"
                  >
                    × clear
                  </button>
                </>
              ) : (
                <>Click a directory on the right to scope the map</>
              )}
            </span>
          </header>
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
                <span className={styles.landscapeArrow} aria-hidden="true">
                  ←
                </span>
              </span>
              <DirectoryColumns
                files={rankedFiles}
                selectedKey={selectedDir}
                onSelect={setSelectedDir}
              />
            </div>
          </div>
        </section>
      )}
    </>
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

  return (
    <>
      <DetailSection label="Code churn">
        <HeroStatRow stats={heroStats} />
      </DetailSection>

      {series.length >= 2 && (
        <DetailSection label="Daily growth · +added above, −removed below">
          <DivergingColumns data={series} />
          <div className={styles.stripLegend}>
            <LegendDot color="var(--success)" label="added" />
            <LegendDot color="var(--danger)" label="removed" />
          </div>
        </DetailSection>
      )}

      {workTypeRows.length > 0 && (
        <DetailSection label="By work type">
          <DivergingRows entries={workTypeRows} />
        </DetailSection>
      )}

      {topChurnFiles.length > 0 && (
        <DetailSection label="Files by churn">
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
        </DetailSection>
      )}

      {/* Daily churn — stacked area per entity with a pivot selector.
          Unifies the two separate "by teammate" / "by project" sections
          behind one chart; selector at the top of the section switches
          the dataset and the chart re-seeds its active set so toggles
          from the prior pivot don't leak. */}
      <DailyChurnSection memberEntries={perMember} projectEntries={perProject} />
    </>
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

  return (
    <DetailSection label="daily churn">
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
    </DetailSection>
  );
}

// ── Cost tab ─────────────────────────────────────

function CostPanel({ analytics }: { analytics: UserAnalytics }) {
  const t = analytics.token_usage;
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

  return (
    <>
      {byModel.length > 0 && (
        <DetailSection label="By model">
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
        </DetailSection>
      )}

      {byTool.length > 0 && (
        <DetailSection label="By tool (input + cache read)">
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
        </DetailSection>
      )}

      {t.cache_hit_rate != null && (
        <DetailSection label="Cache efficiency">
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
        </DetailSection>
      )}
    </>
  );
}

// ── Cost-per-edit tab ────────────────────────────

function CostPerEditPanel({ analytics }: { analytics: UserAnalytics }) {
  const t = analytics.token_usage;
  const cpe = t.cost_per_edit;
  const byTool = t.by_tool;
  const toolCompare = new Map(analytics.tool_comparison.map((x) => [x.host_tool, x.total_edits]));

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

  return (
    <>
      {perTool.length > 0 && (
        <DetailSection label="By tool · cheapest first">
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
        </DetailSection>
      )}

      <DetailSection label="Note">
        <span className={styles.empty}>
          Per-tool rates are proportional estimates from input-token share, not model-joined exact
          costs.
        </span>
      </DetailSection>
    </>
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

  if (filesTotal === 0 && files.length === 0) {
    return <span className={styles.empty}>No files touched in this window.</span>;
  }

  // Filter label in the constellation section header tells the reader what
  // they're looking at when the filter is engaged — "backend files" is the
  // literal framing, with a clear-X affordance sitting next to it.
  const constellationLabel = activeWorkType ? `Files — ${activeWorkType}` : 'Files';
  const dirLabel = 'Directories';

  return (
    <>
      {/* Hero: scalar breadth + work-type composition | new-vs-revisited
          split. The strip's segments are tab-selectors threaded through
          the File Constellation below — clicking `backend` filters the
          scatter to backend dots without re-rendering the dataset. */}
      <div className={styles.topGrid}>
        <DetailSection label="Distinct files touched" className={styles.sectionHero}>
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
        </DetailSection>

        {nvrTotal > 0 && (
          <DetailSection label="New vs revisited">
            <NewVsRevisitedBar newFiles={nvr.new_files} revisited={nvr.revisited_files} />
          </DetailSection>
        )}
      </div>

      {/* File Constellation — 2D scatter fusing activity (touch count) and
          effectiveness (completion rate). Upper-right = solid hot files,
          upper-left = one-shot wins, lower-right = problem files (this
          quadrant subsumes the old "rework" list). Dots colored by
          work-type; the hero strip filters visibility. */}
      {files.length > 0 && (
        <DetailSection label={constellationLabel}>
          <FileConstellation
            entries={files}
            activeWorkType={activeWorkType}
            ariaLabel={`${files.length} files plotted by touches × completion rate`}
          />
        </DetailSection>
      )}

      {/* Directory Constellation — breadth × depth per directory. Upper-right
          = hot zones, upper-left = focused rework on few files, lower-right
          = wide-and-shallow. Dot tint encodes completion rate. Replaces the
          flat by-directory bar list; hierarchical context emerges by shape. */}
      {dirs.length > 0 && (
        <DetailSection label={dirLabel}>
          <DirectoryConstellation
            entries={dirs}
            ariaLabel={`${dirs.length} directories plotted by breadth × depth`}
          />
        </DetailSection>
      )}
    </>
  );
}
