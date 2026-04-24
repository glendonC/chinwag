import { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  DetailSection,
  DeltaChip,
  DirectoryColumns,
  FileTreemap,
  HeroStatRow,
  SmallMultiples,
  StackedArea,
  TrueShareBars,
  type HeroStatDef,
  type SmallMultipleItem,
  type StackedAreaEntry,
  type TrueShareEntry,
} from '../../../components/DetailView/index.js';
import ToolIcon from '../../../components/ToolIcon/ToolIcon.js';
import { getToolMeta } from '../../../lib/toolMeta.js';
import { Sparkline } from '../../../widgets/charts.js';
import type { UserAnalytics } from '../../../lib/apiSchemas.js';
import { fmtCount, formatStripDate } from './shared.js';
import EditsToolRing from './EditsToolRing.js';
import styles from './UsageDetailView.module.css';

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

export default function EditsPanel({ analytics }: { analytics: UserAnalytics }) {
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
