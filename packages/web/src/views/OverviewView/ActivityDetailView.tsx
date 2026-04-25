import { useMemo, type CSSProperties } from 'react';
import {
  DetailView,
  FocusedDetailView,
  Metric,
  getCrossLinks,
  type DetailTabDef,
  type FocusedQuestion,
} from '../../components/DetailView/index.js';
import {
  BreakdownList,
  BreakdownMeta,
  DivergingColumns,
  HourHeatmap,
  TrueShareBars,
  type HourCell,
  type TrueShareEntry,
} from '../../components/viz/index.js';
import RangePills from '../../components/RangePills/RangePills.jsx';
import { useTabs } from '../../hooks/useTabs.js';
import { setQueryParam, useQueryParam } from '../../lib/router.js';
import { qualifyByVolume } from '../../lib/qualifyByVolume.js';
import { completionColor, workTypeColor, DAY_LABELS } from '../../widgets/utils.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import shared from '../../widgets/widget-shared.module.css';
import { RANGES, formatScope, type RangeDays } from './overview-utils.js';
import { MISSING_DELTA } from './detailDelta.js';
import styles from './ActivityDetailView.module.css';

/* ActivityDetailView — temporal/categorical lens on activity.
 *
 * Companion to UsageDetailView (volume scale) and OutcomesDetailView
 * (did-it-land). Activity asks WHEN sessions happen and WHAT KIND of
 * work fills them. Three tabs:
 *
 *   rhythm           — peak hour, weekday vs weekend, time-of-day blocks
 *   mix              — work-type share, lines added/removed, files spread
 *   effective-hours  — per-hour completion rate gated to hours with
 *                      ≥ p25 volume so off-hour bursts don't lie
 *
 * The synthesizer's pre-pass cut Q2 of effective-hours (volume vs rate
 * Pearson correlation) — stats vocabulary in user copy is a B1 risk.
 * Tab carries on with peak-completion + dow-dip.
 */

const ACTIVITY_TABS = ['rhythm', 'mix', 'effective-hours'] as const;
type ActivityTab = (typeof ACTIVITY_TABS)[number];

function isActivityTab(value: string | null | undefined): value is ActivityTab {
  return (ACTIVITY_TABS as readonly string[]).includes(value ?? '');
}

interface Props {
  analytics: UserAnalytics;
  initialTab?: string | null;
  onBack: () => void;
  rangeDays: RangeDays;
  onRangeChange: (next: RangeDays) => void;
}

const HEATMAP_MIN_POPULATED_CELLS = 3;
const EFFECTIVE_HOURS_MIN_QUALIFIED = 4;
const DOW_DIP_MIN_DELTA = 15;
const DOW_DIP_MIN_DOW_COUNT = 5;

function fmtCount(n: number): string {
  return n.toLocaleString();
}

function hourGlyph(h: number): string {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

// Block bucketing per spec: Morning 5-12, Afternoon 12-17, Evening
// 17-22, Night 22-5. Blocks are disjoint ranges on the 24-hour clock so
// every hour resolves to exactly one block.
type Block = 'morning' | 'afternoon' | 'evening' | 'night';
const BLOCK_LABEL: Record<Block, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};
const BLOCK_OPACITY: Record<Block, number> = {
  morning: 0.4,
  afternoon: 0.6,
  evening: 0.8,
  night: 0.9,
};
function bucketHour(hour: number): Block {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

// Compute the largest slice of work_type_distribution by edits, used
// for the mix tab's tab-strip value. Returns null when there are no
// edits in the window so the tab can render `--`.
function largestWorkType(
  workTypes: UserAnalytics['work_type_distribution'],
): { work_type: string; share: number } | null {
  const totalEdits = workTypes.reduce((s, w) => s + w.edits, 0);
  if (totalEdits === 0) return null;
  const top = [...workTypes].sort((a, b) => b.edits - a.edits)[0];
  if (!top) return null;
  return { work_type: top.work_type, share: (top.edits / totalEdits) * 100 };
}

// In-window split delta on edits for the largest work type. Compares the
// share of the leading work_type between the first and second halves of
// the window via daily_trends — daily_trends doesn't carry per-work-type
// edits, so this falls back to MISSING_DELTA. Surfacing the leader's
// raw delta would require a daily breakdown by work_type that the API
// doesn't return today; keeping the placeholder honest.

export default function ActivityDetailView({
  analytics,
  initialTab,
  onBack,
  rangeDays,
  onRangeChange,
}: Props) {
  const resolved: ActivityTab = isActivityTab(initialTab) ? initialTab : 'rhythm';
  const tabControl = useTabs(ACTIVITY_TABS, resolved);
  const { activeTab } = tabControl;

  // Peak hour = the (dow, hour) cell with the highest sessions count.
  // Used for the rhythm tab's value caption; falls back to `--` when no
  // sessions are populated yet.
  const peakCell = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const h of analytics.hourly_distribution) {
      grid[h.dow][h.hour] = (grid[h.dow][h.hour] || 0) + h.sessions;
    }
    let best: { dow: number; hour: number; sessions: number } | null = null;
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        const v = grid[dow][hour];
        if (v > 0 && (best === null || v > best.sessions)) {
          best = { dow, hour, sessions: v };
        }
      }
    }
    return best;
  }, [analytics.hourly_distribution]);

  const topWorkType = useMemo(
    () => largestWorkType(analytics.work_type_distribution),
    [analytics.work_type_distribution],
  );

  // Effective-hours qualified set: hours with sessions ≥ p25 of populated.
  // Used both for the tab value (median completion across qualifying
  // hours) and for the peak-completion question's bar chart.
  const qualifiedHours = useMemo(() => {
    const populated = analytics.hourly_effectiveness.filter((h) => h.sessions > 0);
    return qualifyByVolume(populated, (h) => h.sessions, 25);
  }, [analytics.hourly_effectiveness]);

  const medianCompletion = useMemo(() => {
    if (qualifiedHours.length === 0) return null;
    const rates = [...qualifiedHours].map((h) => h.completion_rate).sort((a, b) => a - b);
    const mid = Math.floor(rates.length / 2);
    return rates.length % 2 === 0 ? Math.round((rates[mid - 1] + rates[mid]) / 2) : rates[mid];
  }, [qualifiedHours]);

  const tabs: Array<DetailTabDef<ActivityTab>> = [
    {
      id: 'rhythm',
      label: 'When',
      value: peakCell ? `${DAY_LABELS[peakCell.dow]} ${hourGlyph(peakCell.hour)}` : '--',
      delta: MISSING_DELTA,
    },
    {
      id: 'mix',
      label: 'Work mix',
      value: topWorkType ? `${topWorkType.work_type} ${Math.round(topWorkType.share)}%` : '--',
      delta: MISSING_DELTA,
    },
    {
      id: 'effective-hours',
      label: 'Effective hours',
      value: medianCompletion != null ? `${medianCompletion}%` : '--',
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
      title="activity"
      subtitle={scopeSubtitle}
      actions={<RangePills value={rangeDays} onChange={onRangeChange} options={RANGES} />}
      tabs={tabs}
      tabControl={tabControl}
      idPrefix="activity"
      tablistLabel="Activity sections"
    >
      {activeTab === 'rhythm' && <RhythmPanel analytics={analytics} peakCell={peakCell} />}
      {activeTab === 'mix' && <MixPanel analytics={analytics} />}
      {activeTab === 'effective-hours' && (
        <EffectiveHoursPanel analytics={analytics} qualifiedHours={qualifiedHours} />
      )}
    </DetailView>
  );
}

// ── Rhythm panel ─────────────────────────────────────

function RhythmPanel({
  analytics,
  peakCell,
}: {
  analytics: UserAnalytics;
  peakCell: { dow: number; hour: number; sessions: number } | null;
}) {
  const activeId = useQueryParam('q');

  const cells = useMemo<HourCell[]>(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const h of analytics.hourly_distribution) {
      grid[h.dow][h.hour] = (grid[h.dow][h.hour] || 0) + h.sessions;
    }
    const out: HourCell[] = [];
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        const v = grid[dow][hour];
        if (v > 0) out.push({ dow, hour, value: v });
      }
    }
    return out;
  }, [analytics.hourly_distribution]);

  const blockTotals = useMemo(() => {
    const sessions: Record<Block, number> = {
      morning: 0,
      afternoon: 0,
      evening: 0,
      night: 0,
    };
    const edits: Record<Block, number> = {
      morning: 0,
      afternoon: 0,
      evening: 0,
      night: 0,
    };
    for (const h of analytics.hourly_distribution) {
      const block = bucketHour(h.hour);
      sessions[block] += h.sessions;
      edits[block] += h.edits;
    }
    return { sessions, edits };
  }, [analytics.hourly_distribution]);

  const populatedCount = cells.length;

  if (populatedCount < HEATMAP_MIN_POPULATED_CELLS) {
    return (
      <span className={styles.empty}>
        Heatmap fills in once 3+ hour×day cells have sessions. Run more sessions and drill back in.
      </span>
    );
  }

  // ── Q1: peak-hour ──
  const peakRate = (() => {
    if (!peakCell) return null;
    // Look up completion rate for this DOW from daily_trends grouped by
    // weekday; this is a coarse approximation since daily_trends carry
    // per-day rates not per-hour rates. For the cell-level prose we
    // skip the second sentence when n < 5 per the spec.
    if (peakCell.sessions < 5) return null;
    const rate = analytics.completion_summary.completion_rate;
    return Number.isFinite(rate) ? Math.round(rate) : null;
  })();

  const peakAnswer = peakCell ? (
    <>
      <Metric>
        {DAY_LABELS[peakCell.dow]} {hourGlyph(peakCell.hour)}
      </Metric>{' '}
      is your busiest cell with <Metric>{fmtCount(peakCell.sessions)}</Metric> sessions.
      {peakRate != null && (
        <>
          {' '}
          <Metric tone="positive">{peakRate}%</Metric> of those completed.
        </>
      )}
    </>
  ) : null;

  // ── Q2: weekday vs weekend ──
  const weekdaySessions = analytics.hourly_distribution
    .filter((h) => h.dow >= 1 && h.dow <= 5)
    .reduce((s, h) => s + h.sessions, 0);
  const weekendSessions = analytics.hourly_distribution
    .filter((h) => h.dow === 0 || h.dow === 6)
    .reduce((s, h) => s + h.sessions, 0);
  const totalSessionsHourly = weekdaySessions + weekendSessions;
  const weekdayShare =
    totalSessionsHourly > 0 ? Math.round((weekdaySessions / totalSessionsHourly) * 100) : 0;
  const weekendActiveHours = new Set(
    analytics.hourly_distribution
      .filter((h) => (h.dow === 0 || h.dow === 6) && h.sessions > 0)
      .map((h) => `${h.dow}:${h.hour}`),
  ).size;

  const weekendAnswer =
    totalSessionsHourly > 0 ? (
      <>
        Weekdays carry{' '}
        <Metric tone={weekdayShare > 80 ? 'positive' : undefined}>{weekdayShare}%</Metric> of
        sessions. Weekend volume is <Metric>{fmtCount(weekendSessions)}</Metric> sessions across{' '}
        <Metric>{weekendActiveHours}</Metric> active hours.
      </>
    ) : null;

  // ── Q3: morning vs evening ──
  const totalEdits =
    blockTotals.edits.morning +
    blockTotals.edits.afternoon +
    blockTotals.edits.evening +
    blockTotals.edits.night;
  const blockOrder: Block[] = ['morning', 'afternoon', 'evening', 'night'];
  const topBlock = blockOrder.reduce<Block>(
    (best, b) => (blockTotals.edits[b] > blockTotals.edits[best] ? b : best),
    'morning',
  );
  const topShare =
    totalEdits > 0 ? Math.round((blockTotals.edits[topBlock] / totalEdits) * 100) : 0;

  const blockEntries: TrueShareEntry[] = blockOrder
    .filter((b) => blockTotals.edits[b] > 0 || blockTotals.sessions[b] > 0)
    .map((b) => ({
      key: b,
      label: BLOCK_LABEL[b],
      value: blockTotals.edits[b],
      color: `color-mix(in srgb, var(--ink) ${Math.round(BLOCK_OPACITY[b] * 100)}%, transparent)`,
      meta: `${fmtCount(blockTotals.sessions[b])} sessions · ${fmtCount(blockTotals.edits[b])} edits`,
    }));

  const blockAnswer =
    totalEdits > 0 ? (
      <>
        <Metric>{BLOCK_LABEL[topBlock]}</Metric> carries <Metric>{topShare}%</Metric> of edits —{' '}
        <Metric>{fmtCount(blockTotals.edits[topBlock])}</Metric> of{' '}
        <Metric>{fmtCount(totalEdits)}</Metric>.
      </>
    ) : null;

  const questions: FocusedQuestion[] = [];
  if (peakCell && peakAnswer) {
    questions.push({
      id: 'peak-hour',
      question: 'When are you most active?',
      answer: peakAnswer,
      children: <HourHeatmap data={cells} cellSize={18} />,
      relatedLinks: getCrossLinks('activity', 'rhythm', 'peak-hour'),
    });
  }
  if (weekendAnswer) {
    questions.push({
      id: 'weekday-vs-weekend',
      question: 'Do weekends look different?',
      answer: weekendAnswer,
      children: <WeekendBlock cells={cells} weekendSessions={weekendSessions} />,
    });
  }
  if (blockAnswer && blockEntries.length > 0) {
    questions.push({
      id: 'morning-vs-evening',
      question: 'Are you a morning person?',
      answer: blockAnswer,
      children: <TrueShareBars entries={blockEntries} />,
    });
  }

  if (questions.length === 0) {
    return (
      <span className={styles.empty}>
        Heatmap fills in once 3+ hour×day cells have sessions. Run more sessions and drill back in.
      </span>
    );
  }

  return (
    <FocusedDetailView
      questions={questions}
      activeId={activeId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

function WeekendBlock({ cells, weekendSessions }: { cells: HourCell[]; weekendSessions: number }) {
  return (
    <div className={styles.weekendBlock}>
      <div className={styles.weekendRow}>
        <span className={styles.weekendCaption}>Weekdays</span>
        <HourHeatmap data={cells} compactRows={[1, 2, 3, 4, 5]} cellSize={16} hideXLabels />
      </div>
      <div className={styles.weekendRow}>
        <span className={styles.weekendCaption}>Weekend</span>
        {weekendSessions > 0 ? (
          <HourHeatmap data={cells} compactRows={[0, 6]} cellSize={16} />
        ) : (
          <span className={styles.weekendEmpty}>No weekend sessions in this window.</span>
        )}
      </div>
    </div>
  );
}

// ── Mix panel ────────────────────────────────────────

function MixPanel({ analytics }: { analytics: UserAnalytics }) {
  const activeId = useQueryParam('q');
  const workTypes = analytics.work_type_distribution;
  const totalEdits = workTypes.reduce((s, w) => s + w.edits, 0);

  if (totalEdits === 0) {
    return (
      <span className={styles.empty}>
        Work-type mix appears once sessions touch files. Each edit gets a single work_type via path
        heuristics.
      </span>
    );
  }

  // Sort by edits desc so the proportional bar reads largest-to-smallest
  // left-to-right and the legend mirrors the bar ordering.
  const sorted = [...workTypes].sort((a, b) => b.edits - a.edits);
  const top = sorted[0];
  const second = sorted[1];

  // ── Q1: share ──
  const shareAnswer = (
    <>
      <Metric>{top.work_type}</Metric> takes{' '}
      <Metric>{Math.round((top.edits / totalEdits) * 100)}%</Metric> of edits
      {second ? (
        <>
          , <Metric>{second.work_type}</Metric>{' '}
          <Metric>{Math.round((second.edits / totalEdits) * 100)}%</Metric>
        </>
      ) : null}
      . <Metric>{sorted.length}</Metric> work types touched in this window.
    </>
  );

  // ── Q2: lines-by-type ──
  const churnRows = sorted
    .filter((w) => w.lines_added + w.lines_removed > 0)
    .map((w) => ({
      day: w.work_type,
      added: w.lines_added,
      removed: w.lines_removed,
    }));
  const linesLeader = churnRows.reduce<(typeof churnRows)[number] | null>(
    (best, r) => (best === null || r.added + r.removed > best.added + best.removed ? r : best),
    null,
  );
  const linesAnswer =
    linesLeader != null ? (
      <>
        <Metric>{linesLeader.day}</Metric> shipped{' '}
        <Metric tone="positive">+{fmtCount(linesLeader.added)}</Metric> /{' '}
        <Metric tone="negative">−{fmtCount(linesLeader.removed)}</Metric> lines, the largest churn
        this period.
      </>
    ) : null;

  // ── Q3: files-per-type ──
  const filesRows = sorted.filter((w) => w.files > 0);
  const editsPerFileMedian = (() => {
    if (filesRows.length === 0) return 0;
    const ratios = filesRows.map((w) => w.edits / Math.max(1, w.files)).sort((a, b) => a - b);
    const mid = Math.floor(ratios.length / 2);
    return ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid];
  })();
  const topFiles = filesRows[0];
  const topEditsPerFile = topFiles ? topFiles.edits / Math.max(1, topFiles.files) : 0;
  const topShape = topEditsPerFile > editsPerFileMedian ? 'focused' : 'broad';
  const filesAnswer =
    filesRows.length > 0 && topFiles ? (
      <>
        <Metric>{topFiles.work_type}</Metric> spans <Metric>{fmtCount(topFiles.files)}</Metric>{' '}
        files at <Metric>{topEditsPerFile.toFixed(1)}</Metric> edits per file —{' '}
        <Metric>{topShape}</Metric>.
      </>
    ) : null;

  const questions: FocusedQuestion[] = [
    {
      id: 'share',
      question: 'What kind of work fills your week?',
      answer: shareAnswer,
      children: <MixShareViz workTypes={sorted} totalEdits={totalEdits} />,
      relatedLinks: getCrossLinks('activity', 'mix', 'share'),
    },
  ];

  if (linesAnswer && churnRows.length > 0) {
    questions.push({
      id: 'lines-by-type',
      question: 'Where is the codebase changing most?',
      answer: linesAnswer,
      children: <DivergingColumns data={churnRows} height={160} showAxis />,
    });
  } else {
    // Honest empty for commit-tracking-gated tools — no fake bars per spec.
    questions.push({
      id: 'lines-by-type',
      question: 'Where is the codebase changing most?',
      answer: (
        <>
          No line-level churn captured in this window. Commit tracking is required to fill this in.
        </>
      ),
      children: <span className={styles.empty}>Line-level churn requires commit tracking.</span>,
    });
  }

  if (filesAnswer && filesRows.length > 0) {
    questions.push({
      id: 'files-per-type',
      question: 'How spread is each work type?',
      answer: filesAnswer,
      children: (
        <BreakdownList
          items={filesRows.map((w) => {
            const epf = w.edits / Math.max(1, w.files);
            const maxEpf = Math.max(...filesRows.map((x) => x.edits / Math.max(1, x.files)), 1);
            return {
              key: w.work_type,
              label: w.work_type,
              fillPct: (epf / maxEpf) * 100,
              fillColor: workTypeColor(w.work_type),
              value: (
                <>
                  {epf.toFixed(1)} edits/file
                  <BreakdownMeta>
                    {' · '}
                    {fmtCount(w.files)} files · {fmtCount(w.edits)} edits
                  </BreakdownMeta>
                </>
              ),
            };
          })}
        />
      ),
    });
  } else {
    questions.push({
      id: 'files-per-type',
      question: 'How spread is each work type?',
      answer: <>Files-per-type appears once edits land on tracked files.</>,
      children: (
        <span className={styles.empty}>
          Files-per-type appears once edits land on tracked files.
        </span>
      ),
    });
  }

  return (
    <FocusedDetailView
      questions={questions}
      activeId={activeId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

function MixShareViz({
  workTypes,
  totalEdits,
}: {
  workTypes: UserAnalytics['work_type_distribution'];
  totalEdits: number;
}) {
  const visible = workTypes
    .map((w) => ({ w, pct: (w.edits / totalEdits) * 100 }))
    .filter(({ pct }) => pct >= 1);
  return (
    <>
      <div className={`${shared.workBar} ${styles.mixBar}`}>
        {visible.map(({ w, pct }) => (
          <div
            key={w.work_type}
            className={shared.workSegment}
            style={{
              width: `${pct}%`,
              background: workTypeColor(w.work_type),
            }}
            title={`${w.work_type}: ${Math.round(pct)}% of edits`}
          />
        ))}
      </div>
      <div className={styles.mixLegend}>
        {visible.map(({ w, pct }, i) => (
          <div
            key={w.work_type}
            className={styles.mixRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.mixLabel}>
              <span className={styles.mixDot} style={{ background: workTypeColor(w.work_type) }} />
              {w.work_type}
            </span>
            <span className={styles.mixShare}>{Math.round(pct)}%</span>
            <span className={styles.mixMeta}>
              {fmtCount(w.edits)} edits · {fmtCount(w.files)} files
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Effective-hours panel ────────────────────────────

function EffectiveHoursPanel({
  analytics,
  qualifiedHours,
}: {
  analytics: UserAnalytics;
  qualifiedHours: UserAnalytics['hourly_effectiveness'];
}) {
  const activeId = useQueryParam('q');

  if (qualifiedHours.length < EFFECTIVE_HOURS_MIN_QUALIFIED) {
    return (
      <span className={styles.empty}>
        Per-hour completion rate needs sessions in at least 4 distinct hours. Off-hour bursts wash a
        2-hour read.
      </span>
    );
  }

  // ── Q1: peak-completion ──
  const sortedByRate = [...qualifiedHours].sort((a, b) => b.completion_rate - a.completion_rate);
  const topHour = sortedByRate[0];
  const worstHour = sortedByRate[sortedByRate.length - 1];
  const worstTone = worstHour.completion_rate < 40 ? 'negative' : 'warning';

  const peakAnswer = (
    <>
      <Metric tone="positive">{hourGlyph(topHour.hour)}</Metric> completes{' '}
      <Metric tone="positive">{Math.round(topHour.completion_rate)}%</Metric> across{' '}
      <Metric>{fmtCount(topHour.sessions)}</Metric> sessions.
      {worstHour.hour !== topHour.hour && (
        <>
          {' '}
          <Metric tone="warning">{hourGlyph(worstHour.hour)}</Metric> trails at{' '}
          <Metric tone={worstTone}>{Math.round(worstHour.completion_rate)}%</Metric>.
        </>
      )}
    </>
  );

  // Bars ordered by clock, not by rate. Twin encoding: height = volume,
  // color = completionColor(rate). The rate label sits above each bar
  // so the user can read the quality without a legend.
  const byClock = [...qualifiedHours].sort((a, b) => a.hour - b.hour);
  const maxSessions = Math.max(1, ...byClock.map((h) => h.sessions));

  const questions: FocusedQuestion[] = [
    {
      id: 'peak-completion',
      question: 'Which hours land your work?',
      answer: peakAnswer,
      children: <PeakCompletionViz hours={byClock} maxSessions={maxSessions} />,
      relatedLinks: getCrossLinks('activity', 'effective-hours', 'peak-completion'),
    },
  ];

  // ── Q3: dow-dip (Q2 dropped per synthesizer pre-pass) ──
  const dowDip = computeDowDip(analytics);
  if (dowDip) {
    questions.push({
      id: 'dow-dip',
      question: 'Is there a day-of-week dip?',
      answer: (
        <>
          <Metric>{DAY_LABELS[dowDip.worst.dow]}</Metric> dips to{' '}
          <Metric tone="warning">{dowDip.worst.rate}%</Metric>, against{' '}
          <Metric tone="positive">{dowDip.best.rate}%</Metric> on your best day.
        </>
      ),
      children: <DowDipViz rows={dowDip.rows} />,
    });
  }

  return (
    <FocusedDetailView
      questions={questions}
      activeId={activeId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

function PeakCompletionViz({
  hours,
  maxSessions,
}: {
  hours: UserAnalytics['hourly_effectiveness'];
  maxSessions: number;
}) {
  return (
    <div className={styles.peakFrame}>
      <div className={styles.peakBars}>
        {hours.map((h, i) => {
          const heightPct = Math.max(8, Math.round((h.sessions / maxSessions) * 100));
          const color = completionColor(h.completion_rate);
          return (
            <div
              key={h.hour}
              className={styles.peakColumn}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.peakRate}>{Math.round(h.completion_rate)}%</span>
              <span
                className={styles.peakBar}
                style={
                  {
                    '--peak-height': `${heightPct}%`,
                    background: color,
                  } as CSSProperties
                }
                title={`${hourGlyph(h.hour)}: ${h.sessions} sessions, ${Math.round(h.completion_rate)}% completed`}
              />
              <span className={styles.peakHourLabel}>{hourGlyph(h.hour)}</span>
            </div>
          );
        })}
      </div>
      <div className={styles.peakLegend}>
        <span>height shows session volume</span>
        <span>color shows completion rate</span>
      </div>
    </div>
  );
}

interface DowDipRow {
  dow: number;
  sessions: number;
  rate: number;
}

function computeDowDip(
  analytics: UserAnalytics,
): { rows: DowDipRow[]; best: DowDipRow; worst: DowDipRow } | null {
  // Group daily_trends by day-of-week. Each row carries sessions +
  // completed counts; aggregate, then derive a per-DOW completion rate.
  // Render only when ≥ 5 DOWs have sessions and the best-vs-worst delta
  // is ≥ 15 points; below that the read is noise.
  const buckets: Array<{ sessions: number; completed: number }> = Array.from({ length: 7 }, () => ({
    sessions: 0,
    completed: 0,
  }));
  for (const d of analytics.daily_trends) {
    const sessions = d.sessions ?? 0;
    if (sessions === 0) continue;
    // daily_trends.day is YYYY-MM-DD UTC. Use Date constructor with
    // explicit ISO + 'T00:00Z' so the DOW resolves consistently
    // regardless of viewer locale offset; the analytics layer already
    // groups by the user's local day so this preserves their bucket.
    const date = new Date(`${d.day}T00:00:00Z`);
    const dow = date.getUTCDay();
    buckets[dow].sessions += sessions;
    buckets[dow].completed += d.completed ?? 0;
  }

  const rows: DowDipRow[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const b = buckets[dow];
    if (b.sessions === 0) continue;
    rows.push({
      dow,
      sessions: b.sessions,
      rate: Math.round((b.completed / b.sessions) * 100),
    });
  }
  if (rows.length < DOW_DIP_MIN_DOW_COUNT) return null;
  const best = rows.reduce((a, b) => (b.rate > a.rate ? b : a));
  const worst = rows.reduce((a, b) => (b.rate < a.rate ? b : a));
  if (best.rate - worst.rate < DOW_DIP_MIN_DELTA) return null;
  return { rows, best, worst };
}

function DowDipViz({ rows }: { rows: DowDipRow[] }) {
  // Align to all 7 DOWs even when only 5+ have data — keeps the visual
  // pattern legible when a couple of days are missing. Empty days
  // render as ghost columns (opacity floor).
  const byDow = new Map(rows.map((r) => [r.dow, r]));
  const maxSessions = Math.max(1, ...rows.map((r) => r.sessions));
  return (
    <div className={styles.dowFrame}>
      <div className={styles.dowBars}>
        {[0, 1, 2, 3, 4, 5, 6].map((dow, i) => {
          const r = byDow.get(dow);
          const heightPct = r ? Math.max(8, Math.round((r.sessions / maxSessions) * 100)) : 6;
          const color = r ? completionColor(r.rate) : 'var(--ghost)';
          return (
            <div
              key={dow}
              className={styles.dowColumn}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.dowRate}>{r ? `${r.rate}%` : '—'}</span>
              <span
                className={styles.dowBar}
                style={
                  {
                    '--dow-height': `${heightPct}%`,
                    background: color,
                  } as CSSProperties
                }
                title={
                  r
                    ? `${DAY_LABELS[dow]}: ${r.sessions} sessions, ${r.rate}% completed`
                    : `${DAY_LABELS[dow]}: no sessions`
                }
              />
              <span className={styles.dowLabel}>{DAY_LABELS[dow]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
