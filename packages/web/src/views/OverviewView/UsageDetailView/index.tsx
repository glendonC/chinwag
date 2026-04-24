import { useMemo, useState, type ReactNode } from 'react';
import {
  BreakdownList,
  BreakdownMeta,
  DetailSection,
  DetailView,
  DirectoryConstellation,
  FileConstellation,
  type DetailTabDef,
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
  MISSING_DELTA,
  splitDelta,
  formatCountDelta,
  formatUsdDelta,
} from './shared.js';
import SessionsPanel from './SessionsPanel.js';
import EditsPanel from './EditsPanel.js';
import LinesPanel from './LinesPanel.js';
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
