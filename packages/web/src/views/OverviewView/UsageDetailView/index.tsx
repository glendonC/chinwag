import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  BreakdownList,
  BreakdownMeta,
  DetailSection,
  DetailView,
  DirectoryConstellation,
  DivergingColumns,
  DivergingRows,
  FileChurnScatter,
  FileConstellation,
  HeroStatRow,
  InteractiveDailyChurn,
  LegendDot,
  type DetailTabDef,
  type DivergingRowEntry,
  type DivergingSeries,
  type HeroStatDef,
  type InteractiveDailyChurnEntry,
} from '../../../components/DetailView/index.js';
import RangePills from '../../../components/RangePills/RangePills.jsx';
import ToolIcon from '../../../components/ToolIcon/ToolIcon.js';
import { WorkTypeStrip } from '../../../components/WorkTypeStrip/index.js';
import { useTabs } from '../../../hooks/useTabs.js';
import { getToolMeta } from '../../../lib/toolMeta.js';
import type { UserAnalytics } from '../../../lib/apiSchemas.js';
import { formatCost } from '../../../widgets/utils.js';
import { hasCostData } from '../../../widgets/bodies/shared.js';
import { RANGES, formatScope, type RangeDays } from '../overview-utils.js';
import {
  fmtCount,
  fmtPct,
  formatStripDate,
  MISSING_DELTA,
  splitDelta,
  formatCountDelta,
  formatUsdDelta,
} from './shared.js';
import SessionsPanel from './SessionsPanel.js';
import EditsPanel from './EditsPanel.js';
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
