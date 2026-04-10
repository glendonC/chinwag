import { useMemo, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { usePollingStore, forceRefresh } from '../../lib/stores/polling.js';
import { useAuthStore } from '../../lib/stores/auth.js';
import { useTeamStore } from '../../lib/stores/teams.js';
import { getColorHex, formatDuration } from '../../lib/utils.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { useUserAnalytics } from '../../hooks/useUserAnalytics.js';
import { useConversationAnalytics } from '../../hooks/useConversationAnalytics.js';
import GlobalMap from '../../components/GlobalMap/GlobalMap.js';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import StatusState from '../../components/StatusState/StatusState.jsx';
import {
  ShimmerText,
  SkeletonStatGrid,
  SkeletonRows,
} from '../../components/Skeleton/Skeleton.jsx';
import { summarizeList } from '../../lib/summarize.js';
import { useGlobalStats } from '../../hooks/useGlobalStats.js';
import { useOverviewData } from './useOverviewData.js';
import type {
  UserAnalytics,
  ToolComparison,
  DurationBucket,
  WorkTypeDistribution,
  DailyTrend,
  HourlyBucket,
  EditVelocityTrend,
  FileHeatmapEntry,
  FileChurnEntry,
  ConcurrentEditEntry,
  MemberAnalytics,
  RetryPattern,
  ConflictCorrelation,
  MemoryUsageStats,
  WorkTypeOutcome,
  ConversationEditCorrelation,
  FileReworkEntry,
  DirectoryHeatmapEntry,
  StucknessStats,
  FileOverlapStats,
  AuditStalenessEntry,
  FirstEditStats,
  MemoryOutcomeCorrelation,
  MemoryAccessEntry,
  ConversationAnalytics,
  ScopeComplexityBucket,
  PromptEfficiencyTrend,
  HourlyEffectiveness,
  OutcomeTagCount,
  ToolHandoff,
  OutcomePredictor,
  PeriodComparison,
  TokenUsageStats,
} from '../../lib/apiSchemas.js';
import styles from './OverviewView.module.css';

// ── Constants ─────────────────────────────────────

const RANGES = [7, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];

const WORK_TYPE_COLORS: Record<string, string> = {
  frontend: '#5878ff',
  backend: '#34d68a',
  test: '#ffb366',
  styling: '#a585ff',
  docs: '#7e7af0',
  config: '#ff8a7a',
  other: '#98989d',
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── SVG Micro-components ──────────────────────────

function RingChart({
  completed,
  abandoned,
  failed,
  size = 48,
  stroke = 4,
}: {
  completed: number;
  abandoned: number;
  failed: number;
  size?: number;
  stroke?: number;
}) {
  const total = completed + abandoned + failed;
  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={styles.ring}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={(size - stroke) / 2}
          fill="none"
          stroke="var(--ghost)"
          strokeWidth={stroke}
        />
      </svg>
    );
  }

  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const gap = 4; // gap in pixels between segments
  const gapAngle = (gap / circumference) * 360;
  const segments = [
    { ratio: completed / total, color: 'var(--success)' },
    { ratio: abandoned / total, color: 'var(--warn)' },
    { ratio: failed / total, color: 'var(--danger)' },
  ].filter((s) => s.ratio > 0);

  let offset = -90; // start at top

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={styles.ring}>
      {segments.map((seg, i) => {
        const angle = seg.ratio * 360 - (segments.length > 1 ? gapAngle : 0);
        const dashLength = (angle / 360) * circumference;
        const dashGap = circumference - dashLength;
        const rotation = offset;
        offset += seg.ratio * 360;
        return (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            strokeDasharray={`${dashLength} ${dashGap}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(${rotation} ${size / 2} ${size / 2})`}
            opacity={0.7}
          />
        );
      })}
    </svg>
  );
}

function Sparkline({
  data,
  width = 300,
  height = 48,
}: {
  data: number[];
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;

  const max = Math.max(...data, 1);
  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - (v / max) * (height - 4) - 2,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={styles.trendSvg}
    >
      <path d={areaPath} className={styles.trendArea} />
      <path d={linePath} className={styles.trendLine} />
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={2.5}
          className={styles.trendDot}
        />
      )}
    </svg>
  );
}

// ── Helpers ────────────────────────────────────────

function summarizeNames(items: Array<{ team_id?: string; team_name?: string }>): string {
  const names = items.map((item) => item?.team_name || item?.team_id).filter(Boolean) as string[];
  return summarizeList(names);
}

function computeCompletionRates(trends: DailyTrend[]): number[] {
  return trends.map((d) => {
    const total = d.sessions;
    if (total === 0) return 0;
    return Math.round(((d.completed ?? 0) / total) * 100);
  });
}

function aggregateModels(
  modelOutcomes: Array<{
    agent_model: string;
    outcome: string;
    count: number;
    avg_duration_min: number;
    total_edits: number;
    total_lines_added: number;
    total_lines_removed: number;
  }>,
): Array<{
  model: string;
  completed: number;
  total: number;
  rate: number;
  avgMin: number;
  edits: number;
  linesAdded: number;
  linesRemoved: number;
}> {
  const map = new Map<
    string,
    {
      completed: number;
      total: number;
      durationSum: number;
      edits: number;
      linesAdded: number;
      linesRemoved: number;
    }
  >();
  for (const m of modelOutcomes) {
    const existing = map.get(m.agent_model) || {
      completed: 0,
      total: 0,
      durationSum: 0,
      edits: 0,
      linesAdded: 0,
      linesRemoved: 0,
    };
    existing.total += m.count;
    if (m.outcome === 'completed') existing.completed += m.count;
    existing.durationSum += m.avg_duration_min * m.count;
    existing.edits += m.total_edits;
    existing.linesAdded += m.total_lines_added;
    existing.linesRemoved += m.total_lines_removed;
    map.set(m.agent_model, existing);
  }
  return [...map.entries()]
    .map(([model, v]) => ({
      model,
      completed: v.completed,
      total: v.total,
      rate: v.total > 0 ? Math.round((v.completed / v.total) * 1000) / 10 : 0,
      avgMin: v.total > 0 ? Math.round((v.durationSum / v.total) * 10) / 10 : 0,
      edits: v.edits,
      linesAdded: v.linesAdded,
      linesRemoved: v.linesRemoved,
    }))
    .sort((a, b) => b.total - a.total);
}

function buildHeatmapData(hourly: HourlyBucket[]): { grid: number[][]; max: number } {
  // grid[dow][hour] = session count
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let max = 0;
  for (const h of hourly) {
    grid[h.dow][h.hour] = (grid[h.dow][h.hour] || 0) + h.sessions;
    if (grid[h.dow][h.hour] > max) max = grid[h.dow][h.hour];
  }
  return { grid, max };
}

// ── Section Components ────────────────────────────

function HeadlineSection({
  analytics,
  projectCount,
  liveAgentCount,
}: {
  analytics: UserAnalytics;
  projectCount: number;
  liveAgentCount: number;
}) {
  const { completion_summary: cs } = analytics;
  const totalSessions = analytics.daily_trends.reduce((s, d) => s + d.sessions, 0);
  const toolCount = analytics.tool_distribution.length;

  const delta =
    cs.prev_completion_rate != null
      ? Math.round((cs.completion_rate - cs.prev_completion_rate) * 10) / 10
      : null;

  const sparkData = computeCompletionRates(analytics.daily_trends);

  return (
    <div className={styles.section}>
      <div className={styles.headline}>
        <div className={styles.headlineRate}>
          <div className={styles.headlineNumber}>
            {cs.total_sessions > 0 ? `${cs.completion_rate}` : '--'}
            <span className={styles.headlineUnit}>%</span>
          </div>
          <span className={styles.headlineUnit}>completion rate</span>
          {delta != null && (
            <span
              className={clsx(
                styles.headlineDelta,
                delta > 0 && styles.deltaUp,
                delta < 0 && styles.deltaDown,
                delta === 0 && styles.deltaNeutral,
              )}
            >
              {delta > 0 ? '+' : ''}
              {delta}% from last period
            </span>
          )}
        </div>

        <div className={styles.headlineContext}>
          <div className={styles.contextStat}>
            <span className={styles.contextValue}>{totalSessions}</span>
            <span className={styles.contextLabel}>sessions</span>
          </div>
          <div className={styles.contextStat}>
            <span className={styles.contextValue}>{toolCount}</span>
            <span className={styles.contextLabel}>tools</span>
          </div>
          <div className={styles.contextStat}>
            <span className={styles.contextValue}>{projectCount}</span>
            <span className={styles.contextLabel}>projects</span>
          </div>
          {liveAgentCount > 0 && (
            <div className={styles.contextStat}>
              <span className={styles.contextValue}>{liveAgentCount}</span>
              <span className={styles.contextLabel}>live</span>
            </div>
          )}
        </div>

        {sparkData.length > 1 && (
          <div className={styles.headlineSparkline}>
            <Sparkline data={sparkData} />
          </div>
        )}
      </div>
    </div>
  );
}

function LiveAgentsBar({
  liveAgents,
  selectTeam,
}: {
  liveAgents: Array<{
    handle: string;
    host_tool: string;
    session_minutes: number | null;
    teamId: string;
  }>;
  selectTeam: (id: string) => void;
}) {
  if (liveAgents.length === 0) return null;
  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Live now</span>
      <div className={styles.liveBar}>
        {liveAgents.map((a, i) => {
          const meta = getToolMeta(a.host_tool);
          return (
            <button
              key={`${a.handle}-${i}`}
              className={styles.liveAgent}
              onClick={() => selectTeam(a.teamId)}
              type="button"
            >
              <span className={styles.liveDot} style={{ background: meta.color }} />
              <span className={styles.liveHandle}>{a.handle}</span>
              <span className={styles.liveMeta}>{meta.label}</span>
              {a.session_minutes != null && a.session_minutes > 0 && (
                <span className={styles.liveDuration}>{formatDuration(a.session_minutes)}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ToolComparisonSection({ tools }: { tools: ToolComparison[] }) {
  if (tools.length === 0) return null;
  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Tool effectiveness</span>
      <div className={styles.toolGrid}>
        {tools.map((t, i) => {
          const meta = getToolMeta(t.host_tool);
          return (
            <div
              key={t.host_tool}
              className={styles.toolColumn}
              style={{ '--col-index': i } as CSSProperties}
            >
              <div className={styles.toolName}>
                {meta.icon ? (
                  <span className={styles.toolIcon}>
                    <img src={meta.icon} alt="" />
                  </span>
                ) : (
                  <span className={styles.toolIconLetter} style={{ background: meta.color }}>
                    {meta.label[0]}
                  </span>
                )}
                <span className={styles.toolLabel}>{meta.label}</span>
              </div>
              <div className={styles.toolRingRow}>
                <RingChart
                  completed={t.completed}
                  abandoned={t.abandoned}
                  failed={t.failed}
                  size={44}
                  stroke={3.5}
                />
                <div>
                  <span className={styles.toolRate}>{t.completion_rate}</span>
                  <span className={styles.toolRateUnit}>%</span>
                </div>
              </div>
              <div className={styles.toolStats}>
                <span className={styles.toolStat}>
                  <span className={styles.toolStatValue}>{formatDuration(t.avg_duration_min)}</span>{' '}
                  avg
                </span>
                <span className={styles.toolStat}>
                  <span className={styles.toolStatValue}>{t.sessions}</span> sessions
                </span>
                <span className={styles.toolStat}>
                  <span className={styles.toolStatValue}>
                    {(t.total_lines_added + t.total_lines_removed).toLocaleString()}
                  </span>{' '}
                  lines
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PatternsSection({
  hourly,
  duration,
}: {
  hourly: HourlyBucket[];
  duration: DurationBucket[];
}) {
  const { grid, max } = useMemo(() => buildHeatmapData(hourly), [hourly]);
  const maxCount = useMemo(() => Math.max(...duration.map((d) => d.count), 1), [duration]);

  const hasHeatmap = hourly.length > 0;
  const hasDuration = duration.some((d) => d.count > 0);
  if (!hasHeatmap && !hasDuration) return null;

  const hourLabels = [0, 3, 6, 9, 12, 15, 18, 21];

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>How you work</span>
      <div className={styles.twoCol}>
        {hasHeatmap && (
          <div className={styles.colBlock}>
            <div className={styles.heatmapWrap}>
              <div className={styles.heatmapGrid}>
                <div className={styles.heatmapYLabels}>
                  {DAY_LABELS.map((d) => (
                    <span key={d} className={styles.heatmapYLabel}>
                      {d}
                    </span>
                  ))}
                </div>
                <div className={styles.heatmapCols}>
                  {Array.from({ length: 24 }, (_, hour) => (
                    <div key={hour} className={styles.heatmapCol}>
                      {Array.from({ length: 7 }, (_, dow) => {
                        const val = grid[dow][hour];
                        const opacity = max > 0 ? 0.05 + (val / max) * 0.7 : 0.05;
                        return (
                          <div
                            key={dow}
                            className={styles.heatmapCell}
                            style={{ background: `var(--accent)`, opacity }}
                            title={`${DAY_LABELS[dow]} ${hour}:00 - ${val} sessions`}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.heatmapXLabels}>
                {hourLabels.map((h) => (
                  <span key={h} className={styles.heatmapXLabel}>
                    {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {hasDuration && (
          <div className={styles.colBlock}>
            <div className={styles.durationBars}>
              {duration.map((d) => {
                const pct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
                const isPeak = d.count === maxCount && maxCount > 0;
                return (
                  <div key={d.bucket} className={styles.durationRow}>
                    <span className={styles.durationLabel}>{d.bucket}</span>
                    <div className={styles.durationBarTrack}>
                      <div
                        className={clsx(styles.durationBarFill, isPeak && styles.durationBarPeak)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={styles.durationCount}>{d.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkTypeSection({ workTypes }: { workTypes: WorkTypeDistribution[] }) {
  if (workTypes.length === 0) return null;

  const totalSessions = workTypes.reduce((s, w) => s + w.sessions, 0);
  if (totalSessions === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>What you&apos;re building</span>
      <div className={styles.workBar}>
        {workTypes.map((w) => {
          const pct = (w.sessions / totalSessions) * 100;
          if (pct < 1) return null;
          return (
            <div
              key={w.work_type}
              className={styles.workSegment}
              style={{
                width: `${pct}%`,
                background: WORK_TYPE_COLORS[w.work_type] || WORK_TYPE_COLORS.other,
              }}
              title={`${w.work_type}: ${Math.round(pct)}%`}
            />
          );
        })}
      </div>
      <div className={styles.workLegend}>
        {workTypes.map((w) => {
          const pct = Math.round((w.sessions / totalSessions) * 100);
          if (pct < 1) return null;
          return (
            <div key={w.work_type} className={styles.workLegendItem}>
              <span
                className={styles.workDot}
                style={{ background: WORK_TYPE_COLORS[w.work_type] || WORK_TYPE_COLORS.other }}
              />
              <span className={styles.workLegendLabel}>{w.work_type}</span>
              <span className={styles.workLegendValue}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrendsSection({ trends }: { trends: DailyTrend[] }) {
  if (trends.length < 2) return null;

  const sessionData = trends.map((d) => d.sessions);

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Session volume</span>
      <Sparkline data={sessionData} height={64} />
    </div>
  );
}

function ProjectsSection({
  summaries,
  liveAgents,
  selectTeam,
}: {
  summaries: Array<Record<string, unknown>>;
  liveAgents: Array<{ teamId: string }>;
  selectTeam: (id: string) => void;
}) {
  if (summaries.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Projects</span>
      <div className={styles.projectList}>
        {summaries.map((team, i) => {
          const teamId = (team.team_id as string) || '';
          const name = (team.team_name as string) || teamId;
          const sessions24h = (team.recent_sessions_24h as number) || 0;
          const conflicts = (team.conflict_count as number) || 0;
          const live = liveAgents.filter((a) => a.teamId === teamId).length;

          return (
            <button
              key={teamId}
              className={styles.projectRow}
              style={{ '--row-index': i } as CSSProperties}
              onClick={() => selectTeam(teamId)}
              type="button"
            >
              <span className={styles.projectName}>{name}</span>
              <div className={styles.projectMeta}>
                <span className={styles.projectStat}>{sessions24h} sessions today</span>
                {live > 0 && (
                  <span className={styles.projectLive}>
                    <span className={styles.liveDot} style={{ background: 'var(--accent)' }} />
                    {live} live
                  </span>
                )}
                {conflicts > 0 && (
                  <span className={styles.projectConflict}>{conflicts} conflicts</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModelSection({
  modelOutcomes,
}: {
  modelOutcomes: Array<{
    agent_model: string;
    outcome: string;
    count: number;
    avg_duration_min: number;
    total_edits: number;
    total_lines_added: number;
    total_lines_removed: number;
  }>;
}) {
  const models = useMemo(() => aggregateModels(modelOutcomes), [modelOutcomes]);

  if (models.length < 2) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Model performance</span>
      <div className={styles.modelList}>
        {models.map((m, i) => (
          <div
            key={m.model}
            className={styles.modelRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.modelName}>{m.model}</span>
            <span className={styles.modelStat}>
              <span className={styles.modelStatValue}>{m.rate}%</span> completion
            </span>
            <span className={styles.modelStat}>
              <span className={styles.modelStatValue}>{formatDuration(m.avgMin)}</span> avg
            </span>
            <span className={styles.modelStat}>
              <span className={styles.modelStatValue}>{m.edits.toLocaleString()}</span> edits
            </span>
            <span className={styles.modelStat}>
              <span className={styles.modelStatValue}>
                {(m.linesAdded + m.linesRemoved).toLocaleString()}
              </span>{' '}
              lines
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Period comparison + Token usage ──────────────

function formatDelta(
  current: number,
  previous: number | undefined | null,
): { value: string; direction: 'up' | 'down' | 'neutral' } | null {
  if (previous == null || previous === 0) return null;
  const delta = Math.round((current - previous) * 10) / 10;
  if (delta === 0) return { value: '0', direction: 'neutral' };
  return {
    value: `${delta > 0 ? '+' : ''}${delta}`,
    direction: delta > 0 ? 'up' : 'down',
  };
}

function PeriodDeltasSection({ comparison }: { comparison: PeriodComparison }) {
  const { current, previous } = comparison;
  if (current.total_sessions === 0) return null;
  if (!previous) return null;

  const metrics: Array<{
    label: string;
    current: number;
    previous: number;
    unit: string;
    invertDelta?: boolean;
  }> = [
    {
      label: 'Avg duration',
      current: current.avg_duration_min,
      previous: previous.avg_duration_min,
      unit: 'min',
      invertDelta: true,
    },
    {
      label: 'Edit velocity',
      current: current.edit_velocity,
      previous: previous.edit_velocity,
      unit: '/hr',
    },
    {
      label: 'Stuckness',
      current: current.stuckness_rate,
      previous: previous.stuckness_rate,
      unit: '%',
      invertDelta: true,
    },
    {
      label: 'Memory hit rate',
      current: current.memory_hit_rate,
      previous: previous.memory_hit_rate,
      unit: '%',
    },
  ];

  const hasChange = metrics.some((m) => m.previous > 0);
  if (!hasChange) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Period over period</span>
      <div className={styles.statRow}>
        {metrics.map((m) => {
          const d = formatDelta(m.current, m.previous);
          // For metrics where lower is better (duration, stuckness), invert the color
          const effectiveDir =
            d && m.invertDelta
              ? d.direction === 'up'
                ? 'down'
                : d.direction === 'down'
                  ? 'up'
                  : 'neutral'
              : d?.direction;
          return (
            <div key={m.label} className={styles.statBlock}>
              <span className={styles.statBlockValue}>
                {m.current}
                {m.unit}
              </span>
              {d && (
                <span
                  className={clsx(
                    styles.headlineDelta,
                    effectiveDir === 'up' && styles.deltaUp,
                    effectiveDir === 'down' && styles.deltaDown,
                    effectiveDir === 'neutral' && styles.deltaNeutral,
                  )}
                >
                  {d.value}
                  {m.unit}
                </span>
              )}
              <span className={styles.statBlockLabel}>{m.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function TokenUsageSection({ usage }: { usage: TokenUsageStats }) {
  if (usage.sessions_with_token_data === 0) return null;

  const totalTokens = usage.total_input_tokens + usage.total_output_tokens;
  const coverage = Math.round(
    (usage.sessions_with_token_data /
      (usage.sessions_with_token_data + usage.sessions_without_token_data)) *
      100,
  );

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Token usage</span>
      <div className={styles.statRow}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{formatTokens(totalTokens)}</span>
          <span className={styles.statBlockLabel}>total tokens</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{formatTokens(usage.avg_input_per_session)}</span>
          <span className={styles.statBlockLabel}>avg input / session</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>
            {formatTokens(usage.avg_output_per_session)}
          </span>
          <span className={styles.statBlockLabel}>avg output / session</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{coverage}%</span>
          <span className={styles.statBlockLabel}>session coverage</span>
        </div>
      </div>
      {usage.by_model.length > 1 && (
        <div className={styles.modelList}>
          {usage.by_model.map((m, i) => (
            <div
              key={m.agent_model}
              className={styles.modelRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.modelName}>{m.agent_model}</span>
              <span className={styles.modelStat}>
                <span className={styles.modelStatValue}>{formatTokens(m.input_tokens)}</span> input
              </span>
              <span className={styles.modelStat}>
                <span className={styles.modelStatValue}>{formatTokens(m.output_tokens)}</span>{' '}
                output
              </span>
              <span className={styles.modelStat}>
                <span className={styles.modelStatValue}>{m.sessions}</span> sessions
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Session Health Sections ──────────────────────

function StucknessSection({ stuckness }: { stuckness: StucknessStats }) {
  if (stuckness.total_sessions === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Session health</span>
      <div className={styles.statRow}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{stuckness.stuckness_rate}%</span>
          <span className={styles.statBlockLabel}>got stuck</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{stuckness.stuck_sessions}</span>
          <span className={styles.statBlockLabel}>stuck sessions</span>
        </div>
        {stuckness.stuck_sessions > 0 && (
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{stuckness.stuck_completion_rate}%</span>
            <span className={styles.statBlockLabel}>stuck completed</span>
          </div>
        )}
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{stuckness.normal_completion_rate}%</span>
          <span className={styles.statBlockLabel}>normal completed</span>
        </div>
      </div>
    </div>
  );
}

function FirstEditSection({ stats }: { stats: FirstEditStats }) {
  if (stats.avg_minutes_to_first_edit === 0 && stats.by_tool.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Agent warmup</span>
      <div className={styles.statRow}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>
            {formatDuration(stats.avg_minutes_to_first_edit)}
          </span>
          <span className={styles.statBlockLabel}>avg to first edit</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>
            {formatDuration(stats.median_minutes_to_first_edit)}
          </span>
          <span className={styles.statBlockLabel}>median</span>
        </div>
      </div>
      {stats.by_tool.length > 1 && (
        <div className={styles.metricBars} style={{ marginTop: 16 }}>
          {stats.by_tool.map((t) => {
            const max = Math.max(...stats.by_tool.map((x) => x.avg_minutes), 1);
            const pct = (t.avg_minutes / max) * 100;
            const meta = getToolMeta(t.host_tool);
            return (
              <div key={t.host_tool} className={styles.metricRow}>
                <span className={styles.metricLabel}>{meta.label}</span>
                <div className={styles.metricBarTrack}>
                  <div className={styles.metricBarFill} style={{ width: `${pct}%` }} />
                </div>
                <span className={styles.metricValue}>{formatDuration(t.avg_minutes)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Edit Velocity ────────────────────────────────

function EditVelocitySection({ velocity }: { velocity: EditVelocityTrend[] }) {
  if (velocity.length < 2) return null;

  const editsData = velocity.map((d) => d.edits_per_hour);
  const linesData = velocity.map((d) => d.lines_per_hour);
  const totalHours = velocity.reduce((s, d) => s + d.total_session_hours, 0);
  const avgEditsPerHour =
    velocity.length > 0
      ? Math.round((velocity.reduce((s, d) => s + d.edits_per_hour, 0) / velocity.length) * 10) / 10
      : 0;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Edit velocity</span>
      <div className={styles.statRow} style={{ marginBottom: 16 }}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{avgEditsPerHour}</span>
          <span className={styles.statBlockLabel}>avg edits/hr</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{Math.round(totalHours)}</span>
          <span className={styles.statBlockLabel}>total session hours</span>
        </div>
      </div>
      <Sparkline data={editsData} height={48} />
    </div>
  );
}

// ── Work Type Outcomes ───────────────────────────

function WorkTypeOutcomesSection({ outcomes }: { outcomes: WorkTypeOutcome[] }) {
  if (outcomes.length === 0) return null;

  const maxSessions = Math.max(...outcomes.map((o) => o.sessions), 1);

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Completion by work type</span>
      <div className={styles.metricBars}>
        {outcomes.map((o) => {
          const pct = (o.sessions / maxSessions) * 100;
          return (
            <div key={o.work_type} className={styles.metricRow}>
              <span className={styles.metricLabel}>{o.work_type}</span>
              <div className={styles.metricBarTrack}>
                <div
                  className={clsx(
                    styles.metricBarFill,
                    o.completion_rate < 50 && styles.metricBarWarn,
                  )}
                  style={{
                    width: `${pct}%`,
                    background: WORK_TYPE_COLORS[o.work_type] || WORK_TYPE_COLORS.other,
                    opacity: 0.5,
                  }}
                />
              </div>
              <span className={styles.metricValue}>{o.completion_rate}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Conversation Intelligence ────────────────────

function ConversationEditSection({ data }: { data: ConversationEditCorrelation[] }) {
  if (data.length === 0) return null;

  const maxSessions = Math.max(...data.map((d) => d.sessions), 1);

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Conversation depth</span>
      <div className={styles.dataList}>
        {data.map((d, i) => (
          <div
            key={d.bucket}
            className={styles.dataRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.dataName}>{d.bucket}</span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{d.sessions}</span> sessions
              </span>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{d.avg_edits}</span> avg edits
              </span>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{d.completion_rate}%</span> completed
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Conversation Intelligence Section ────────────

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'var(--success)',
  neutral: 'var(--soft)',
  frustrated: 'var(--warn)',
  confused: 'var(--warn)',
  negative: 'var(--danger)',
  unclassified: 'var(--ghost)',
};

function ConversationIntelligenceSection({ conv }: { conv: ConversationAnalytics }) {
  if (conv.total_messages === 0 && conv.sessions_with_conversations === 0) return null;

  const maxSentiment = Math.max(...conv.sentiment_distribution.map((s) => s.count), 1);
  const maxTopic = Math.max(...conv.topic_distribution.map((t) => t.count), 1);

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Conversation intelligence</span>

      {/* Message volume stats */}
      <div className={styles.statRow}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{conv.total_messages.toLocaleString()}</span>
          <span className={styles.statBlockLabel}>messages</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{conv.user_messages.toLocaleString()}</span>
          <span className={styles.statBlockLabel}>from you</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{conv.avg_user_char_count.toLocaleString()}</span>
          <span className={styles.statBlockLabel}>avg chars / msg</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{conv.sessions_with_conversations}</span>
          <span className={styles.statBlockLabel}>sessions tracked</span>
        </div>
      </div>

      {/* Sentiment distribution */}
      {conv.sentiment_distribution.length > 0 && (
        <>
          <span className={styles.sectionSublabel}>Your sentiment</span>
          <div className={styles.metricBars}>
            {conv.sentiment_distribution.map((s) => {
              const pct = maxSentiment > 0 ? (s.count / maxSentiment) * 100 : 0;
              return (
                <div key={s.sentiment} className={styles.metricRow}>
                  <span className={styles.metricLabel}>{s.sentiment}</span>
                  <div className={styles.metricBarTrack}>
                    <div
                      className={styles.metricBarFill}
                      style={{
                        width: `${pct}%`,
                        background: SENTIMENT_COLORS[s.sentiment] || 'var(--ghost)',
                      }}
                    />
                  </div>
                  <span className={styles.durationCount}>{s.count}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Topic distribution */}
      {conv.topic_distribution.length > 0 && (
        <>
          <span className={styles.sectionSublabel}>What you ask about</span>
          <div className={styles.metricBars}>
            {conv.topic_distribution.slice(0, 8).map((t) => {
              const pct = maxTopic > 0 ? (t.count / maxTopic) * 100 : 0;
              return (
                <div key={t.topic} className={styles.metricRow}>
                  <span className={styles.metricLabel}>{t.topic}</span>
                  <div className={styles.metricBarTrack}>
                    <div className={styles.metricBarFill} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={styles.durationCount}>{t.count}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Sentiment-outcome correlation */}
      {conv.sentiment_outcome_correlation.length > 0 && (
        <>
          <span className={styles.sectionSublabel}>Sentiment → outcome</span>
          <div className={styles.dataList}>
            {conv.sentiment_outcome_correlation.map((sc, i) => (
              <div
                key={sc.dominant_sentiment}
                className={styles.dataRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span className={styles.dataName}>{sc.dominant_sentiment}</span>
                <div className={styles.dataMeta}>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{sc.sessions}</span> sessions
                  </span>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatSuccess}>{sc.completion_rate}%</span> completed
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Tool coverage */}
      {conv.tool_coverage.unsupported_tools.length > 0 && (
        <div className={styles.coverageNote}>
          Conversation data from{' '}
          {conv.tool_coverage.supported_tools.length > 0
            ? conv.tool_coverage.supported_tools.map((t) => getToolMeta(t).label).join(', ')
            : 'managed agents'}
          . {conv.tool_coverage.unsupported_tools.map((t) => getToolMeta(t).label).join(', ')} —
          session data only.
        </div>
      )}
    </div>
  );
}

// ── Codebase Activity Sections ───────────────────

function FileHeatmapSection({ files }: { files: FileHeatmapEntry[] }) {
  if (files.length === 0) return null;

  const maxTouches = Math.max(...files.map((f) => f.touch_count), 1);

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>File heatmap</span>
      <div className={styles.dataList}>
        {files.slice(0, 20).map((f, i) => {
          const pct = (f.touch_count / maxTouches) * 100;
          return (
            <div
              key={f.file}
              className={styles.dataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.dataName} title={f.file}>
                {f.file.split('/').slice(-2).join('/')}
              </span>
              <div className={styles.dataMeta}>
                {f.work_type && (
                  <span className={styles.dataStat}>
                    <span
                      className={styles.workDot}
                      style={{
                        background: WORK_TYPE_COLORS[f.work_type] || WORK_TYPE_COLORS.other,
                        display: 'inline-block',
                        width: 6,
                        height: 6,
                        borderRadius: 2,
                        marginRight: 4,
                      }}
                    />
                    {f.work_type}
                  </span>
                )}
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{f.touch_count}</span> touches
                </span>
                {f.outcome_rate != null && (
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{f.outcome_rate}%</span> completed
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DirectoryHeatmapSection({ dirs }: { dirs: DirectoryHeatmapEntry[] }) {
  if (dirs.length === 0) return null;

  const maxTouches = Math.max(...dirs.map((d) => d.touch_count), 1);

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Directory heatmap</span>
      <div className={styles.metricBars}>
        {dirs.slice(0, 15).map((d) => {
          const pct = (d.touch_count / maxTouches) * 100;
          return (
            <div key={d.directory} className={styles.metricRow}>
              <span className={styles.metricLabel} title={d.directory}>
                {d.directory}
              </span>
              <div className={styles.metricBarTrack}>
                <div className={styles.metricBarFill} style={{ width: `${pct}%` }} />
              </div>
              <span className={styles.metricValue}>{d.touch_count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FileChurnSection({ churn }: { churn: FileChurnEntry[] }) {
  if (churn.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>High-churn files</span>
      <div className={styles.dataList}>
        {churn.slice(0, 15).map((f, i) => (
          <div
            key={f.file}
            className={styles.dataRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.dataName} title={f.file}>
              {f.file.split('/').slice(-2).join('/')}
            </span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{f.session_count}</span> sessions
              </span>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{f.total_edits}</span> edits
              </span>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{f.total_lines.toLocaleString()}</span> lines
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileReworkSection({ rework }: { rework: FileReworkEntry[] }) {
  if (rework.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>File rework</span>
      <div className={styles.dataList}>
        {rework.slice(0, 15).map((f, i) => (
          <div
            key={f.file}
            className={styles.dataRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.dataName} title={f.file}>
              {f.file.split('/').slice(-2).join('/')}
            </span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span className={styles.dataStatDanger}>{f.rework_ratio}%</span> rework
              </span>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{f.failed_edits}</span>/{f.total_edits}{' '}
                failed
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditStalenessSection({ stale }: { stale: AuditStalenessEntry[] }) {
  if (stale.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Audit staleness</span>
      <div className={styles.dataList}>
        {stale.map((s, i) => (
          <div
            key={s.directory}
            className={styles.dataRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.dataName}>{s.directory}</span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span className={styles.dataStatWarn}>{s.days_since}d</span> since last edit
              </span>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{s.prior_edit_count}</span> prior edits
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Collaboration Sections ───────────────────────

function MemberSection({ members }: { members: MemberAnalytics[] }) {
  if (members.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Team members</span>
      <div className={styles.dataList}>
        {members.map((m, i) => {
          const meta = m.primary_tool ? getToolMeta(m.primary_tool) : null;
          return (
            <div
              key={m.handle}
              className={styles.dataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.dataName}>
                {m.handle}
                {meta && (
                  <span className={styles.dataStat} style={{ marginLeft: 8 }}>
                    {meta.label}
                  </span>
                )}
              </span>
              <div className={styles.dataMeta}>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{m.completion_rate}%</span> rate
                </span>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{m.sessions}</span> sessions
                </span>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{formatDuration(m.avg_duration_min)}</span>{' '}
                  avg
                </span>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{m.total_edits.toLocaleString()}</span>{' '}
                  edits
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConcurrentEditsSection({ edits }: { edits: ConcurrentEditEntry[] }) {
  if (edits.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Multi-agent files</span>
      <div className={styles.dataList}>
        {edits.slice(0, 15).map((e, i) => (
          <div
            key={e.file}
            className={styles.dataRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.dataName} title={e.file}>
              {e.file.split('/').slice(-2).join('/')}
            </span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{e.agents}</span> agents
              </span>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{e.edit_count}</span> edits
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileOverlapSection({ overlap }: { overlap: FileOverlapStats }) {
  if (overlap.total_files === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>File overlap</span>
      <div className={styles.statRow}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{overlap.overlap_rate}%</span>
          <span className={styles.statBlockLabel}>files shared</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{overlap.overlapping_files}</span>
          <span className={styles.statBlockLabel}>overlapping</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{overlap.total_files}</span>
          <span className={styles.statBlockLabel}>total files</span>
        </div>
      </div>
    </div>
  );
}

function ConflictCorrelationSection({ data }: { data: ConflictCorrelation[] }) {
  if (data.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Conflict impact</span>
      <div className={styles.compareRow}>
        {data.map((d) => (
          <div key={d.bucket} className={styles.compareBlock}>
            <span className={styles.compareValue}>{d.completion_rate}%</span>
            <span className={styles.compareLabel}>
              {d.bucket} ({d.sessions})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RetryPatternsSection({ retries }: { retries: RetryPattern[] }) {
  if (retries.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Retry patterns</span>
      <div className={styles.dataList}>
        {retries.slice(0, 15).map((r, i) => (
          <div
            key={`${r.handle}-${r.file}`}
            className={styles.dataRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.dataName} title={r.file}>
              <span style={{ fontWeight: 600 }}>{r.handle}</span>{' '}
              {r.file.split('/').slice(-2).join('/')}
            </span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{r.attempts}</span> attempts
              </span>
              <span className={styles.dataStat}>
                <span className={r.resolved ? styles.dataStatSuccess : styles.dataStatDanger}>
                  {r.resolved ? 'resolved' : r.final_outcome || 'unresolved'}
                </span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Memory Intelligence Sections ─────────────────

function MemoryUsageSection({ usage }: { usage: MemoryUsageStats }) {
  if (usage.total_memories === 0 && usage.searches === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Memory health</span>
      <div className={styles.statRow}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{usage.total_memories}</span>
          <span className={styles.statBlockLabel}>total memories</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{usage.search_hit_rate}%</span>
          <span className={styles.statBlockLabel}>search hit rate</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{usage.searches}</span>
          <span className={styles.statBlockLabel}>searches</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{usage.memories_created_period}</span>
          <span className={styles.statBlockLabel}>created this period</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{usage.stale_memories}</span>
          <span className={styles.statBlockLabel}>stale (30d+)</span>
        </div>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{Math.round(usage.avg_memory_age_days)}d</span>
          <span className={styles.statBlockLabel}>avg age</span>
        </div>
      </div>
    </div>
  );
}

function MemoryOutcomeSection({ data }: { data: MemoryOutcomeCorrelation[] }) {
  if (data.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Memory impact</span>
      <div className={styles.compareRow}>
        {data.map((d) => (
          <div key={d.bucket} className={styles.compareBlock}>
            <span className={styles.compareValue}>{d.completion_rate}%</span>
            <span className={styles.compareLabel}>
              {d.bucket} ({d.sessions})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopMemoriesSection({ memories }: { memories: MemoryAccessEntry[] }) {
  if (memories.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Most accessed memories</span>
      <div className={styles.dataList}>
        {memories.slice(0, 10).map((m, i) => (
          <div key={m.id} className={styles.dataRow} style={{ '--row-index': i } as CSSProperties}>
            <span className={styles.memoryPreview}>{m.text_preview}</span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{m.access_count}</span> hits
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Phase 3 Sections ─────────────────────────────

function ScopeComplexitySection({ data }: { data: ScopeComplexityBucket[] }) {
  if (data.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Task scope vs outcome</span>
      <div className={styles.dataList}>
        {data.map((d, i) => (
          <div
            key={d.bucket}
            className={styles.dataRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.dataName}>{d.bucket}</span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span
                  className={d.completion_rate < 50 ? styles.dataStatDanger : styles.dataStatValue}
                >
                  {d.completion_rate}%
                </span>{' '}
                completed
              </span>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{d.sessions}</span> sessions
              </span>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{d.avg_edits}</span> avg edits
              </span>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{formatDuration(d.avg_duration_min)}</span>{' '}
                avg
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PromptEfficiencySection({ data }: { data: PromptEfficiencyTrend[] }) {
  if (data.length < 2) return null;

  const avg =
    data.length > 0
      ? Math.round((data.reduce((s, d) => s + d.avg_turns_per_edit, 0) / data.length) * 10) / 10
      : 0;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Prompt efficiency</span>
      <div className={styles.statRow} style={{ marginBottom: 16 }}>
        <div className={styles.statBlock}>
          <span className={styles.statBlockValue}>{avg}</span>
          <span className={styles.statBlockLabel}>avg turns per edit</span>
        </div>
      </div>
      <Sparkline data={data.map((d) => d.avg_turns_per_edit)} height={48} />
    </div>
  );
}

function HourlyEffectivenessSection({ data }: { data: HourlyEffectiveness[] }) {
  if (data.length === 0) return null;

  const best = [...data].sort((a, b) => b.completion_rate - a.completion_rate)[0];
  const worst = [...data]
    .filter((d) => d.sessions >= 3)
    .sort((a, b) => a.completion_rate - b.completion_rate)[0];

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>When you work best</span>
      <div className={styles.statRow} style={{ marginBottom: 16 }}>
        {best && (
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>
              {best.hour === 0
                ? '12a'
                : best.hour < 12
                  ? `${best.hour}a`
                  : best.hour === 12
                    ? '12p'
                    : `${best.hour - 12}p`}
            </span>
            <span className={styles.statBlockLabel}>best hour ({best.completion_rate}%)</span>
          </div>
        )}
        {worst && worst.hour !== best?.hour && (
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>
              {worst.hour === 0
                ? '12a'
                : worst.hour < 12
                  ? `${worst.hour}a`
                  : worst.hour === 12
                    ? '12p'
                    : `${worst.hour - 12}p`}
            </span>
            <span className={styles.statBlockLabel}>worst hour ({worst.completion_rate}%)</span>
          </div>
        )}
      </div>
      <div className={styles.metricBars}>
        {data
          .filter((d) => d.sessions > 0)
          .map((d) => {
            const label =
              d.hour === 0
                ? '12a'
                : d.hour < 12
                  ? `${d.hour}a`
                  : d.hour === 12
                    ? '12p'
                    : `${d.hour - 12}p`;
            return (
              <div key={d.hour} className={styles.metricRow}>
                <span className={styles.metricLabel}>{label}</span>
                <div className={styles.metricBarTrack}>
                  <div
                    className={clsx(
                      styles.metricBarFill,
                      d.completion_rate < 50 && styles.metricBarWarn,
                    )}
                    style={{ width: `${d.completion_rate}%` }}
                  />
                </div>
                <span className={styles.metricValue}>{d.completion_rate}%</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

function OutcomeTagsSection({ data }: { data: OutcomeTagCount[] }) {
  if (data.length === 0) return null;

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Failure reasons</span>
      <div className={styles.metricBars}>
        {data.slice(0, 15).map((d) => {
          const pct = (d.count / maxCount) * 100;
          return (
            <div key={`${d.tag}-${d.outcome}`} className={styles.metricRow}>
              <span className={styles.metricLabel} title={d.tag}>
                {d.tag}
              </span>
              <div className={styles.metricBarTrack}>
                <div
                  className={clsx(
                    styles.metricBarFill,
                    d.outcome === 'failed' && styles.metricBarDanger,
                    d.outcome === 'abandoned' && styles.metricBarWarn,
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={styles.metricValue}>{d.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolHandoffsSection({ data }: { data: ToolHandoff[] }) {
  if (data.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>Cross-tool handoffs</span>
      <div className={styles.dataList}>
        {data.map((d, i) => {
          const fromMeta = getToolMeta(d.from_tool);
          const toMeta = getToolMeta(d.to_tool);
          return (
            <div
              key={`${d.from_tool}-${d.to_tool}`}
              className={styles.dataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.dataName}>
                {fromMeta.label} → {toMeta.label}
              </span>
              <div className={styles.dataMeta}>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{d.file_count}</span> files
                </span>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{d.handoff_completion_rate}%</span>{' '}
                  completed
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OutcomePredictorsSection({ data }: { data: OutcomePredictor[] }) {
  if (data.length === 0) return null;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>First edit timing by outcome</span>
      <div className={styles.compareRow}>
        {data.map((d) => (
          <div key={d.outcome} className={styles.compareBlock}>
            <span className={styles.compareValue}>{formatDuration(d.avg_first_edit_min)}</span>
            <span className={styles.compareLabel}>
              {d.outcome} ({d.sessions})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────

export default function OverviewView() {
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);

  const { dashboardData, dashboardStatus, pollError, pollErrorData } = usePollingStore(
    useShallow((s) => ({
      dashboardData: s.dashboardData,
      dashboardStatus: s.dashboardStatus,
      pollError: s.pollError,
      pollErrorData: s.pollErrorData,
    })),
  );
  const user = useAuthStore((s) => s.user);
  const userColor = getColorHex(user?.color ?? '') || '#121317';
  const { teams, teamsError, selectTeam } = useTeamStore(
    useShallow((s) => ({
      teams: s.teams,
      teamsError: s.teamsError,
      selectTeam: s.selectTeam,
    })),
  );

  const summaries = useMemo(() => dashboardData?.teams ?? [], [dashboardData?.teams]);
  const failedTeams = useMemo(
    () => dashboardData?.failed_teams ?? pollErrorData?.failed_teams ?? [],
    [dashboardData?.failed_teams, pollErrorData?.failed_teams],
  );

  const knownTeamCount = teams.length;
  const hasKnownProjects = knownTeamCount > 0 || summaries.length > 0;
  const failedLabel = failedTeams.length > 0 ? summarizeNames(failedTeams) : '';

  const { liveAgents, sortedSummaries } = useOverviewData(summaries);
  const { analytics, isLoading: analyticsLoading } = useUserAnalytics(rangeDays, true);
  const { data: conversationData } = useConversationAnalytics(rangeDays, true);
  const globalStats = useGlobalStats();

  const isLoading = !dashboardData && (dashboardStatus === 'idle' || dashboardStatus === 'loading');
  const isUnavailable =
    dashboardStatus === 'error' || (!pollError && hasKnownProjects && summaries.length === 0);
  const unavailableHint =
    knownTeamCount === 0
      ? 'We could not load your project overview right now.'
      : knownTeamCount === 1
        ? `We found ${teams[0]?.team_name || teams[0]?.team_id || 'a connected project'}, but its overview data is unavailable right now.`
        : `We found ${knownTeamCount} connected projects, but none of their overview data could be loaded.`;
  const unavailableDetail =
    pollError ||
    (failedLabel
      ? `Unavailable now: ${failedLabel}`
      : 'Project summaries are temporarily unavailable.');

  if (isLoading) {
    return (
      <div className={styles.overview}>
        <section className={styles.header}>
          <span className={styles.eyebrow}>Overview</span>
          <ShimmerText as="h1" className={styles.loadingTitle}>
            Loading your projects
          </ShimmerText>
          <SkeletonStatGrid count={4} />
        </section>
        <SkeletonRows count={3} columns={4} />
      </div>
    );
  }

  if (isUnavailable) {
    return (
      <div className={styles.overview}>
        <StatusState
          tone="danger"
          eyebrow="Overview unavailable"
          title="Could not load project overview"
          hint={unavailableHint}
          detail={unavailableDetail}
          meta={
            knownTeamCount > 0
              ? `${knownTeamCount} connected ${knownTeamCount === 1 ? 'project' : 'projects'}`
              : 'Overview'
          }
          actionLabel="Retry"
          onAction={forceRefresh}
        />
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div className={styles.overview}>
        <EmptyState
          large
          title={teamsError ? 'Could not load projects' : 'No projects yet'}
          hint={
            teamsError || (
              <>
                Run <code>npx chinwag init</code> in a repo to add one.
              </>
            )
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.overview}>
      <section className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Overview</span>
          <h1 className={styles.title}>
            Welcome back
            {user?.handle ? (
              <>
                {', '}
                <span style={{ color: userColor }}>{user.handle}</span>
              </>
            ) : null}
            .
          </h1>
        </div>

        {failedTeams.length > 0 && (
          <div className={styles.summaryNotice}>
            <span className={styles.summaryNoticeLabel}>
              {failedTeams.length} {failedTeams.length === 1 ? 'project' : 'projects'} unavailable
            </span>
            <span className={styles.summaryNoticeText}>{failedLabel}</span>
          </div>
        )}

        <div className={styles.rangeRow}>
          <div className={styles.rangeSelector} role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={clsx(styles.rangeButton, rangeDays === r && styles.rangeActive)}
                onClick={() => setRangeDays(r)}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Status + Summary ── */}

      <HeadlineSection
        analytics={analytics}
        projectCount={sortedSummaries.length}
        liveAgentCount={liveAgents.length}
      />

      <PeriodDeltasSection comparison={analytics.period_comparison} />

      <LiveAgentsBar liveAgents={liveAgents} selectTeam={selectTeam} />

      <StucknessSection stuckness={analytics.stuckness} />

      <FirstEditSection stats={analytics.first_edit_stats} />

      {/* ── Tools + Models ── */}

      <ToolComparisonSection tools={analytics.tool_comparison} />

      <ModelSection modelOutcomes={analytics.model_outcomes} />

      <TokenUsageSection usage={analytics.token_usage} />

      {/* ── Work Patterns ── */}

      <PatternsSection
        hourly={analytics.hourly_distribution}
        duration={analytics.duration_distribution}
      />

      <WorkTypeSection workTypes={analytics.work_type_distribution} />

      <WorkTypeOutcomesSection outcomes={analytics.work_type_outcomes} />

      <EditVelocitySection velocity={analytics.edit_velocity} />

      <ScopeComplexitySection data={analytics.scope_complexity} />

      <ConversationEditSection data={analytics.conversation_edit_correlation} />

      <PromptEfficiencySection data={analytics.prompt_efficiency} />

      <HourlyEffectivenessSection data={analytics.hourly_effectiveness} />

      <ConversationIntelligenceSection conv={conversationData} />

      {/* ── Codebase Activity ── */}

      <DirectoryHeatmapSection dirs={analytics.directory_heatmap} />

      <FileHeatmapSection files={analytics.file_heatmap} />

      <FileChurnSection churn={analytics.file_churn} />

      <FileReworkSection rework={analytics.file_rework} />

      <AuditStalenessSection stale={analytics.audit_staleness} />

      {/* ── Collaboration + Conflicts ── */}

      <MemberSection members={analytics.member_analytics} />

      <ConcurrentEditsSection edits={analytics.concurrent_edits} />

      <FileOverlapSection overlap={analytics.file_overlap} />

      <ConflictCorrelationSection data={analytics.conflict_correlation} />

      <RetryPatternsSection retries={analytics.retry_patterns} />

      <ToolHandoffsSection data={analytics.tool_handoffs} />

      <OutcomeTagsSection data={analytics.outcome_tags} />

      <OutcomePredictorsSection data={analytics.outcome_predictors} />

      {/* ── Memory Intelligence ── */}

      <MemoryUsageSection usage={analytics.memory_usage} />

      <MemoryOutcomeSection data={analytics.memory_outcome_correlation} />

      <TopMemoriesSection memories={analytics.top_memories} />

      {/* ── Trends + Projects ── */}

      <TrendsSection trends={analytics.daily_trends} />

      <ProjectsSection
        summaries={sortedSummaries as Array<Record<string, unknown>>}
        liveAgents={liveAgents}
        selectTeam={selectTeam}
      />

      <GlobalMap countries={globalStats.countries} online={globalStats.online} />
    </div>
  );
}
