import { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  DetailSection,
  DivergingColumns,
  DivergingRows,
  FileChurnScatter,
  HeroStatRow,
  InteractiveDailyChurn,
  LegendDot,
  type DivergingRowEntry,
  type DivergingSeries,
  type HeroStatDef,
  type InteractiveDailyChurnEntry,
} from '../../../components/DetailView/index.js';
import type { UserAnalytics } from '../../../lib/apiSchemas.js';
import { fmtCount, formatStripDate } from './shared.js';
import styles from './UsageDetailView.module.css';

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

export default function LinesPanel({ analytics }: { analytics: UserAnalytics }) {
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
