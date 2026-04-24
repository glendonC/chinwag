import { useMemo, type CSSProperties } from 'react';
import {
  DetailView,
  FocusedDetailView,
  Metric,
  type DetailTabDef,
  type FocusedQuestion,
} from '../../components/DetailView/index.js';
import RangePills from '../../components/RangePills/RangePills.jsx';
import { getToolMeta } from '../../lib/toolMeta.js';
import { arcPath } from '../../lib/svgArcs.js';
import { useTabs } from '../../hooks/useTabs.js';
import { setQueryParam, useQueryParam } from '../../lib/router.js';
import { COMPLETION_THRESHOLDS, completionColor, workTypeColor } from '../../widgets/utils.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import { RANGES, formatScope, type RangeDays } from './overview-utils.js';
import styles from './OutcomesDetailView.module.css';

/* OutcomesDetailView — "did the work land" at scale.
 *
 * Mirrors the UsageDetailView structure (DetailView shell, DetailSection
 * blocks, tab-driven panels) but answers a different question family:
 *
 *   sessions — completion health, stuckness, first edit, duration shape
 *   retries  — one-shot rate, scope complexity curve
 *   types    — work-type completion bars
 *
 * Deliberate duplication: DurationStrip lives here as well as in
 * UsageDetailView (the Sessions panel uses it there). Extracting it to
 * a shared primitive is the right next step once a third caller lands;
 * duplicating for v1 avoids premature refactor. */

const OUTCOMES_TABS = ['sessions', 'retries', 'types'] as const;
type OutcomesTab = (typeof OUTCOMES_TABS)[number];

function isOutcomesTab(value: string | null | undefined): value is OutcomesTab {
  return (OUTCOMES_TABS as readonly string[]).includes(value ?? '');
}

interface Props {
  analytics: UserAnalytics;
  initialTab?: string | null;
  onBack: () => void;
  rangeDays: RangeDays;
  onRangeChange: (next: RangeDays) => void;
}

function fmtCount(n: number): string {
  return n.toLocaleString();
}

const MISSING_DELTA = { text: '—', color: 'var(--soft)' } as const;

function formatRateDelta(
  current: number,
  previous: number | null | undefined,
  invert = false,
): { text: string; color: string } {
  if (previous == null || previous <= 0) return MISSING_DELTA;
  const d = current - previous;
  if (d === 0) return { text: '→0', color: 'var(--muted)' };
  const arrow = d > 0 ? '↑' : '↓';
  const magnitude = Math.abs(Math.round(d * 10) / 10);
  const isGood = invert ? d < 0 : d > 0;
  return {
    text: `${arrow}${magnitude}`,
    color: isGood ? 'var(--success)' : 'var(--danger)',
  };
}

export default function OutcomesDetailView({
  analytics,
  initialTab,
  onBack,
  rangeDays,
  onRangeChange,
}: Props) {
  const resolved: OutcomesTab = isOutcomesTab(initialTab) ? initialTab : 'sessions';
  const tabControl = useTabs(OUTCOMES_TABS, resolved);
  const { activeTab } = tabControl;

  const cs = analytics.completion_summary;
  const oneShot = analytics.tool_call_stats;
  const pc = analytics.period_comparison;

  const tabs: Array<DetailTabDef<OutcomesTab>> = [
    {
      id: 'sessions',
      label: 'Completion',
      value: cs.total_sessions > 0 ? `${Math.round(cs.completion_rate)}%` : '--',
      delta: formatRateDelta(cs.completion_rate, pc.previous?.completion_rate),
    },
    {
      id: 'retries',
      label: 'One-shot',
      value: oneShot.one_shot_sessions > 0 ? `${oneShot.one_shot_rate}%` : '--',
      delta: MISSING_DELTA,
    },
    {
      id: 'types',
      label: 'By work type',
      value: fmtCount(analytics.work_type_outcomes.length),
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
      title="outcomes"
      subtitle={scopeSubtitle}
      actions={<RangePills value={rangeDays} onChange={onRangeChange} options={RANGES} />}
      tabs={tabs}
      tabControl={tabControl}
      idPrefix="outcomes"
      tablistLabel="Outcomes sections"
    >
      {activeTab === 'sessions' && <SessionsPanel analytics={analytics} />}
      {activeTab === 'retries' && <RetriesPanel analytics={analytics} />}
      {activeTab === 'types' && <WorkTypesPanel analytics={analytics} />}
    </DetailView>
  );
}

// ── Sessions panel ──────────────────────────────────

function SessionsPanel({ analytics }: { analytics: UserAnalytics }) {
  const cs = analytics.completion_summary;
  const stuck = analytics.stuckness;
  const fe = analytics.first_edit_stats;
  const dd = analytics.duration_distribution;
  const outcomesSessionsActiveId = useQueryParam('q');

  if (cs.total_sessions === 0) {
    return <span className={styles.empty}>No sessions yet. Run one and drill back in.</span>;
  }

  const byTool = fe.by_tool.filter((t) => t.avg_minutes > 0).slice(0, 6);
  const durTotal = dd.reduce((s, b) => s + b.count, 0);

  // Tones: completion rate → positive, stuck rate → warning, time/count
  // neutral. Same vocabulary as UsageDetailView so the system reads as
  // one object across both detail views.
  const completionAnswer = (
    <>
      <Metric>{fmtCount(cs.completed)}</Metric> of <Metric>{fmtCount(cs.total_sessions)}</Metric>{' '}
      sessions completed (<Metric tone="positive">{Math.round(cs.completion_rate)}%</Metric>).
    </>
  );

  const stuckAnswer =
    stuck.stuck_sessions === 0 ? (
      <>No sessions hit the 15-minute stall threshold in this window.</>
    ) : (
      <>
        <Metric>{fmtCount(stuck.stuck_sessions)}</Metric> of{' '}
        <Metric>{fmtCount(stuck.total_sessions)}</Metric> sessions (
        <Metric tone="warning">{stuck.stuckness_rate}%</Metric>) stalled 15+ minutes.
        {stuck.stuck_sessions >= 5 && (
          <>
            {' '}
            <Metric>{stuck.stuck_completion_rate}%</Metric> of stuck sessions later completed.
          </>
        )}
      </>
    );

  const firstEditAnswer = (() => {
    if (fe.median_minutes_to_first_edit <= 0 && fe.avg_minutes_to_first_edit <= 0) return null;
    const median = formatMinutes(fe.median_minutes_to_first_edit);
    if (byTool.length > 1) {
      const minTool = formatMinutes(Math.min(...byTool.map((t) => t.avg_minutes)));
      const maxTool = formatMinutes(Math.max(...byTool.map((t) => t.avg_minutes)));
      return (
        <>
          Median time to first edit is <Metric>{median} min</Metric>, ranging{' '}
          <Metric>{minTool}</Metric>–<Metric>{maxTool} min</Metric> across{' '}
          <Metric>{byTool.length} tools</Metric>.
        </>
      );
    }
    return (
      <>
        Median time to first edit is <Metric>{median} min</Metric>.
      </>
    );
  })();

  const durationAnswer = (
    <>
      Distributed across <Metric>{fmtCount(durTotal)}</Metric> sessions with an outcome recorded.
    </>
  );

  const questions: FocusedQuestion[] = [
    {
      id: 'completion',
      question: "Did this period's sessions land?",
      answer: completionAnswer,
      children: <DetailRing cs={cs} />,
    },
    {
      id: 'stall',
      question: 'How often did agents stall?',
      answer: stuckAnswer,
      children: <StuckBlock stuck={stuck} />,
    },
  ];
  if (
    (fe.median_minutes_to_first_edit > 0 || fe.avg_minutes_to_first_edit > 0) &&
    firstEditAnswer
  ) {
    questions.push({
      id: 'first-edit',
      question: 'How fast did agents start editing?',
      answer: firstEditAnswer,
      children: <FirstEditBlock fe={fe} byTool={byTool} />,
    });
  }
  if (durTotal > 0) {
    questions.push({
      id: 'duration',
      question: 'How long did sessions run?',
      answer: durationAnswer,
      children: <DurationStrip buckets={dd} total={durTotal} />,
    });
  }

  return (
    <FocusedDetailView
      questions={questions}
      activeId={outcomesSessionsActiveId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

// ── Retries panel ───────────────────────────────────

function RetriesPanel({ analytics }: { analytics: UserAnalytics }) {
  const oneShot = analytics.tool_call_stats;
  const sc = analytics.scope_complexity.filter((b) => b.sessions > 0);
  const retriesActiveId = useQueryParam('q');

  if (oneShot.one_shot_sessions === 0 && sc.length < 2) {
    return (
      <span className={styles.empty}>
        One-shot success needs tool call logs (Claude Code today). Scope complexity needs at least
        two populated buckets.
      </span>
    );
  }

  const oneShotAnswer = (
    <>
      <Metric tone="positive">{oneShot.one_shot_rate}%</Metric> of{' '}
      <Metric>{fmtCount(oneShot.one_shot_sessions)}</Metric> sessions with tool call data landed
      their edits without a retry cycle.
    </>
  );

  const questions: FocusedQuestion[] = [];
  if (oneShot.one_shot_sessions > 0) {
    questions.push({
      id: 'one-shot',
      question: 'How often do edits work on the first try?',
      answer: oneShotAnswer,
      children: <OneShotBlock oneShot={oneShot} />,
    });
  }
  if (sc.length >= 2) {
    questions.push({
      id: 'scope',
      question: 'Does scope hurt completion?',
      answer: completionTrendSentence(sc),
      children: <ScopeCurve sc={sc} />,
    });
  }

  return (
    <FocusedDetailView
      questions={questions}
      activeId={retriesActiveId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

// ── Work-types panel ────────────────────────────────

function WorkTypesPanel({ analytics }: { analytics: UserAnalytics }) {
  const wto = analytics.work_type_outcomes;
  const wtActiveId = useQueryParam('q');

  if (wto.length === 0) {
    return (
      <span className={styles.empty}>
        Appears after sessions touch files. Each session is assigned its primary work type from the
        file set.
      </span>
    );
  }

  const worst = [...wto].sort((a, b) => a.completion_rate - b.completion_rate)[0];
  const best = [...wto].sort((a, b) => b.completion_rate - a.completion_rate)[0];

  const worstTone = worst.completion_rate < 40 ? 'negative' : 'warning';
  const answer = (
    <>
      <Metric>{best.work_type}</Metric> completes at{' '}
      <Metric tone="positive">{best.completion_rate}%</Metric>; <Metric>{worst.work_type}</Metric>{' '}
      trails at <Metric tone={worstTone}>{worst.completion_rate}%</Metric>.
    </>
  );

  const maxRate = Math.max(...wto.map((x) => x.completion_rate), 1);
  const questions: FocusedQuestion[] = [
    {
      id: 'finish',
      question: 'Which kinds of work finish?',
      answer,
      children: (
        <div className={styles.wtList}>
          {wto.map((w, i) => (
            <div
              key={w.work_type}
              className={styles.wtRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.wtLabel}>{w.work_type}</span>
              <div className={styles.wtBarTrack}>
                <div
                  className={styles.wtBarFill}
                  style={{
                    width: `${(w.completion_rate / maxRate) * 100}%`,
                    background: workTypeColor(w.work_type),
                  }}
                />
              </div>
              <span className={styles.wtValue}>
                {w.completion_rate}%
                <span className={styles.wtValueSoft}>{fmtCount(w.sessions)} sessions</span>
              </span>
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <FocusedDetailView
      questions={questions}
      activeId={wtActiveId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

// ── Viz components ──────────────────────────────────

const RING_CX = 110;
const RING_CY = 110;
const RING_R = 82;
const RING_SW = 12;
const RING_GAP_DEG = 14;

interface SliceDef {
  key: string;
  label: string;
  count: number;
  color: string;
  muted: boolean;
}

function DetailRing({ cs }: { cs: UserAnalytics['completion_summary'] }) {
  const allSlices: SliceDef[] = [
    {
      key: 'completed',
      label: 'completed',
      count: cs.completed,
      color: 'var(--success)',
      muted: false,
    },
    {
      key: 'abandoned',
      label: 'abandoned',
      count: cs.abandoned,
      color: 'var(--warn)',
      muted: false,
    },
    { key: 'failed', label: 'failed', count: cs.failed, color: 'var(--danger)', muted: false },
    { key: 'unknown', label: 'no outcome', count: cs.unknown, color: 'var(--ghost)', muted: true },
  ];
  const visibleSlices = allSlices.filter((s) => s.count > 0);
  const ringSlices = visibleSlices.filter((s) => !s.muted);

  // Functional reduce — `let cursor` with in-map mutation trips React
  // Compiler's immutability rule. Accumulate arcs + running cursor in
  // a single reduce pass, then read arcs off the end. No useMemo —
  // React Compiler auto-memos and the manual wrapper was tripping on
  // `ringSlices` being flagged as a possibly-mutated dependency.
  const total = ringSlices.reduce((s, x) => s + x.count, 0);
  const safeTotal = Math.max(1, total);
  const gaps = ringSlices.length > 1 ? ringSlices.length * RING_GAP_DEG : 0;
  const available = Math.max(0, 360 - gaps);
  const gap = ringSlices.length > 1 ? RING_GAP_DEG : 0;
  const arcs = ringSlices.reduce<{
    arcs: Array<(typeof ringSlices)[number] & { startDeg: number; sweepDeg: number }>;
    cursor: number;
  }>(
    (acc, slice) => {
      const sweep = (slice.count / safeTotal) * available;
      return {
        arcs: [...acc.arcs, { ...slice, startDeg: acc.cursor, sweepDeg: sweep }],
        cursor: acc.cursor + sweep + gap,
      };
    },
    { arcs: [], cursor: 0 },
  ).arcs;

  const rate = Math.round(cs.completion_rate);
  const unreported = cs.unknown;
  const showCaveat = unreported > 0 && unreported / cs.total_sessions > 0.3;

  return (
    <div className={styles.ringBlock}>
      <div className={styles.ringMedia}>
        <svg
          viewBox="0 0 220 220"
          className={styles.ringSvg}
          role="img"
          aria-label={`Completion rate ${rate}%`}
        >
          <circle
            cx={RING_CX}
            cy={RING_CY}
            r={RING_R}
            fill="none"
            stroke="var(--hover-bg)"
            strokeWidth={RING_SW}
          />
          {arcs
            .filter((a) => a.sweepDeg > 0.2)
            .map((a) => (
              <path
                key={a.key}
                d={arcPath(RING_CX, RING_CY, RING_R, a.startDeg, a.sweepDeg)}
                fill="none"
                stroke={a.color}
                strokeWidth={RING_SW}
                strokeLinecap="round"
                opacity={0.9}
              >
                <title>
                  {a.label}: {a.count}
                </title>
              </path>
            ))}
        </svg>
        <div className={styles.ringOverlay}>
          <span className={styles.ringValue}>
            {rate}
            <span className={styles.ringValueUnit}>%</span>
          </span>
          {showCaveat && (
            <span className={styles.ringCaveat}>
              {cs.total_sessions - cs.unknown} of {cs.total_sessions} reported
            </span>
          )}
        </div>
      </div>
      <div className={styles.ringLegend}>
        {visibleSlices.map((s, i) => {
          const share = cs.total_sessions > 0 ? Math.round((s.count / cs.total_sessions) * 100) : 0;
          return (
            <div
              key={s.key}
              className={styles.legendRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.legendDot} style={{ background: s.color }} />
              <span className={styles.legendLabel}>{s.label}</span>
              <span className={styles.legendCount}>{fmtCount(s.count)}</span>
              <span className={styles.legendShare}>{share}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StuckBlock({ stuck }: { stuck: UserAnalytics['stuckness'] }) {
  return (
    <div
      className={styles.stuckRow}
      title="A session is flagged stuck when its heartbeat stalls 15+ minutes while still open."
    >
      <span className={styles.stuckHero}>
        <span className={styles.stuckValue}>{stuck.stuckness_rate}</span>
        <span className={styles.stuckUnit}>%</span>
      </span>
      <div className={styles.stuckFacts}>
        <span className={styles.stuckFact}>
          <span className={styles.stuckFactValue}>{fmtCount(stuck.stuck_sessions)}</span> of{' '}
          {fmtCount(stuck.total_sessions)} sessions stalled
        </span>
        {stuck.stuck_sessions >= 5 && (
          <span className={styles.stuckFact}>
            <span className={styles.stuckFactValue}>{stuck.stuck_completion_rate}%</span> recovered
            to completed
          </span>
        )}
        <span className={styles.stuckFact}>15-minute heartbeat gap while still open</span>
      </div>
    </div>
  );
}

function FirstEditBlock({
  fe,
  byTool,
}: {
  fe: UserAnalytics['first_edit_stats'];
  byTool: Array<{ host_tool: string; avg_minutes: number; sessions: number }>;
}) {
  return (
    <div className={styles.firstEditBlock}>
      <span className={styles.feHero}>
        <span className={styles.feValue}>{formatMinutes(fe.median_minutes_to_first_edit)}</span>
        <span className={styles.feUnit}>min</span>
      </span>
      <div className={styles.feChips}>
        {fe.avg_minutes_to_first_edit > 0 &&
          fe.avg_minutes_to_first_edit !== fe.median_minutes_to_first_edit && (
            <span className={styles.feChip}>
              <span className={styles.feChipDot} style={{ background: 'var(--soft)' }} />
              <span className={styles.feChipLabel}>avg</span>
              <span className={styles.feChipValue}>
                {formatMinutes(fe.avg_minutes_to_first_edit)}m
              </span>
            </span>
          )}
        {byTool.map((t) => {
          const meta = getToolMeta(t.host_tool);
          return (
            <span key={t.host_tool} className={styles.feChip}>
              <span className={styles.feChipDot} style={{ background: meta.color }} />
              <span className={styles.feChipLabel}>{meta.label}</span>
              <span className={styles.feChipValue}>{formatMinutes(t.avg_minutes)}m</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function DurationStrip({
  buckets,
  total,
}: {
  buckets: UserAnalytics['duration_distribution'];
  total: number;
}) {
  return (
    <div className={styles.durationFrame}>
      <div className={styles.durationBar}>
        {buckets.map((b, i) => {
          if (b.count === 0) return null;
          const share = b.count / total;
          const pos = buckets.length > 1 ? i / (buckets.length - 1) : 0;
          const color = pos <= 0.33 ? 'var(--success)' : pos >= 0.66 ? 'var(--warn)' : 'var(--ink)';
          return (
            <div
              key={b.bucket}
              className={styles.durationSegment}
              style={{
                flex: `${share} 1 0`,
                background: color,
                opacity: 0.65,
              }}
              title={`${b.bucket}: ${b.count} (${Math.round(share * 100)}%)`}
            />
          );
        })}
      </div>
      <div className={styles.durationLegend}>
        {buckets.map((b) => {
          const share = total > 0 ? Math.round((b.count / total) * 100) : 0;
          return (
            <div key={b.bucket} className={styles.durationCell}>
              <span className={styles.durationBucket}>{b.bucket}</span>
              <span>
                <span className={styles.durationCount}>{fmtCount(b.count)}</span>
                <span className={styles.durationShare}>· {share}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OneShotBlock({ oneShot }: { oneShot: UserAnalytics['tool_call_stats'] }) {
  return (
    <div className={styles.stuckRow}>
      <span className={styles.stuckHero}>
        <span className={styles.stuckValue}>{oneShot.one_shot_rate}</span>
        <span className={styles.stuckUnit}>%</span>
      </span>
      <div className={styles.stuckFacts}>
        <span className={styles.stuckFact}>
          <span className={styles.stuckFactValue}>{fmtCount(oneShot.one_shot_sessions)}</span>{' '}
          sessions with tool call data
        </span>
        <span className={styles.stuckFact}>
          {fmtCount(oneShot.total_calls)} tool calls · {oneShot.error_rate}% errored
        </span>
        <span className={styles.stuckFact}>
          Detected via Edit → Bash → Edit retry patterns in Claude Code JSONL
        </span>
      </div>
    </div>
  );
}

const CURVE_W = 600;
const CURVE_H = 220;
const CURVE_PAD = { top: 16, right: 20, bottom: 8, left: 44 };

function ScopeCurve({ sc }: { sc: UserAnalytics['scope_complexity'] }) {
  const plotW = CURVE_W - CURVE_PAD.left - CURVE_PAD.right;
  const plotH = CURVE_H - CURVE_PAD.top - CURVE_PAD.bottom;

  const points = sc.map((b, i) => {
    const x = CURVE_PAD.left + (sc.length === 1 ? plotW / 2 : (i / (sc.length - 1)) * plotW);
    const y = CURVE_PAD.top + (1 - Math.min(1, b.completion_rate / 100)) * plotH;
    return { x, y, bucket: b.bucket, rate: b.completion_rate, sessions: b.sessions };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${CURVE_PAD.top + plotH} L${points[0].x},${CURVE_PAD.top + plotH} Z`;
  const gridLines = [0, COMPLETION_THRESHOLDS.warning, COMPLETION_THRESHOLDS.good, 100];

  return (
    <div className={styles.curveBlock}>
      <div className={styles.curveMedia}>
        <svg
          viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
          className={styles.curveSvg}
          role="img"
          aria-label="Completion rate by scope bucket"
        >
          {gridLines.map((pct) => {
            const y = CURVE_PAD.top + (1 - pct / 100) * plotH;
            return (
              <g key={pct}>
                <line
                  x1={CURVE_PAD.left}
                  y1={y}
                  x2={CURVE_W - CURVE_PAD.right}
                  y2={y}
                  className={styles.curveGrid}
                />
                <text
                  x={CURVE_PAD.left - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="central"
                  className={styles.curveAxis}
                >
                  {pct}
                </text>
              </g>
            );
          })}
          <path d={areaPath} className={styles.curveArea} />
          <path d={linePath} className={styles.curveLine} />
          {points.map((p) => (
            <circle
              key={p.bucket}
              cx={p.x}
              cy={p.y}
              r={6}
              className={styles.curveDot}
              style={{ stroke: completionColor(p.rate) }}
            >
              <title>
                {p.bucket}: {p.rate}% · {p.sessions} sessions
              </title>
            </circle>
          ))}
        </svg>
      </div>
      <div
        className={styles.curveLabels}
        style={{ paddingLeft: CURVE_PAD.left, paddingRight: CURVE_PAD.right }}
      >
        {points.map((p) => (
          <div key={p.bucket} className={styles.curveLabelCell}>
            <span className={styles.curveBucketLabel}>{p.bucket}</span>
            <span className={styles.curveSessionCount}>{fmtCount(p.sessions)} sessions</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Copy helpers ────────────────────────────────────

function formatMinutes(n: number): string {
  if (n >= 10) return String(Math.round(n));
  return n.toFixed(1);
}

function completionTrendSentence(sc: UserAnalytics['scope_complexity']): string {
  const first = sc[0];
  const last = sc[sc.length - 1];
  const diff = last.completion_rate - first.completion_rate;
  if (Math.abs(diff) < 5) {
    return `Completion holds roughly flat across scope: ${first.completion_rate}% at ${first.bucket}, ${last.completion_rate}% at ${last.bucket}.`;
  }
  if (diff < 0) {
    return `Completion drops from ${first.completion_rate}% at ${first.bucket} to ${last.completion_rate}% at ${last.bucket}. Larger scope sessions fail more.`;
  }
  return `Completion rises from ${first.completion_rate}% at ${first.bucket} to ${last.completion_rate}% at ${last.bucket} — wider scope doesn't hurt in this window.`;
}
