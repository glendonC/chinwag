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
  DirectoryColumns,
  DirectoryConstellation,
  FileChurnScatter,
  FileConstellation,
  FileFrictionRow,
  FileList,
  FileTreemap,
  HeroStatRow,
  InteractiveDailyChurn,
  type HeroStatDef,
  type InteractiveDailyChurnEntry,
} from '../../components/viz/index.js';
import RangePills from '../../components/RangePills/RangePills.jsx';
import { useTabs } from '../../hooks/useTabs.js';
import { setQueryParam, useQueryParam } from '../../lib/router.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { capabilityCoverageNote, CoverageNote, isSoloTeam } from '../../widgets/bodies/shared.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import { RANGES, formatScope, type RangeDays } from './overview-utils.js';
import { MISSING_DELTA, formatCountDelta, splitDelta } from './detailDelta.js';
import styles from './CodebaseDetailView.module.css';

/* CodebaseDetailView — file/directory axis on cross-tool agent activity.
 *
 * Companion to UsageDetailView (volume), OutcomesDetailView (did-it-land),
 * and ActivityDetailView (when/what kind). Codebase asks WHERE in the
 * code agents are working and what's drifting.
 *
 *   landscape    — treemap, completion-by-file constellation, churn shape
 *   directories  — top dirs columns, constellation, cold-dir staleness
 *   risk         — failing-files (rework × heatmap), collisions
 *   commits      — headline, per-tool, daily, vs completion
 *
 * The synthesizer's pre-pass cut Q3 of risk (daily-risk Simpson's-paradox
 * adjacency); tab carries on Q1+Q2 alone. */

const CODEBASE_TABS = ['landscape', 'directories', 'risk', 'commits'] as const;
type CodebaseTab = (typeof CODEBASE_TABS)[number];

function isCodebaseTab(value: string | null | undefined): value is CodebaseTab {
  return (CODEBASE_TABS as readonly string[]).includes(value ?? '');
}

interface Props {
  analytics: UserAnalytics;
  initialTab?: string | null;
  onBack: () => void;
  rangeDays: RangeDays;
  onRangeChange: (next: RangeDays) => void;
}

// Severity thresholds for the cold-dirs strip (per spec):
//   14-30d  → muted
//   30-60d  → warn
//   60+     → ghost
function staleSeverityColor(days: number): string {
  if (days >= 60) return 'var(--ghost)';
  if (days >= 30) return 'var(--warn)';
  return 'var(--muted)';
}

// Failing-file row severity: ≥50% rework rate is the high-signal red line,
// matches widget body's reworkSeverityColor mapping for the same field.
function reworkSeverityColor(ratio: number): string {
  return ratio >= 50 ? 'var(--danger)' : 'var(--warn)';
}

function fmtCount(n: number): string {
  return n.toLocaleString();
}

function fileBasename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

export default function CodebaseDetailView({
  analytics,
  initialTab,
  onBack,
  rangeDays,
  onRangeChange,
}: Props) {
  const resolved: CodebaseTab = isCodebaseTab(initialTab) ? initialTab : 'landscape';
  const tabControl = useTabs(CODEBASE_TABS, resolved);
  const { activeTab } = tabControl;

  const filesTouched = analytics.files_touched_total;
  const dirCount = analytics.directory_heatmap.length;
  const reworkCount = analytics.file_rework.length;
  const cs = analytics.commit_stats;

  // Files-touched proxy delta on daily edits — files_touched_total is a
  // distinct-count and not additive across days, so the spec defers to
  // the edits proxy. When daily_trends has fewer than 2 days populated
  // the delta falls back to em-dash.
  const filesTouchedDelta = useMemo(
    () => formatCountDelta(splitDelta(analytics.daily_trends, (d) => d.edits)),
    [analytics.daily_trends],
  );

  const commitDelta = useMemo(
    () => formatCountDelta(splitDelta(cs.daily_commits, (d) => d.commits)),
    [cs.daily_commits],
  );

  const tabs: Array<DetailTabDef<CodebaseTab>> = [
    {
      id: 'landscape',
      label: 'Landscape',
      value: filesTouched > 0 ? `${fmtCount(filesTouched)} files` : '--',
      delta: filesTouchedDelta,
    },
    {
      id: 'directories',
      label: 'Directories',
      value: dirCount > 0 ? `${fmtCount(dirCount)} dirs` : '--',
      delta: MISSING_DELTA,
    },
    {
      id: 'risk',
      label: 'Risk',
      value: reworkCount > 0 ? `${fmtCount(reworkCount)} files` : '--',
      delta: MISSING_DELTA,
    },
    {
      id: 'commits',
      label: 'Commits',
      value: cs.total_commits > 0 ? fmtCount(cs.total_commits) : '--',
      delta: commitDelta,
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
      title="codebase"
      subtitle={scopeSubtitle}
      actions={<RangePills value={rangeDays} onChange={onRangeChange} options={RANGES} />}
      tabs={tabs}
      tabControl={tabControl}
      idPrefix="codebase"
      tablistLabel="Codebase sections"
    >
      {activeTab === 'landscape' && <LandscapePanel analytics={analytics} />}
      {activeTab === 'directories' && <DirectoriesPanel analytics={analytics} />}
      {activeTab === 'risk' && <RiskPanel analytics={analytics} />}
      {activeTab === 'commits' && <CommitsPanel analytics={analytics} />}
    </DetailView>
  );
}

// ── Landscape panel ──────────────────────────────────

function LandscapePanel({ analytics }: { analytics: UserAnalytics }) {
  const activeId = useQueryParam('q');
  const files = analytics.file_heatmap;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const hooksNote = capabilityCoverageNote(tools, 'hooks');

  const workTypeTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of files) {
      const k = f.work_type || 'other';
      m.set(k, (m.get(k) ?? 0) + f.touch_count);
    }
    return m;
  }, [files]);

  const completionBuckets = useMemo(() => {
    let high = 0;
    let mid = 0;
    let low = 0;
    let withOutcome = 0;
    for (const f of files) {
      if (f.outcome_rate == null || f.outcome_rate <= 0) continue;
      withOutcome++;
      if (f.outcome_rate >= 70) high++;
      else if (f.outcome_rate >= 40) mid++;
      else low++;
    }
    return { high, mid, low, withOutcome };
  }, [files]);

  const churnEntries = useMemo(
    () =>
      files
        .filter((f) => (f.total_lines_added ?? 0) + (f.total_lines_removed ?? 0) > 0)
        .map((f) => ({
          file: f.file,
          lines_added: f.total_lines_added ?? 0,
          lines_removed: f.total_lines_removed ?? 0,
          work_type: f.work_type,
          touch_count: f.touch_count,
        })),
    [files],
  );

  const churnTop = useMemo(() => {
    if (churnEntries.length === 0) return null;
    return [...churnEntries].sort(
      (a, b) => b.lines_added + b.lines_removed - (a.lines_added + a.lines_removed),
    )[0];
  }, [churnEntries]);

  if (files.length === 0) {
    return (
      <div className={styles.panel}>
        <CoverageNote text={hooksNote} />
        <span className={styles.empty}>
          No file edits captured yet. The treemap fills as agents touch files this period.
        </span>
      </div>
    );
  }

  // ── Q1 landscape ── leading work-type share for prose
  const totalTouches = files.reduce((s, f) => s + f.touch_count, 0);
  const sortedWT = [...workTypeTotals.entries()].sort((a, b) => b[1] - a[1]);
  const topWt = sortedWT[0];
  const topPct = topWt && totalTouches > 0 ? Math.round((topWt[1] / totalTouches) * 100) : 0;
  const dirsLen = analytics.directory_heatmap.length;

  const landscapeAnswer =
    topWt && topPct >= 30 ? (
      <>
        <Metric>{fmtCount(analytics.files_touched_total)}</Metric> files touched across{' '}
        <Metric>{fmtCount(dirsLen)}</Metric> directories. <Metric>{topWt[0]}</Metric> dominates at{' '}
        <Metric>{topPct}%</Metric> of touches.
      </>
    ) : (
      <>
        <Metric>{fmtCount(analytics.files_touched_total)}</Metric> files touched, mixed work types.
      </>
    );

  // ── Q2 completion-by-file ── threshold counts using the same
  // outcome_rate cutoffs as outcomeRateColor (40/70). Files without a
  // populated outcome_rate are excluded from the count.
  const completionAnswer =
    completionBuckets.withOutcome === 0 ? null : (
      <>
        <Metric tone="positive">{completionBuckets.high}</Metric> files completed at 70%+,{' '}
        <Metric tone="warning">{completionBuckets.mid}</Metric> in the 40-69% middle band,{' '}
        <Metric tone="negative">{completionBuckets.low}</Metric> below 40% — a thrash signal.
      </>
    );

  // ── Q3 churn-shape ── lead with the top churner

  const churnAnswer = churnTop ? (
    <>
      <Metric>{fileBasename(churnTop.file)}</Metric> moved{' '}
      <Metric tone="positive">+{fmtCount(churnTop.lines_added)}</Metric> /{' '}
      <Metric tone="negative">−{fmtCount(churnTop.lines_removed)}</Metric> lines across{' '}
      <Metric>{fmtCount(churnTop.touch_count ?? 0)}</Metric> touches.
    </>
  ) : null;

  const questions: FocusedQuestion[] = [
    {
      id: 'landscape',
      question: 'Where are the agents working?',
      answer: landscapeAnswer,
      children: (
        <FileTreemap entries={files} totalFiles={analytics.files_touched_total} height={360} />
      ),
      relatedLinks: getCrossLinks('codebase', 'landscape', 'landscape'),
    },
  ];

  if (completionAnswer) {
    questions.push({
      id: 'completion-by-file',
      question: 'Which files actually finish what they start?',
      answer: completionAnswer,
      children: <FileConstellation entries={files} />,
    });
  } else {
    questions.push({
      id: 'completion-by-file',
      question: 'Which files actually finish what they start?',
      answer: (
        <>
          Completion rate appears once sessions touching files record outcomes. Most populate within
          the first 24h.
        </>
      ),
      children: (
        <span className={styles.empty}>
          Completion rate appears once sessions touching files record outcomes. Most populate within
          the first 24h.
        </span>
      ),
    });
  }

  if (churnAnswer && churnEntries.length > 0) {
    questions.push({
      id: 'churn-shape',
      question: 'How much code is moving through the hot files?',
      answer: churnAnswer,
      children: <FileChurnScatter entries={churnEntries} />,
    });
  } else {
    questions.push({
      id: 'churn-shape',
      question: 'How much code is moving through the hot files?',
      answer: (
        <>Lines-changed data populates from hooks. Active on Claude Code, Cursor, Windsurf today.</>
      ),
      children: (
        <span className={styles.empty}>
          Lines-changed data populates from hooks. Active on Claude Code, Cursor, Windsurf today.
        </span>
      ),
    });
  }

  return (
    <div className={styles.panel}>
      <CoverageNote text={hooksNote} />
      <FocusedDetailView
        questions={questions}
        activeId={activeId}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </div>
  );
}

// ── Directories panel ────────────────────────────────

function DirectoriesPanel({ analytics }: { analytics: UserAnalytics }) {
  const activeId = useQueryParam('q');
  const dirs = analytics.directory_heatmap;
  const stale = analytics.audit_staleness;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const hooksNote = capabilityCoverageNote(tools, 'hooks');

  const enriched = useMemo(
    () =>
      dirs.map((d) => ({
        ...d,
        avg_touches: d.touch_count / Math.max(1, d.file_count),
      })),
    [dirs],
  );
  const widestDeepest = useMemo(
    () =>
      [...enriched].sort((a, b) => b.file_count * b.avg_touches - a.file_count * a.avg_touches)[0],
    [enriched],
  );
  const focusedDir = useMemo(
    () =>
      [...enriched]
        .filter((d) => d.file_count <= 3 && d.avg_touches >= 2)
        .sort((a, b) => b.avg_touches - a.avg_touches)[0] ?? null,
    [enriched],
  );

  if (dirs.length === 0 && stale.length === 0) {
    return (
      <div className={styles.panel}>
        <CoverageNote text={hooksNote} />
        <span className={styles.empty}>
          Directory rollup needs at least one captured edit. Hooks are populating today on Claude
          Code, Cursor, and Windsurf.
        </span>
      </div>
    );
  }

  // ── Q1 top-dirs ──
  const topDir = dirs[0];
  const topDirsAnswer = topDir ? (
    <>
      <Metric>{topDir.directory}</Metric> leads with <Metric>{fmtCount(topDir.touch_count)}</Metric>{' '}
      touches across <Metric>{fmtCount(topDir.file_count)}</Metric> files. Completion sits at{' '}
      <Metric
        tone={
          topDir.completion_rate >= 70
            ? 'positive'
            : topDir.completion_rate >= 40
              ? 'warning'
              : 'negative'
        }
      >
        {topDir.completion_rate}%
      </Metric>
      .
    </>
  ) : null;

  // ── Q2 breadth-vs-depth ──
  const breadthAnswer = widestDeepest ? (
    <>
      <Metric>{widestDeepest.directory}</Metric> is wide-and-deep —{' '}
      <Metric>{fmtCount(widestDeepest.file_count)}</Metric> files,{' '}
      <Metric>{widestDeepest.avg_touches.toFixed(1)}</Metric> touches each.
      {focusedDir && focusedDir.directory !== widestDeepest.directory && (
        <>
          {' '}
          <Metric>{focusedDir.directory}</Metric> is rework-focused: few files, repeated touches.
        </>
      )}
    </>
  ) : null;

  // ── Q3 cold-dirs ──
  const coldAnswer =
    stale.length > 0 ? (
      <>
        <Metric>{fmtCount(stale.length)}</Metric> directories have prior activity but no edits in
        14+ days. Open these to confirm ownership or prune dead code.
      </>
    ) : null;

  const questions: FocusedQuestion[] = [];
  if (topDirsAnswer && dirs.length > 0) {
    questions.push({
      id: 'top-dirs',
      question: 'Which directories carry the work?',
      answer: topDirsAnswer,
      children: (
        <DirectoryColumns
          files={analytics.file_heatmap.map((f) => ({
            file: f.file,
            touch_count: f.touch_count,
            work_type: f.work_type,
          }))}
          height={240}
        />
      ),
    });
  } else {
    questions.push({
      id: 'top-dirs',
      question: 'Which directories carry the work?',
      answer: <>Activity rolls up by directory once files are touched.</>,
      children: (
        <span className={styles.empty}>Activity rolls up by directory once files are touched.</span>
      ),
    });
  }

  if (breadthAnswer && dirs.length > 0) {
    questions.push({
      id: 'breadth-vs-depth',
      question: 'Are we sprawling or focused?',
      answer: breadthAnswer,
      children: <DirectoryConstellation entries={dirs} />,
    });
  } else {
    questions.push({
      id: 'breadth-vs-depth',
      question: 'Are we sprawling or focused?',
      answer: <>Directory constellation needs at least one touched directory.</>,
      children: (
        <span className={styles.empty}>
          Directory constellation needs at least one touched directory.
        </span>
      ),
    });
  }

  if (coldAnswer) {
    questions.push({
      id: 'cold-dirs',
      question: 'Which directories has nobody touched in two weeks?',
      answer: coldAnswer,
      children: (
        <div className={styles.dataList}>
          {stale.slice(0, 12).map((d, i) => {
            const color = staleSeverityColor(d.days_since);
            return (
              <div
                key={d.directory}
                className={styles.dataRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span className={styles.dataName} title={d.directory}>
                  {d.directory}
                </span>
                <span
                  className={styles.daysStrip}
                  style={
                    {
                      '--strip-fill': `${Math.min(100, Math.round((d.days_since / 90) * 100))}%`,
                      '--strip-color': color,
                    } as CSSProperties
                  }
                  aria-hidden="true"
                />
                <span className={styles.dataMeta}>
                  <span className={styles.dataStatValue} style={{ color }}>
                    {d.days_since}d
                  </span>{' '}
                  · {fmtCount(d.prior_edit_count)} prior
                </span>
              </div>
            );
          })}
        </div>
      ),
    });
  } else {
    questions.push({
      id: 'cold-dirs',
      question: 'Which directories has nobody touched in two weeks?',
      answer: (
        <>
          No cold directories — everything with prior activity has been touched in the last 14 days.
        </>
      ),
      children: (
        <span className={styles.empty}>
          No cold directories — everything with prior activity has been touched in the last 14 days.
        </span>
      ),
    });
  }

  return (
    <div className={styles.panel}>
      <CoverageNote text={hooksNote} />
      <FocusedDetailView
        questions={questions}
        activeId={activeId}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </div>
  );
}

// ── Risk panel ───────────────────────────────────────

function RiskPanel({ analytics }: { analytics: UserAnalytics }) {
  const activeId = useQueryParam('q');
  const fr = analytics.file_rework;
  const ce = analytics.concurrent_edits;
  const fh = analytics.file_heatmap;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const hooksNote = capabilityCoverageNote(tools, 'hooks');

  if (fr.length === 0 && ce.length === 0) {
    return (
      <div className={styles.panel}>
        <CoverageNote text={hooksNote} />
        <span className={styles.empty}>
          No risk signal yet. Files appear here once sessions touching them end abandoned/failed, or
          once 14+-day cold directories accumulate.
        </span>
      </div>
    );
  }

  // High-churn × failing intersection. The Q1 question above ranks files
  // by failure rate alone, which surfaces files that fail often regardless
  // of how heavily they're worked. Q3 narrows to files that are both hot
  // and unstable — a file failing 60% of the time across 30 edits is a
  // different risk than the same rate across 4 edits. Joins on file path;
  // gracefully drops file_rework entries with no matching heatmap row
  // since the spec doesn't guarantee both lists carry every file.
  const heatmapByFile = new Map(fh.map((f) => [f.file, f.touch_count]));
  const churnFloor = (() => {
    if (fh.length === 0) return 0;
    const sorted = [...fh.map((f) => f.touch_count)].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  })();
  const intersection = fr
    .map((f) => ({
      file: f.file,
      rework_ratio: f.rework_ratio,
      total_edits: f.total_edits,
      failed_edits: f.failed_edits,
      touch_count: heatmapByFile.get(f.file) ?? 0,
    }))
    .filter((f) => f.touch_count >= churnFloor && f.touch_count > 0)
    .sort((a, b) => b.touch_count * b.rework_ratio - a.touch_count * a.rework_ratio)
    .slice(0, 5);

  // ── Q1 failing-files ── FileFrictionRow per spec; the FileConstellation
  // join described in the spec collapses to messy data when file_rework
  // entries don't always land in file_heatmap. The friction-row primitive
  // is the spec-endorsed fallback shape.
  const failingTop = fr[0];
  const failingAnswer = failingTop ? (
    <>
      <Metric>{fileBasename(failingTop.file)}</Metric> sits in failing sessions{' '}
      <Metric tone="negative">{failingTop.rework_ratio}%</Metric> of the time across{' '}
      <Metric>{fmtCount(failingTop.total_edits)}</Metric> edits.
    </>
  ) : null;

  // ── Q2 collisions ──
  const collisionTop = ce[0];
  const solo = isSoloTeam(analytics);
  const collisionAnswer =
    collisionTop && !solo ? (
      <>
        <Metric>{fileBasename(collisionTop.file)}</Metric> was touched by{' '}
        <Metric>{collisionTop.agents}</Metric> agents across{' '}
        <Metric>{fmtCount(collisionTop.edit_count)}</Metric> edits.
      </>
    ) : null;

  const questions: FocusedQuestion[] = [];
  if (failingAnswer && fr.length > 0) {
    questions.push({
      id: 'failing-files',
      question: 'Which files keep showing up in failing sessions?',
      answer: failingAnswer,
      children: (
        <div className={styles.frictionList}>
          {fr.slice(0, 10).map((f, i) => (
            <FileFrictionRow
              key={f.file}
              index={i}
              label={fileBasename(f.file)}
              title={f.file}
              barFill={f.rework_ratio / 100}
              barColor={reworkSeverityColor(f.rework_ratio)}
              meta={
                <>
                  {f.rework_ratio}% in failing sessions · {fmtCount(f.failed_edits)}/
                  {fmtCount(f.total_edits)} edits
                </>
              }
            />
          ))}
        </div>
      ),
      relatedLinks: getCrossLinks('codebase', 'risk', 'failing-files'),
    });
  } else {
    questions.push({
      id: 'failing-files',
      question: 'Which files keep showing up in failing sessions?',
      answer: <>No failing-session files in this window.</>,
      children: <span className={styles.empty}>No failing-session files in this window.</span>,
    });
  }

  // ── Q2 hot-and-failing ──
  // Read this *with* the failing-files list above, not in place of it: this
  // narrows to files that carry both kinds of risk so a brief review window
  // can prioritize the ones with the highest payoff.
  if (intersection.length > 0) {
    const topIntersection = intersection[0];
    const topName = fileBasename(topIntersection.file);
    questions.push({
      id: 'hot-and-failing',
      question: 'Which heavily worked files are also unstable?',
      answer: (
        <>
          <Metric>{topName}</Metric> sees{' '}
          <Metric>{fmtCount(topIntersection.touch_count)} touches</Metric> and fails{' '}
          <Metric tone="negative">{topIntersection.rework_ratio}%</Metric> of the time.
        </>
      ),
      children: (
        <div className={styles.frictionList}>
          {intersection.map((f, i) => (
            <FileFrictionRow
              key={f.file}
              index={i}
              label={fileBasename(f.file)}
              title={f.file}
              barFill={f.rework_ratio / 100}
              barColor={reworkSeverityColor(f.rework_ratio)}
              meta={
                <>
                  {fmtCount(f.touch_count)} touches · {f.rework_ratio}% in failing sessions
                </>
              }
            />
          ))}
        </div>
      ),
    });
  }

  if (collisionAnswer && ce.length > 0) {
    questions.push({
      id: 'collisions',
      question: 'Where are agents stepping on each other?',
      answer: collisionAnswer,
      children: (
        <FileList
          items={ce.slice(0, 10).map((f) => ({
            key: f.file,
            name: fileBasename(f.file),
            title: f.file,
            meta: (
              <>
                <span className={styles.fileListStat}>{f.agents}</span> agents ·{' '}
                <span className={styles.fileListStat}>{fmtCount(f.edit_count)}</span> edits
              </>
            ),
          }))}
        />
      ),
      relatedLinks: getCrossLinks('codebase', 'risk', 'collisions'),
    });
  } else if (solo) {
    questions.push({
      id: 'collisions',
      question: 'Where are agents stepping on each other?',
      answer: <>Requires 2+ agents touching the same file. Solo right now — structurally zero.</>,
      children: (
        <span className={styles.empty}>
          Requires 2+ agents touching the same file. Solo right now — structurally zero.
        </span>
      ),
    });
  } else {
    questions.push({
      id: 'collisions',
      question: 'Where are agents stepping on each other?',
      answer: <>No multi-agent edits in this window — the team is touching disjoint files.</>,
      children: (
        <span className={styles.empty}>
          No multi-agent edits in this window — the team is touching disjoint files.
        </span>
      ),
    });
  }

  return (
    <div className={styles.panel}>
      <CoverageNote text={hooksNote} />
      <FocusedDetailView
        questions={questions}
        activeId={activeId}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </div>
  );
}

// ── Commits panel ────────────────────────────────────

function CommitsPanel({ analytics }: { analytics: UserAnalytics }) {
  const activeId = useQueryParam('q');
  const cs = analytics.commit_stats;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const commitsNote = capabilityCoverageNote(tools, 'commitTracking');

  const peak = useMemo(() => {
    if (cs.daily_commits.length === 0) return null;
    return [...cs.daily_commits].sort((a, b) => b.commits - a.commits)[0];
  }, [cs.daily_commits]);

  if (cs.total_commits === 0) {
    return (
      <div className={styles.panel}>
        <CoverageNote text={commitsNote} />
        <span className={styles.empty}>
          Commits require hook tracking. Live on Claude Code, Cursor, and Windsurf today.
        </span>
      </div>
    );
  }

  // ── Q1 commits-headline ── HeroStatRow mirrors the on-cockpit widget
  const headlineStats: HeroStatDef[] = [
    {
      key: 'total',
      value: fmtCount(cs.total_commits),
      label: 'commits',
    },
    {
      key: 'per-session',
      value: cs.commits_per_session.toFixed(2),
      label: 'per session',
    },
    {
      key: 'sessions',
      value: fmtCount(cs.sessions_with_commits),
      label: 'sessions with commits',
    },
  ];
  if (cs.avg_time_to_first_commit_min != null) {
    headlineStats.push({
      key: 'first',
      value: cs.avg_time_to_first_commit_min.toFixed(1),
      unit: ' min',
      label: 'median to first commit',
    });
  }

  const headlineAnswer = (
    <>
      <Metric>{fmtCount(cs.total_commits)}</Metric> commits across{' '}
      <Metric>{fmtCount(cs.sessions_with_commits)}</Metric> sessions, averaging{' '}
      <Metric>{cs.commits_per_session.toFixed(2)}</Metric> per session.
      {cs.avg_time_to_first_commit_min != null && (
        <>
          {' '}
          Median time to first commit:{' '}
          <Metric>{cs.avg_time_to_first_commit_min.toFixed(1)} min</Metric>.
        </>
      )}
    </>
  );

  // ── Q2 commits-by-tool ──
  const byTool = [...cs.by_tool].sort((a, b) => b.commits - a.commits);
  const topToolBreakdown = byTool[0];
  const totalToolCommits = byTool.reduce((s, t) => s + t.commits, 0);
  const byToolAnswer = topToolBreakdown ? (
    <>
      <Metric>{getToolMeta(topToolBreakdown.host_tool).label}</Metric> drove{' '}
      <Metric>{fmtCount(topToolBreakdown.commits)}</Metric> commits, averaging{' '}
      <Metric>{topToolBreakdown.avg_files_changed.toFixed(1)}</Metric> files and{' '}
      <Metric>{fmtCount(Math.round(topToolBreakdown.avg_lines))}</Metric> lines per commit.
    </>
  ) : null;

  // ── Q3 daily-commits ──
  const dailyEntries: InteractiveDailyChurnEntry[] = [
    {
      key: 'commits',
      label: 'Commits',
      series: cs.daily_commits.map((d) => ({
        day: d.day,
        added: d.commits,
        removed: 0,
      })),
    },
  ];
  const lows = cs.daily_commits.filter((d) => d.commits === 0).length;
  const dailyAnswer = peak ? (
    <>
      Commits peaked at <Metric>{fmtCount(peak.commits)}</Metric> on <Metric>{peak.day}</Metric>;
      flat at <Metric>{fmtCount(lows)}</Metric> active days with no commits.
    </>
  ) : null;

  // ── Q4 commits-vs-completion ──
  const oc = cs.outcome_correlation;
  const withCommits = oc.find((b) => /with/i.test(b.bucket) && !/no|without/i.test(b.bucket));
  const noCommits = oc.find((b) => /no|without/i.test(b.bucket));
  const onlyOne = oc.length === 1;
  const correlationAnswer =
    withCommits && noCommits ? (
      <>
        Sessions with commits complete at{' '}
        <Metric tone="positive">{withCommits.completion_rate}%</Metric>, vs{' '}
        <Metric tone="warning">{noCommits.completion_rate}%</Metric> for sessions with none.
      </>
    ) : onlyOne && oc[0] ? (
      <>
        <Metric>{oc[0].completion_rate}%</Metric> completion across{' '}
        <Metric>{fmtCount(oc[0].sessions)}</Metric> {oc[0].bucket} sessions in this window.
      </>
    ) : null;

  const questions: FocusedQuestion[] = [
    {
      id: 'commits-headline',
      question: 'How much landed as actual commits?',
      answer: headlineAnswer,
      children: <HeroStatRow stats={headlineStats} />,
      relatedLinks: getCrossLinks('codebase', 'commits', 'commits-headline'),
    },
  ];

  if (byToolAnswer && byTool.length > 0) {
    const maxCommits = Math.max(...byTool.map((t) => t.commits), 1);
    questions.push({
      id: 'commits-by-tool',
      question: 'Which tools are committing?',
      answer: byToolAnswer,
      children: (
        <BreakdownList
          items={byTool.map((t) => {
            const meta = getToolMeta(t.host_tool);
            const share = totalToolCommits > 0 ? (t.commits / totalToolCommits) * 100 : 0;
            return {
              key: t.host_tool,
              label: meta.label,
              fillPct: (t.commits / maxCommits) * 100,
              fillColor: meta.color,
              value: (
                <>
                  {fmtCount(t.commits)} commits
                  <BreakdownMeta>
                    {' · '}
                    {Math.round(share)}% · {t.avg_files_changed.toFixed(1)} files ·{' '}
                    {fmtCount(Math.round(t.avg_lines))} lines/commit
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
      id: 'commits-by-tool',
      question: 'Which tools are committing?',
      answer: <>Per-tool commit data populates as tools with commit hooks run sessions.</>,
      children: (
        <span className={styles.empty}>
          Per-tool commit data populates as tools with commit hooks run sessions.
        </span>
      ),
    });
  }

  if (dailyAnswer && cs.daily_commits.length > 0) {
    questions.push({
      id: 'daily-commits',
      question: 'When did commits land?',
      answer: dailyAnswer,
      children: <InteractiveDailyChurn entries={dailyEntries} unitLabel="commits" />,
    });
  } else {
    questions.push({
      id: 'daily-commits',
      question: 'When did commits land?',
      answer: <>Commits day-by-day populates with commit-tracking tools running sessions.</>,
      children: (
        <span className={styles.empty}>
          Commits day-by-day populates with commit-tracking tools running sessions.
        </span>
      ),
    });
  }

  // Q4 — skip when fewer than 2 buckets per spec edge guard.
  if (oc.length >= 2 && correlationAnswer) {
    questions.push({
      id: 'commits-vs-completion',
      question: 'Do committing sessions actually finish?',
      answer: correlationAnswer,
      children: (
        <CompletionBucketBars
          buckets={oc.map((b) => ({
            label: b.bucket,
            rate: b.completion_rate,
            sessions: b.sessions,
          }))}
        />
      ),
    });
  } else if (onlyOne && correlationAnswer && oc[0]) {
    const only = oc[0];
    questions.push({
      id: 'commits-vs-completion',
      question: 'Do committing sessions actually finish?',
      answer: correlationAnswer,
      children: (
        <CompletionBucketBars
          buckets={[
            {
              label: only.bucket,
              rate: only.completion_rate,
              sessions: only.sessions,
            },
          ]}
          footer={`No comparison — all sessions in this window ${
            /no|without/i.test(only.bucket) ? 'did not commit' : 'committed'
          }.`}
        />
      ),
    });
  }

  return (
    <div className={styles.panel}>
      <CoverageNote text={commitsNote} />
      <FocusedDetailView
        questions={questions}
        activeId={activeId}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </div>
  );
}

// ── Inline viz: completion bucket bars ──────────────
// Two-row horizontal bars for the commits-vs-completion question. Reuses
// the `wtBarTrack`/`wtBarFill` semantics from OutcomesDetailView's
// WorkTypesPanel — same chrome, scoped here so codebase doesn't reach
// into outcomes' private CSS module.

interface BucketBar {
  label: string;
  rate: number;
  sessions: number;
}

function CompletionBucketBars({ buckets, footer }: { buckets: BucketBar[]; footer?: string }) {
  const maxRate = Math.max(...buckets.map((b) => b.rate), 1);
  return (
    <div className={styles.bucketList}>
      {buckets.map((b, i) => (
        <div
          key={b.label}
          className={styles.bucketRow}
          style={{ '--row-index': i } as CSSProperties}
        >
          <span className={styles.bucketLabel}>{b.label}</span>
          <div className={styles.bucketTrack}>
            <div
              className={styles.bucketFill}
              style={{
                width: `${(b.rate / maxRate) * 100}%`,
                background:
                  b.rate >= 70 ? 'var(--success)' : b.rate >= 40 ? 'var(--warn)' : 'var(--danger)',
              }}
            />
          </div>
          <span className={styles.bucketValue}>
            {b.rate}%<span className={styles.bucketValueSoft}>{fmtCount(b.sessions)} sessions</span>
          </span>
        </div>
      ))}
      {footer && <p className={styles.bucketFooter}>{footer}</p>}
    </div>
  );
}
