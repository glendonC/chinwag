import { useMemo, type CSSProperties } from 'react';
import clsx from 'clsx';
import {
  BreakdownList,
  BreakdownMeta,
  DetailSection,
  DetailView,
  FileList,
  type DetailTabDef,
} from '../../components/DetailView/index.js';
import RangePills from '../../components/RangePills/RangePills.jsx';
import ToolIcon from '../../components/ToolIcon/ToolIcon.js';
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

const USAGE_TABS = ['sessions', 'edits', 'cost', 'cost-per-edit', 'files-touched'] as const;
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

function deltaMark(
  current: number,
  previous: number | null | undefined,
  invert = false,
): { arrow: string; color: string; magnitude: string } | null {
  if (previous == null || previous === 0) return null;
  const d = current - previous;
  if (d === 0) return { arrow: '→', color: 'var(--muted)', magnitude: '0' };
  const isGood = invert ? d < 0 : d > 0;
  return {
    arrow: d > 0 ? '↑' : '↓',
    color: isGood ? 'var(--success)' : 'var(--danger)',
    magnitude: String(Math.abs(Math.round(d * 10) / 10)),
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
    const cost = analytics.token_usage.total_estimated_cost_usd;
    const cpe = analytics.token_usage.cost_per_edit;
    const filesTouched = analytics.files_touched_total;
    return { sessions, edits, cost, cpe, filesTouched };
  }, [analytics]);

  const resolvedInitialTab: UsageTab = isUsageTab(initialTab) ? initialTab : 'sessions';
  const tabControl = useTabs(USAGE_TABS, resolvedInitialTab);
  const { activeTab } = tabControl;

  const tabs: Array<DetailTabDef<UsageTab>> = [
    { id: 'sessions', label: 'Sessions', value: fmtCount(totals.sessions) },
    { id: 'edits', label: 'Edits', value: fmtCount(totals.edits) },
    {
      id: 'cost',
      label: 'Cost',
      value: hasCostData(analytics.token_usage) ? formatCost(totals.cost, 2) : '--',
    },
    {
      id: 'cost-per-edit',
      label: 'Cost / edit',
      value:
        hasCostData(analytics.token_usage) && totals.cpe != null ? formatCost(totals.cpe, 3) : '--',
    },
    { id: 'files-touched', label: 'Files', value: fmtCount(totals.filesTouched) },
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
  const pc = analytics.period_comparison;
  const d = deltaMark(pc.current.total_sessions, pc.previous?.total_sessions ?? null);
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

  // Hero row — promoted from a mono byline to first-class stat blocks.
  // `completion_rate` and `stuckness_rate` arrive pre-multiplied from the
  // backend (percent form, e.g. 73.3 not 0.733). Each block is gated so
  // we never render "0%" when the system has no data. The `sublabel` line
  // carries a concrete ratio, and ratio-based stats get a dot-matrix viz
  // (one dot per session, filled = hits the condition) so the number has
  // literal visual reference beside it.
  const heroStats: Array<{
    key: string;
    value: string;
    unit?: string;
    label: string;
    sublabel?: string;
    color: string;
    viz?: { total: number; filled: number; color: string };
  }> = [];
  if (cs.total_sessions > 0 && cs.completion_rate > 0) {
    heroStats.push({
      key: 'completed',
      value: String(Math.round(cs.completion_rate)),
      unit: '%',
      label: 'completed',
      sublabel: `${fmtCount(cs.completed)} of ${fmtCount(cs.total_sessions)} sessions`,
      color: 'var(--success)',
      viz: { total: cs.total_sessions, filled: cs.completed, color: 'var(--success)' },
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
      viz: { total: stuck.total_sessions, filled: stuck.stuck_sessions, color },
    });
  }
  if (firstEdit.median_minutes_to_first_edit > 0) {
    const m = firstEdit.median_minutes_to_first_edit;
    const v = m >= 10 ? String(Math.round(m)) : m.toFixed(1);
    heroStats.push({
      key: 'first-edit',
      value: v,
      unit: 'min',
      label: 'median to first edit',
      sublabel: totalSessions > 0 ? `across ${fmtCount(totalSessions)} sessions` : undefined,
      color: 'var(--ink)',
    });
  }

  const hasHero = heroStats.length > 0 || d != null;

  return (
    <>
      {/* Top grid: hero stats (left) + tool share (right). Both sit at the
          fold, establishing the session story: what happened (hero) and
          where (by tool). Session duration lives below as its own full
          width band since it answers a different question (how long). */}
      {(hasHero || byTool.length > 0) && (
        <div className={styles.topGrid}>
          {hasHero && (
            <DetailSection label="Session health" className={styles.sectionHero}>
              <div className={styles.heroRow}>
                {heroStats.map((s, i) => (
                  <div
                    key={s.key}
                    className={styles.heroStat}
                    style={{ '--row-index': i } as CSSProperties}
                  >
                    {s.viz && <DotMatrix {...s.viz} />}
                    <div className={styles.heroStatText}>
                      <span className={styles.heroStatValue} style={{ color: s.color }}>
                        {s.value}
                        {s.unit && <span className={styles.heroStatUnit}>{s.unit}</span>}
                      </span>
                      <span className={styles.heroStatLabel}>{s.label}</span>
                      {s.sublabel && <span className={styles.heroStatSub}>{s.sublabel}</span>}
                    </div>
                  </div>
                ))}
                {d && (
                  <div
                    className={styles.heroStat}
                    style={{ '--row-index': heroStats.length } as CSSProperties}
                  >
                    <div className={styles.heroStatText}>
                      <span className={styles.heroStatValue} style={{ color: d.color }}>
                        {d.arrow}
                        {d.magnitude}
                      </span>
                      <span className={styles.heroStatLabel}>vs prior period</span>
                    </div>
                  </div>
                )}
              </div>
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

      {/* Session duration — full-width band */}
      {durationDist.length > 0 && (
        <DetailSection label="Session duration">
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
const RING_GAP_DEG = 4;

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
    let cursor = 0;
    const safeTotal = Math.max(1, total);
    // Fold tiny slices under 3% into the tail so we don't render specks.
    // They still appear in the table.
    const visible = entries.filter((e) => e.sessions / safeTotal >= 0.03);
    const gaps = visible.length > 1 ? visible.length * RING_GAP_DEG : 0;
    const available = Math.max(0, 360 - gaps);
    for (const e of visible) {
      const sweep = (e.sessions / safeTotal) * available;
      if (sweep > 0.2) {
        out.push({
          tool: e.host_tool,
          color: getToolMeta(e.host_tool).color,
          startDeg: cursor,
          sweepDeg: sweep,
          sessions: e.sessions,
        });
      }
      cursor += sweep + RING_GAP_DEG;
    }
    return out;
  }, [entries, total]);

  // Single-tool case: SVG arc with start === end renders nothing, so we
  // paint the full ring as a plain <circle> instead of a zero-length arc.
  // For multi-tool case, each arc sprouts a short radial leader stub — the
  // Tools-tab arc-connector vocabulary, scaled down for this compact ring.
  const singleArc = arcs.length === 1 ? arcs[0] : null;
  const LEADER_OUT = 9;

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
          {singleArc ? (
            <circle
              cx={RING_CX}
              cy={RING_CY}
              r={RING_R}
              fill="none"
              stroke={singleArc.color}
              strokeWidth={RING_SW}
              opacity={0.9}
            />
          ) : (
            arcs.map((arc) => {
              const midDeg = arc.startDeg + arc.sweepDeg / 2;
              const midRad = ((midDeg - 90) * Math.PI) / 180;
              const ax = RING_CX + (RING_R + RING_SW / 2) * Math.cos(midRad);
              const ay = RING_CY + (RING_R + RING_SW / 2) * Math.sin(midRad);
              const bx = RING_CX + (RING_R + RING_SW / 2 + LEADER_OUT) * Math.cos(midRad);
              const by = RING_CY + (RING_R + RING_SW / 2 + LEADER_OUT) * Math.sin(midRad);
              return (
                <g key={arc.tool}>
                  <path
                    d={arcPath(RING_CX, RING_CY, RING_R, arc.startDeg, arc.sweepDeg)}
                    fill="none"
                    stroke={arc.color}
                    strokeWidth={RING_SW}
                    strokeLinecap="round"
                    opacity={0.9}
                  />
                  <line
                    x1={ax}
                    y1={ay}
                    x2={bx}
                    y2={by}
                    stroke={arc.color}
                    strokeWidth={1.25}
                    opacity={0.7}
                  />
                </g>
              );
            })
          )}
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

// One dot per session. Filled = hits the condition (stalled, completed).
// Grid wraps at 10 columns and grows downward. Caps visible dots at 120
// to keep the viz compact on huge periods — at that scale the big number
// carries the signal and the matrix is a density indicator more than a
// literal count.
function DotMatrix({ total, filled, color }: { total: number; filled: number; color: string }) {
  const MAX = 200;
  const COLS = 15;
  const safeTotal = Math.min(total, MAX);
  const safeFilled = Math.min(filled, safeTotal);
  const dots = Array.from({ length: safeTotal }, (_, i) => i < safeFilled);
  const capped = total > MAX;
  return (
    <div
      className={styles.dotMatrix}
      style={{ gridTemplateColumns: `repeat(${COLS}, 9px)` } as CSSProperties}
      aria-label={
        capped
          ? `${filled} of ${total} sessions (showing first ${MAX})`
          : `${filled} of ${total} sessions`
      }
      role="img"
    >
      {dots.map((isFilled, i) => (
        <span
          key={i}
          className={styles.dot}
          style={{
            background: isFilled ? color : 'transparent',
            borderColor: isFilled ? 'transparent' : 'var(--soft)',
          }}
        />
      ))}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className={styles.outcomeItem}>
      <span className={styles.outcomeDot} style={{ background: color }} />
      <span className={styles.outcomeLabel}>{label}</span>
    </div>
  );
}

function LegendHatch({ label }: { label: string }) {
  return (
    <div className={styles.outcomeItem}>
      <span className={clsx(styles.outcomeDot, styles.outcomeDotHatch)} aria-hidden="true" />
      <span className={styles.outcomeLabel}>{label}</span>
    </div>
  );
}

function formatStripDate(iso: string): string {
  // YYYY-MM-DD → MM-DD, keep mono-friendly
  if (iso.length >= 10) return iso.slice(5);
  return iso;
}

// ── Edits tab ────────────────────────────────────

function EditsPanel({ analytics }: { analytics: UserAnalytics }) {
  const total = analytics.daily_trends.reduce((s, d) => s + d.edits, 0);
  const dailyEdits = analytics.daily_trends.map((d) => d.edits);
  const byTool = [...analytics.tool_comparison]
    .filter((t) => t.total_edits > 0)
    .sort((a, b) => b.total_edits - a.total_edits);
  const maxEdits = Math.max(1, ...byTool.map((t) => t.total_edits));

  // Per-tool, per-teammate, and per-project velocity all reconcile with the
  // edit-velocity widget: same completed-session denominator
  // (total_session_hours) as queryEditVelocity. Each section is hidden when
  // the substrate is thin (< 2 entries) — the aggregate sparkline already
  // answers the question at that scale.
  const byToolVelocity = byTool
    .filter((t) => t.total_session_hours > 0)
    .map((t) => ({
      host_tool: t.host_tool,
      rate: t.total_edits / t.total_session_hours,
      hours: t.total_session_hours,
    }))
    .sort((a, b) => b.rate - a.rate);
  const maxToolVelocity = Math.max(0.001, ...byToolVelocity.map((v) => v.rate));

  const byMemberVelocity = [...analytics.member_analytics]
    .filter((m) => m.total_session_hours > 0 && m.total_edits > 0)
    .map((m) => ({
      handle: m.handle,
      primary_tool: m.primary_tool,
      rate: m.total_edits / m.total_session_hours,
      hours: m.total_session_hours,
    }))
    .sort((a, b) => b.rate - a.rate);
  const maxMemberVelocity = Math.max(0.001, ...byMemberVelocity.map((v) => v.rate));

  const byProjectVelocity = [...analytics.per_project_velocity]
    .filter((p) => p.total_session_hours > 0 && p.total_edits > 0)
    .sort((a, b) => b.edits_per_hour - a.edits_per_hour);
  const maxProjectVelocity = Math.max(0.001, ...byProjectVelocity.map((p) => p.edits_per_hour));

  const topFiles = [...analytics.file_heatmap]
    .sort((a, b) => b.touch_count - a.touch_count)
    .slice(0, 10);

  if (total === 0) {
    return <span className={styles.empty}>No edits captured in this window.</span>;
  }

  return (
    <>
      {byTool.length > 0 && (
        <DetailSection label="By tool">
          <BreakdownList
            items={byTool.map((t) => {
              const meta = getToolMeta(t.host_tool);
              return {
                key: t.host_tool,
                label: (
                  <>
                    <ToolIcon tool={t.host_tool} size={14} />
                    {meta.label}
                  </>
                ),
                fillPct: (t.total_edits / maxEdits) * 100,
                fillColor: meta.color,
                value: fmtCount(t.total_edits),
              };
            })}
          />
        </DetailSection>
      )}

      {byToolVelocity.length >= 2 && (
        <DetailSection label="Edits per hour · by tool">
          <BreakdownList
            items={byToolVelocity.map((v) => {
              const meta = getToolMeta(v.host_tool);
              return {
                key: v.host_tool,
                label: (
                  <>
                    <ToolIcon tool={v.host_tool} size={14} />
                    {meta.label}
                  </>
                ),
                fillPct: (v.rate / maxToolVelocity) * 100,
                fillColor: meta.color,
                value: (
                  <>
                    {v.rate.toFixed(1)} /hr
                    <BreakdownMeta> · {v.hours.toFixed(1)}h logged</BreakdownMeta>
                  </>
                ),
              };
            })}
          />
        </DetailSection>
      )}

      {byMemberVelocity.length >= 2 && (
        <DetailSection label="Edits per hour · by teammate">
          <BreakdownList
            items={byMemberVelocity.map((v) => ({
              key: v.handle,
              label: (
                <>
                  {v.primary_tool && <ToolIcon tool={v.primary_tool} size={14} />}
                  {v.handle}
                </>
              ),
              fillPct: (v.rate / maxMemberVelocity) * 100,
              value: (
                <>
                  {v.rate.toFixed(1)} /hr
                  <BreakdownMeta> · {v.hours.toFixed(1)}h logged</BreakdownMeta>
                </>
              ),
            }))}
          />
        </DetailSection>
      )}

      {byProjectVelocity.length >= 2 && (
        <DetailSection label="Edits per hour · by project">
          <BreakdownList
            items={byProjectVelocity.map((p) => ({
              key: p.team_id,
              label: (
                <>
                  {p.primary_tool && <ToolIcon tool={p.primary_tool} size={14} />}
                  {p.team_name ?? p.team_id}
                </>
              ),
              fillPct: (p.edits_per_hour / maxProjectVelocity) * 100,
              value: (
                <>
                  {p.edits_per_hour.toFixed(1)} /hr
                  <BreakdownMeta> · {p.total_session_hours.toFixed(1)}h logged</BreakdownMeta>
                </>
              ),
            }))}
          />
        </DetailSection>
      )}

      {topFiles.length > 0 && (
        <DetailSection label="Most-touched files">
          <FileList
            items={topFiles.map((f) => ({
              key: f.file,
              name: f.file,
              title: f.file,
              meta: `${fmtCount(f.touch_count)} touches`,
            }))}
          />
        </DetailSection>
      )}

      {dailyEdits.length >= 2 && (
        <DetailSection label="Daily trend">
          <div className={styles.trendFrame}>
            <Sparkline data={dailyEdits} height={96} />
          </div>
        </DetailSection>
      )}
    </>
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

function FilesTouchedPanel({ analytics }: { analytics: UserAnalytics }) {
  const files = analytics.file_heatmap;
  const dirs = [...analytics.directory_heatmap].sort((a, b) => b.touch_count - a.touch_count);
  const topFiles = [...files].sort((a, b) => b.touch_count - a.touch_count).slice(0, 15);
  const rework = [...analytics.file_rework]
    .filter((r) => r.rework_ratio > 0)
    .sort((a, b) => b.rework_ratio - a.rework_ratio)
    .slice(0, 8);

  const maxDir = Math.max(1, ...dirs.map((d) => d.touch_count));

  if (files.length === 0) {
    return <span className={styles.empty}>No files touched in this window.</span>;
  }

  return (
    <>
      {dirs.length > 0 && (
        <DetailSection label="By directory">
          <BreakdownList
            items={dirs.map((d) => ({
              key: d.directory,
              label: d.directory,
              fillPct: (d.touch_count / maxDir) * 100,
              value: (
                <>
                  {fmtCount(d.touch_count)}
                  <BreakdownMeta> · {d.file_count} files</BreakdownMeta>
                </>
              ),
            }))}
          />
        </DetailSection>
      )}

      {topFiles.length > 0 && (
        <DetailSection label="Most-touched files">
          <FileList
            items={topFiles.map((f) => ({
              key: f.file,
              name: f.file,
              title: f.file,
              meta: `${fmtCount(f.touch_count)} touches`,
            }))}
          />
        </DetailSection>
      )}

      {rework.length > 0 && (
        <DetailSection label="Highest rework ratio">
          <FileList
            items={rework.map((r) => ({
              key: r.file,
              name: r.file,
              title: r.file,
              meta: `${fmtPct(r.rework_ratio, 1)} rework · ${fmtCount(r.total_edits)} edits`,
            }))}
          />
        </DetailSection>
      )}
    </>
  );
}
