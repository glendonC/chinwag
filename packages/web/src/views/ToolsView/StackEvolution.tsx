// Stack evolution - how your AI stack has been used over time.
// Stacked area over analytics.tool_daily: x = day, y = sessions,
// one color layer per tool. Replaces the previous "adoption timeline"
// framing, which made a claim chinmeister couldn't actually back (firstSeen
// = first session chinmeister recorded, not when the dev actually adopted
// the tool).
//
// Only a cross-vendor observer can render this because the stack
// requires per-day session counts across every tool in the user's
// stack, normalized to the same calendar.

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { getToolMeta, normalizeToolId } from '../../lib/toolMeta.js';
import ToolIcon from '../../components/ToolIcon/ToolIcon.jsx';
import type { ToolDailyTrend } from '../../lib/apiSchemas.js';
import { PREVIEW_TOOL_DAILY } from './previewData.js';
import Eyebrow from '../../components/Eyebrow/Eyebrow.js';
import styles from './StackEvolution.module.css';

interface Props {
  daily: ToolDailyTrend[] | undefined;
  rangeDays?: number;
}

interface ToolSeries {
  toolId: string;
  label: string;
  color: string;
  total: number;
  perDay: number[]; // length = days, zero-filled
}

interface StackFrame {
  day: string;
  total: number;
  perTool: Record<string, number>;
}

const VIEW_W = 800;
const VIEW_H = 220;
const PAD_T = 18;
const PAD_B = 28;
const PAD_L = 4;
const PAD_R = 4;
const CHART_W = VIEW_W - PAD_L - PAD_R;
const CHART_H = VIEW_H - PAD_T - PAD_B;

function fullDayRange(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function tickLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function StackEvolution({ daily, rangeDays = 30 }: Props) {
  const liveHasData = (daily ?? []).length > 0;
  const isPreview = !liveHasData;

  const [hoveredTool, setHoveredTool] = useState<string | null>(null);

  const { days, seriesByTool, maxStack, peakDay, peakValue, leader, leaderShare } = useMemo(() => {
    const source = liveHasData ? (daily ?? []) : PREVIEW_TOOL_DAILY;
    const dayList = fullDayRange(rangeDays);
    const dayIdx = new Map(dayList.map((d, i) => [d, i]));

    const byTool = new Map<string, ToolSeries>();
    for (const row of source) {
      const idx = dayIdx.get(row.day);
      if (idx === undefined) continue;
      const key = normalizeToolId(row.host_tool);
      if (!key || key === 'unknown') continue;
      const entry = byTool.get(key) ?? {
        toolId: key,
        label: getToolMeta(key).label,
        color: getToolMeta(key).color,
        total: 0,
        perDay: new Array(dayList.length).fill(0) as number[],
      };
      entry.perDay[idx] += row.sessions;
      entry.total += row.sessions;
      byTool.set(key, entry);
    }

    // Sort: biggest total at the bottom of the stack for a stable baseline.
    const seriesList = [...byTool.values()]
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total - a.total);

    const stackFrames: StackFrame[] = dayList.map((day, i) => {
      const perTool: Record<string, number> = {};
      let total = 0;
      for (const s of seriesList) {
        perTool[s.toolId] = s.perDay[i];
        total += s.perDay[i];
      }
      return { day, total, perTool };
    });

    const max = stackFrames.reduce((m, f) => (f.total > m ? f.total : m), 0);
    const peakIdx = stackFrames.reduce(
      (best, f, i) => (f.total > stackFrames[best].total ? i : best),
      0,
    );
    const peakFrame = stackFrames[peakIdx];
    const leaderEntry =
      peakFrame && peakFrame.total > 0
        ? seriesList
            .map((s) => ({ toolId: s.toolId, value: peakFrame.perTool[s.toolId] ?? 0 }))
            .sort((a, b) => b.value - a.value)[0]
        : null;
    const leaderSharePct =
      leaderEntry && peakFrame && peakFrame.total > 0
        ? Math.round((leaderEntry.value / peakFrame.total) * 100)
        : 0;

    return {
      days: dayList,
      seriesByTool: seriesList,
      maxStack: max,
      peakDay: peakFrame?.day ?? null,
      peakValue: peakFrame?.total ?? 0,
      leader: leaderEntry?.toolId ?? null,
      leaderShare: leaderSharePct,
    };
  }, [daily, liveHasData, rangeDays]);

  if (seriesByTool.length === 0) {
    return (
      <section className={styles.section}>
        <header className={styles.header}>
          <Eyebrow label={`Stack evolution · last ${rangeDays} days`} />
          <h2 className={styles.title}>Your stack over time</h2>
        </header>
        <div className={styles.empty}>
          No daily session data yet. Once your tools start reporting, this chart will show how
          volume shifts across your stack day by day.
        </div>
      </section>
    );
  }

  const xFor = (i: number): number =>
    days.length <= 1 ? PAD_L : PAD_L + (i / (days.length - 1)) * CHART_W;
  const yFor = (v: number): number =>
    maxStack <= 0 ? VIEW_H - PAD_B : VIEW_H - PAD_B - (v / maxStack) * CHART_H;

  // Build per-tool stacked paths. Bottom tool drawn first, on top of the
  // chart baseline; each subsequent tool draws on top of the cumulative
  // stack below it.
  const cumulative: number[] = new Array(days.length).fill(0);
  const toolPaths = seriesByTool.map((s) => {
    const bottomY = cumulative.map((v) => yFor(v));
    for (let i = 0; i < days.length; i++) cumulative[i] += s.perDay[i];
    const topY = cumulative.map((v) => yFor(v));

    const topSeg = days
      .map((_, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(2)} ${topY[i].toFixed(2)}`)
      .join(' ');
    const bottomSeg = [...days]
      .map((_, i) => days.length - 1 - i)
      .map((i) => `L ${xFor(i).toFixed(2)} ${bottomY[i].toFixed(2)}`)
      .join(' ');
    const areaPath = `${topSeg} ${bottomSeg} Z`;
    const topLinePath = topSeg;

    return { series: s, areaPath, topLinePath };
  });

  // X-axis ticks - 5 evenly-spaced date labels.
  const tickIndices: number[] = [];
  const TICK_COUNT = 5;
  for (let t = 0; t < TICK_COUNT; t++) {
    tickIndices.push(Math.round((t / (TICK_COUNT - 1)) * (days.length - 1)));
  }

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <Eyebrow label={`Stack evolution · last ${rangeDays} days`} showPreview={isPreview} />
        <h2 className={styles.title}>Your stack over time</h2>
        <p className={styles.subtitle}>
          {isPreview
            ? 'Example data - daily session volume stacked across your tools. Where a tool is quiet, its slice thins. Your own history will replace this once sessions flow through.'
            : 'Daily session volume, stacked across your tools. Where a tool is quiet, its slice thins.'}
        </p>
      </header>

      <div className={styles.legend} onMouseLeave={() => setHoveredTool(null)}>
        {seriesByTool.map((s) => {
          const active = hoveredTool === s.toolId;
          const dim = hoveredTool && !active;
          return (
            <button
              key={s.toolId}
              type="button"
              className={clsx(styles.legendItem, dim && styles.legendItemDim)}
              onMouseEnter={() => setHoveredTool(s.toolId)}
              onFocus={() => setHoveredTool(s.toolId)}
              title={`${s.label}: ${s.total} session${s.total === 1 ? '' : 's'} in the last ${rangeDays} days`}
            >
              <ToolIcon tool={s.toolId} size={14} />
              <span
                className={styles.legendSwatch}
                style={{ background: s.color }}
                aria-hidden="true"
              />
              <span className={styles.legendLabel}>{s.label}</span>
              <span className={styles.legendCount}>{s.total}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.chartWrap} onMouseLeave={() => setHoveredTool(null)}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className={styles.chart}
          role="img"
          aria-label={`Daily session volume across ${seriesByTool.length} tools over ${rangeDays} days`}
          preserveAspectRatio="none"
        >
          {/* baseline */}
          <line
            x1={PAD_L}
            x2={VIEW_W - PAD_R}
            y1={VIEW_H - PAD_B}
            y2={VIEW_H - PAD_B}
            stroke="var(--faint)"
            strokeWidth={1}
          />

          {toolPaths.map(({ series, areaPath, topLinePath }) => {
            const active = hoveredTool === series.toolId;
            const dim = hoveredTool && !active;
            return (
              <g
                key={series.toolId}
                onMouseEnter={() => setHoveredTool(series.toolId)}
                style={{
                  opacity: dim ? 0.2 : 1,
                  transition: 'opacity 0.18s ease',
                  cursor: 'pointer',
                }}
              >
                <path d={areaPath} fill={series.color} fillOpacity={active ? 0.85 : 0.62} />
                <path
                  d={topLinePath}
                  fill="none"
                  stroke={series.color}
                  strokeWidth={active ? 1.75 : 1.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            );
          })}
        </svg>

        <div className={styles.axis}>
          {tickIndices.map((i) => (
            <span
              key={days[i]}
              className={styles.axisTick}
              style={{ left: `${(i / Math.max(days.length - 1, 1)) * 100}%` }}
            >
              {tickLabel(days[i])}
            </span>
          ))}
        </div>
      </div>

      {peakDay && peakValue > 0 && (
        <p className={styles.contextLine}>
          Peak: <strong>{peakValue}</strong> session{peakValue === 1 ? '' : 's'} on{' '}
          {tickLabel(peakDay)}
          {leader && leaderShare > 0 && (
            <>
              {' · '}
              {getToolMeta(leader).label} led {leaderShare}%
            </>
          )}
        </p>
      )}
    </section>
  );
}
