import { useMemo, useState, type CSSProperties } from 'react';
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
  RateStrip,
  ToolCoverageMatrix,
  type RateEntry,
  type ToolCoverageEntry,
} from '../../components/viz/index.js';
import RangePills from '../../components/RangePills/RangePills.jsx';
import { useTabs } from '../../hooks/useTabs.js';
import { setQueryParam, useQueryParam } from '../../lib/router.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { aggregateModels } from '../../widgets/utils.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import { CoverageNote, capabilityCoverageNote, GhostRows } from '../../widgets/bodies/shared.js';
import { getDataCapabilities } from '@chinmeister/shared/tool-registry.js';
import type { UserAnalytics } from '../../lib/apiSchemas.js';
import shared from '../../widgets/widget-shared.module.css';
import { RANGES, formatScope, type RangeDays } from './overview-utils.js';
import { MISSING_DELTA } from './detailDelta.js';
import styles from './ToolsDetailView.module.css';

/* ToolsDetailView — coordination axis on cross-tool agent activity.
 *
 * Companion to UsageDetailView (volume), OutcomesDetailView (did-it-land),
 * ActivityDetailView (when/what), CodebaseDetailView (where in the code).
 * Tools asks WHERE work flows across tools and where it gets stuck.
 *
 *   tools  — coverage matrix, workload, models (per-tool brand attribution)
 *   flow   — handoff pairs, gap (cross-tool latency)
 *   errors — top errors by tool, recent errors timeline, token costs
 *
 * The synthesizer's pre-pass cut Q3 of flow (handoff completion vs
 * single-tool baseline; Simpson's-paradox-adjacent). Models stays a
 * sub-question of Tools per the 2026-04-25 demote — promoting it would
 * multiply §10 #5 surface area without the work-type filter affordance
 * that mitigation requires. */

const TOOLS_TABS = ['tools', 'flow', 'errors'] as const;
type ToolsTab = (typeof TOOLS_TABS)[number];

function isToolsTab(value: string | null | undefined): value is ToolsTab {
  return (TOOLS_TABS as readonly string[]).includes(value ?? '');
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

// Completion tone helper used inside the flow-pairs answer prose.
function completionTone(rate: number): 'positive' | 'warning' | 'negative' {
  if (rate >= 70) return 'positive';
  if (rate >= 40) return 'warning';
  return 'negative';
}

export default function ToolsDetailView({
  analytics,
  initialTab,
  onBack,
  rangeDays,
  onRangeChange,
}: Props) {
  const resolved: ToolsTab = isToolsTab(initialTab) ? initialTab : 'tools';
  const tabControl = useTabs(TOOLS_TABS, resolved);
  const { activeTab } = tabControl;

  const tools = analytics.tool_comparison;
  const handoffs = analytics.tool_handoffs;
  const errs = analytics.tool_call_stats.error_patterns;
  const callStats = analytics.tool_call_stats;

  const activeTools = useMemo(() => tools.filter((t) => t.sessions > 0), [tools]);
  const totalEdges = handoffs.length;
  const totalErrors = errs.reduce((s, e) => s + e.count, 0);

  // Errors tab value: total tool-call errors across all patterns.
  // Spec calls for an `error_rate%` chip when `tool_call_stats` carries
  // a period delta. Today the schema has no previous-period error_rate
  // so we render em-dash per the MISSING_DELTA convention.
  const tabs: Array<DetailTabDef<ToolsTab>> = [
    {
      id: 'tools',
      label: 'Tools',
      value: activeTools.length > 0 ? fmtCount(activeTools.length) : '--',
      delta: MISSING_DELTA,
    },
    {
      id: 'flow',
      label: 'Flow',
      value: totalEdges > 0 ? fmtCount(totalEdges) : '--',
      delta: MISSING_DELTA,
    },
    {
      id: 'errors',
      label: 'Errors',
      value: totalErrors > 0 ? fmtCount(totalErrors) : '--',
      delta: MISSING_DELTA,
    },
  ];

  const scopeSubtitle = useMemo(() => {
    return (
      formatScope([
        { count: activeTools.length, singular: 'tool' },
        { count: analytics.teams_included, singular: 'project' },
      ]) || undefined
    );
  }, [activeTools.length, analytics.teams_included]);

  return (
    <DetailView
      backLabel="Overview"
      onBack={onBack}
      title="tools"
      subtitle={scopeSubtitle}
      actions={<RangePills value={rangeDays} onChange={onRangeChange} options={RANGES} />}
      tabs={tabs}
      tabControl={tabControl}
      idPrefix="tools"
      tablistLabel="Tools sections"
    >
      {activeTab === 'tools' && <ToolsPanel analytics={analytics} />}
      {activeTab === 'flow' && <FlowPanel analytics={analytics} />}
      {activeTab === 'errors' && <ErrorsPanel analytics={analytics} callStats={callStats} />}
    </DetailView>
  );
}

// ── Tools panel ─────────────────────────────────────

function ToolsPanel({ analytics }: { analytics: UserAnalytics }) {
  const activeId = useQueryParam('q');
  const tools = analytics.tool_comparison;
  const reporting = analytics.data_coverage?.tools_reporting ?? [];
  const tokenNote = capabilityCoverageNote(reporting, 'tokenUsage');

  // ── Q1 coverage ── tools × capabilities affordance grid.
  // Capabilities sourced from the shared registry's DataCapabilities so
  // the matrix stays in sync with what each parser actually exposes.
  // All hooks must run before any early returns; React's rules-of-hooks
  // requires consistent call order regardless of branch.
  const coverageEntries: ToolCoverageEntry[] = useMemo(
    () =>
      tools.map((t) => {
        const meta = getToolMeta(t.host_tool);
        const caps = getDataCapabilities(t.host_tool);
        return {
          id: t.host_tool,
          label: meta.label,
          color: meta.color,
          capabilities: {
            conversationLogs: caps.conversationLogs === true,
            tokenUsage: caps.tokenUsage === true,
            toolCallLogs: caps.toolCallLogs === true,
            hooks: caps.hooks === true,
            commitTracking: caps.commitTracking === true,
          },
        };
      }),
    [tools],
  );

  const modelRows = useMemo(
    () => aggregateModels(analytics.model_outcomes),
    [analytics.model_outcomes],
  );

  const modelToolCount = useMemo(() => {
    const set = new Set<string>();
    for (const m of modelRows) {
      for (const t of m.byTool) set.add(t.host_tool);
    }
    return set.size;
  }, [modelRows]);

  if (tools.length === 0) {
    return (
      <div className={styles.panel}>
        <span className={styles.empty}>
          Connect a tool with `chinmeister add &lt;tool&gt;` to populate.
        </span>
      </div>
    );
  }

  const deepCount = coverageEntries.filter((e) => e.capabilities.hooks === true).length;
  const mcpOnly = coverageEntries.length - deepCount;

  const coverageAnswer = (
    <>
      <Metric>{fmtCount(coverageEntries.length)}</Metric> tools reported activity.{' '}
      {deepCount > 0 && (
        <>
          <Metric tone="positive">{fmtCount(deepCount)}</Metric> sent hooks
          {mcpOnly > 0 ? '; ' : '.'}
        </>
      )}
      {mcpOnly > 0 && (
        <>
          <Metric tone="warning">{fmtCount(mcpOnly)}</Metric> {mcpOnly === 1 ? 'is' : 'are'}{' '}
          MCP-only (presence + claims, no edits).
        </>
      )}
    </>
  );

  // ── Q2 workload ── per-tool sessions+edits with completion as a
  // muted contextual stat, not a sortable rank. §10 #5 guardrail —
  // we lead with sessions, color the bar with the brand, and surface
  // completion as dim text per spec.
  const totalSessions = tools.reduce((s, t) => s + t.sessions, 0);
  const sortedByEdits = [...tools].sort((a, b) => b.total_edits - a.total_edits);
  const topTool = sortedByEdits[0];
  const topShare =
    topTool && totalSessions > 0 ? Math.round((topTool.sessions / totalSessions) * 100) : 0;
  const maxEdits = Math.max(...tools.map((t) => t.total_edits), 1);

  const workloadAnswer = topTool ? (
    <>
      <Metric>{getToolMeta(topTool.host_tool).label}</Metric> ran{' '}
      <Metric>{fmtCount(topTool.sessions)}</Metric> sessions and{' '}
      <Metric>{fmtCount(topTool.total_edits)}</Metric> edits — about <Metric>{topShare}%</Metric> of
      activity.
    </>
  ) : null;

  // ── Q3 models ── per-model rows with per-tool attribution pills.
  // Lifted directly from ModelsList in ToolWidgets.tsx — the brand-color
  // pill is exactly the §10 #5 mitigation that justifies this question.
  const topModel = modelRows[0];
  const topModelShare =
    topModel && modelRows.length > 0
      ? Math.round((topModel.total / modelRows.reduce((s, m) => s + m.total, 0)) * 100)
      : 0;

  const modelsAnswer = topModel ? (
    <>
      <Metric>{fmtCount(modelRows.length)}</Metric> models observed across{' '}
      <Metric>{fmtCount(modelToolCount)}</Metric> tools. <Metric>{topModel.model}</Metric> has the
      most sessions (<Metric>{topModelShare}%</Metric>); model attribution requires tool-call or
      token logs.
    </>
  ) : null;

  const questions: FocusedQuestion[] = [
    {
      id: 'coverage',
      question: 'Which tools are reporting, and how deeply?',
      answer: coverageAnswer,
      children: <ToolCoverageMatrix tools={coverageEntries} />,
    },
    {
      id: 'workload',
      question: 'Where is the work landing?',
      answer: workloadAnswer ?? <>No tools have recorded sessions in this window.</>,
      children: workloadAnswer ? (
        <BreakdownList
          items={sortedByEdits.map((t) => {
            const meta = getToolMeta(t.host_tool);
            const sessionShare =
              totalSessions > 0 ? Math.round((t.sessions / totalSessions) * 100) : 0;
            return {
              key: t.host_tool,
              label: meta.label,
              fillPct: (t.total_edits / maxEdits) * 100,
              fillColor: meta.color,
              value: (
                <>
                  {fmtCount(t.sessions)} sessions
                  <BreakdownMeta>
                    {' · '}
                    {fmtCount(t.total_edits)} edits · {sessionShare}% share
                    {t.completion_rate > 0 && (
                      <span className={styles.workloadValueSoft}>
                        {t.completion_rate}% complete
                      </span>
                    )}
                  </BreakdownMeta>
                </>
              ),
            };
          })}
        />
      ) : (
        <span className={styles.empty}>Per-tool workload appears once tools record sessions.</span>
      ),
      relatedLinks: getCrossLinks('tools', 'tools', 'workload'),
    },
  ];

  if (modelRows.length > 0 && modelsAnswer) {
    questions.push({
      id: 'models',
      question: 'Which models are running, and through which tools?',
      answer: modelsAnswer,
      children: <ModelsBlock rows={modelRows} />,
    });
  } else {
    questions.push({
      id: 'models',
      question: 'Which models are running, and through which tools?',
      answer: <>Model data appears as tools with token or tool-call logs run sessions.</>,
      children: (
        <>
          <span className={styles.empty}>
            Model data appears as tools with token or tool-call logs run sessions.
          </span>
          <CoverageNote text={tokenNote} />
        </>
      ),
    });
  }

  return (
    <div className={styles.panel}>
      <FocusedDetailView
        questions={questions}
        activeId={activeId}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </div>
  );
}

function ModelsBlock({ rows }: { rows: ReturnType<typeof aggregateModels> }) {
  return (
    <div className={styles.modelList}>
      {rows.map((m, i) => (
        <div
          key={m.model}
          className={styles.modelRow}
          style={{ '--row-index': i } as CSSProperties}
        >
          <div className={styles.modelHead}>
            <span className={styles.modelName}>{m.model}</span>
            <div className={styles.modelStats}>
              <span className={styles.modelStat}>
                <span className={styles.modelStatValue}>{fmtCount(m.total)}</span> sessions
              </span>
              <span className={styles.modelStat}>
                <span className={styles.modelStatValue}>{fmtCount(m.edits)}</span> edits
              </span>
              {m.avgMin > 0 && (
                <span className={styles.modelStat}>
                  <span className={styles.modelStatValue}>{m.avgMin.toFixed(1)}m</span> avg
                </span>
              )}
              {m.rate > 0 && (
                <span className={styles.modelStat}>
                  <span className={styles.modelStatValue}>{m.rate}%</span>
                </span>
              )}
            </div>
          </div>
          {m.byTool.length > 0 && (
            <div className={styles.modelToolStrip}>
              {m.byTool.map((t) => {
                if (t.host_tool === 'unknown') {
                  return (
                    <span key="unknown" className={styles.modelToolPill}>
                      <span className={styles.modelToolDot} />
                      <span className={styles.modelToolLabel}>unattributed</span>
                      <span className={styles.modelToolCount}>{t.count}</span>
                    </span>
                  );
                }
                const meta = getToolMeta(t.host_tool);
                return (
                  <span
                    key={t.host_tool}
                    className={styles.modelToolPill}
                    style={{ '--tool-brand': meta.color } as CSSProperties}
                  >
                    <span className={styles.modelToolDot} />
                    <span className={styles.modelToolLabel}>{meta.label}</span>
                    <span className={styles.modelToolCount}>{t.count}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Flow panel ──────────────────────────────────────

function FlowPanel({ analytics }: { analytics: UserAnalytics }) {
  const activeId = useQueryParam('q');
  const handoffs = analytics.tool_handoffs;

  // All hooks must run before any early return.
  const sortedByCount = useMemo(
    () => [...handoffs].sort((a, b) => b.file_count - a.file_count),
    [handoffs],
  );
  // ── Q2 gap ── RateStrip per pair. Rate is gap-minutes; weight is
  // file count so heavier handoffs get larger dots. Suppressed when
  // fewer than 2 handoffs (per spec edge guard).
  const gapEntries: RateEntry[] = useMemo(
    () =>
      sortedByCount.slice(0, 12).map((h) => {
        const fromMeta = getToolMeta(h.from_tool);
        const toMeta = getToolMeta(h.to_tool);
        return {
          key: `${h.from_tool}-${h.to_tool}`,
          label: (
            <span className={styles.pairLabel}>
              <span className={styles.pairDot} style={{ background: fromMeta.color }} />
              <span className={styles.pairText}>{fromMeta.label}</span>
              <span className={styles.pairArrow}>→</span>
              <span className={styles.pairDot} style={{ background: toMeta.color }} />
              <span className={styles.pairText}>{toMeta.label}</span>
            </span>
          ),
          rate: h.avg_gap_minutes,
          weight: h.file_count,
        };
      }),
    [sortedByCount],
  );

  if (handoffs.length === 0) {
    const toolCount = analytics.tool_comparison.length;
    const message =
      toolCount <= 1
        ? 'Add a second tool with `chinmeister add <tool>` to see how agents hand off files.'
        : 'No cross-tool handoffs yet — agents are staying within one tool.';
    return (
      <div className={styles.panel}>
        <span className={styles.empty}>{message}</span>
      </div>
    );
  }

  const topPair = sortedByCount[0];
  const totalEdges = handoffs.length;
  const distinctPairs = new Set(handoffs.map((h) => [h.from_tool, h.to_tool].sort().join('|')))
    .size;
  const totalFiles = handoffs.reduce((s, h) => s + h.file_count, 0);
  const maxFiles = Math.max(...handoffs.map((h) => h.file_count), 1);

  // ── Q1 pairs ── BreakdownList fallback for the chord viz (per spec
  // reach guardrail). Each row label composes [from-dot] from → [to-dot]
  // to with brand colors. Bar value is file count, completion rate
  // surfaces as muted meta text — NOT used to colorize the bar (the
  // bar carries the brand of the source tool to keep the visual
  // grouped on origin).
  const pairsAnswer = topPair ? (
    <>
      <Metric>
        {getToolMeta(topPair.from_tool).label} → {getToolMeta(topPair.to_tool).label}
      </Metric>{' '}
      moved <Metric>{fmtCount(topPair.file_count)}</Metric> files at{' '}
      <Metric tone={completionTone(topPair.handoff_completion_rate)}>
        {topPair.handoff_completion_rate}%
      </Metric>{' '}
      completion. Across all pairs: <Metric>{fmtCount(totalEdges)}</Metric> handoffs in{' '}
      <Metric>{fmtCount(distinctPairs)}</Metric> directions.
    </>
  ) : null;

  const inSession = handoffs.filter((h) => h.avg_gap_minutes < 5).length;
  const sortedGaps = [...handoffs.map((h) => h.avg_gap_minutes)].sort((a, b) => a - b);
  const medianGap =
    sortedGaps.length === 0
      ? 0
      : sortedGaps.length % 2 === 0
        ? (sortedGaps[sortedGaps.length / 2 - 1] + sortedGaps[sortedGaps.length / 2]) / 2
        : sortedGaps[Math.floor(sortedGaps.length / 2)];

  const gapAnswer = (
    <>
      Median gap between tools is <Metric>{medianGap.toFixed(1)} min</Metric>
      {inSession > 0 && (
        <>
          {' '}
          — most handoffs (<Metric>{fmtCount(inSession)}</Metric>) happen inside the same session.
        </>
      )}
      .
    </>
  );

  const questions: FocusedQuestion[] = [];
  if (pairsAnswer) {
    questions.push({
      id: 'pairs',
      question: 'Which tool pairs are passing files most?',
      answer: pairsAnswer,
      children: (
        <BreakdownList
          items={sortedByCount.slice(0, 12).map((h) => {
            const fromMeta = getToolMeta(h.from_tool);
            const toMeta = getToolMeta(h.to_tool);
            const share = totalFiles > 0 ? Math.round((h.file_count / totalFiles) * 100) : 0;
            return {
              key: `${h.from_tool}-${h.to_tool}`,
              label: (
                <span className={styles.pairLabel}>
                  <span className={styles.pairDot} style={{ background: fromMeta.color }} />
                  <span className={styles.pairText}>{fromMeta.label}</span>
                  <span className={styles.pairArrow}>→</span>
                  <span className={styles.pairDot} style={{ background: toMeta.color }} />
                  <span className={styles.pairText}>{toMeta.label}</span>
                </span>
              ),
              fillPct: (h.file_count / maxFiles) * 100,
              fillColor: fromMeta.color,
              value: (
                <>
                  {fmtCount(h.file_count)} files
                  <BreakdownMeta>
                    {' · '}
                    {share}% · {h.handoff_completion_rate}% complete
                  </BreakdownMeta>
                </>
              ),
            };
          })}
        />
      ),
      relatedLinks: getCrossLinks('tools', 'flow', 'pairs'),
    });
  }

  if (handoffs.length >= 2) {
    questions.push({
      id: 'gap',
      question: 'How fast does the handoff happen?',
      answer: gapAnswer,
      children: (
        <RateStrip
          entries={gapEntries}
          format={(n) => `${n.toFixed(1)} min`}
          metaFormat={(n) => `${fmtCount(n)} files`}
        />
      ),
    });
  }

  return (
    <div className={styles.panel}>
      <FocusedDetailView
        questions={questions}
        activeId={activeId}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </div>
  );
}

// ── Errors panel ────────────────────────────────────

function ErrorsPanel({
  analytics,
  callStats,
}: {
  analytics: UserAnalytics;
  callStats: UserAnalytics['tool_call_stats'];
}) {
  const activeId = useQueryParam('q');
  const errs = callStats.error_patterns;
  const reporting = analytics.data_coverage?.tools_reporting ?? [];
  const toolCallNote = capabilityCoverageNote(reporting, 'toolCallLogs');
  const tokenNote = capabilityCoverageNote(reporting, 'tokenUsage');
  const tu = analytics.token_usage;

  // ── Q1 top ── group errors by tool, render one section per tool
  // sorted by section error count desc. Per-tool brand-color section
  // header. Each row: count× pill, error preview, last-seen relative
  // time. This is the cross-tool error TOPOLOGY surface — the spec is
  // explicit that this belongs here, not in Outcomes.
  const errorsByTool = useMemo(() => {
    const map = new Map<string, typeof errs>();
    for (const e of errs) {
      const list = map.get(e.tool) ?? [];
      list.push(e);
      map.set(e.tool, list);
    }
    const out = [...map.entries()].map(([tool, list]) => ({
      tool,
      total: list.reduce((s, x) => s + x.count, 0),
      patterns: [...list].sort((a, b) => b.count - a.count),
    }));
    return out.sort((a, b) => b.total - a.total);
  }, [errs]);

  const distinct = errs.length;
  const topErr = useMemo(
    () => (errs.length === 0 ? null : [...errs].sort((a, b) => b.count - a.count)[0]),
    [errs],
  );
  const toolCount = errorsByTool.length;

  const topAnswer = topErr ? (
    <>
      <Metric tone="negative">{topErr.count}×</Metric> <Metric>{topErr.tool}</Metric> errors —
      &lsquo;<em>{topErr.error_preview.slice(0, 80)}</em>&rsquo;.{' '}
      <Metric>{fmtCount(distinct)}</Metric> distinct error patterns across{' '}
      <Metric>{fmtCount(toolCount)}</Metric> tools.
    </>
  ) : null;

  // ── Q2 recent ── most recent 8 errors, newest at top, oldest bottom.
  // Relative-time chip + brand-colored tool pill + preview. nowMs
  // captured once at mount via useState lazy init (the same pattern
  // MemoryWidgets uses) so re-renders stay pure — no Date.now in render.
  const [nowMs] = useState(() => Date.now());
  const recentList = useMemo(
    () =>
      [...errs]
        .filter((e) => e.last_at != null)
        .sort((a, b) => (a.last_at! < b.last_at! ? 1 : -1))
        .slice(0, 8),
    [errs],
  );
  const recent24hCount = useMemo(
    () =>
      errs
        .filter((e) => {
          if (!e.last_at) return false;
          return nowMs - new Date(e.last_at).getTime() < 24 * 60 * 60 * 1000;
        })
        .reduce((s, e) => s + e.count, 0),
    [errs, nowMs],
  );
  const lastSeen = recentList[0]?.last_at ?? null;
  const recentAnswer =
    recent24hCount > 0 ? (
      <>
        <Metric>{fmtCount(recent24hCount)}</Metric> errors in the last 24h
        {lastSeen && (
          <>
            , last seen <Metric>{formatRelativeTime(lastSeen)}</Metric> ago
          </>
        )}
        .
      </>
    ) : null;

  // ── Q3 tokens ── lifted directly from TokenDetailWidget body.
  const topModelByCost = useMemo(() => {
    if (tu.by_model.length === 0) return null;
    return [...tu.by_model].sort(
      (a, b) => (b.estimated_cost_usd ?? 0) - (a.estimated_cost_usd ?? 0),
    )[0];
  }, [tu.by_model]);
  const tokenAnswer =
    tu.sessions_with_token_data > 0 && topModelByCost ? (
      <>
        <Metric>{fmtCount(tu.by_model.length)}</Metric> models across{' '}
        <Metric>{fmtCount(tu.by_tool.length)}</Metric> tools. Highest spend:{' '}
        <Metric>{topModelByCost.agent_model}</Metric> at{' '}
        <Metric>
          {topModelByCost.estimated_cost_usd != null && topModelByCost.estimated_cost_usd > 0
            ? `$${topModelByCost.estimated_cost_usd.toFixed(2)}`
            : '—'}
        </Metric>
        .
      </>
    ) : null;

  const questions: FocusedQuestion[] = [];

  if (errs.length === 0) {
    questions.push({
      id: 'top',
      question: 'Which errors are recurring?',
      answer: <>No tool-call errors in this window.</>,
      children: (
        <>
          <span className={styles.empty}>No tool errors</span>
          <CoverageNote text={toolCallNote} />
        </>
      ),
      relatedLinks: getCrossLinks('tools', 'errors', 'top'),
    });
  } else {
    questions.push({
      id: 'top',
      question: 'Which errors are recurring?',
      answer: topAnswer,
      children: (
        <>
          {errorsByTool.map((group) => {
            const meta = getToolMeta(group.tool);
            return (
              <div key={group.tool} className={styles.toolGroup}>
                <div className={styles.toolGroupHead}>
                  <span className={styles.toolGroupDot} style={{ background: meta.color }} />
                  <span>{meta.label}</span>
                  <span className={styles.toolGroupCount}>
                    {fmtCount(group.total)} errors · {group.patterns.length} patterns
                  </span>
                </div>
                <div className={shared.dataList}>
                  {group.patterns.map((e, i) => (
                    <div
                      key={`${group.tool}-${i}-${e.error_preview.slice(0, 16)}`}
                      className={shared.dataRow}
                      style={{ '--row-index': i } as CSSProperties}
                    >
                      <span className={styles.errCountPill}>{e.count}×</span>
                      <span className={styles.errPreview} title={e.error_preview}>
                        {e.error_preview.slice(0, 120)}
                      </span>
                      {e.last_at && (
                        <span className={styles.errLast}>{formatRelativeTime(e.last_at)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <CoverageNote text={toolCallNote} />
        </>
      ),
      relatedLinks: getCrossLinks('tools', 'errors', 'top'),
    });
  }

  if (recentList.length > 0 && recentAnswer) {
    questions.push({
      id: 'recent',
      question: "What's broken right now?",
      answer: recentAnswer,
      children: (
        <div className={styles.timeline}>
          {recentList.map((e, i) => {
            const meta = getToolMeta(e.tool);
            return (
              <div
                key={`${e.tool}-${i}-${e.error_preview.slice(0, 16)}`}
                className={styles.timelineRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span className={styles.timelineChip}>
                  {e.last_at ? formatRelativeTime(e.last_at) : '—'}
                </span>
                <span className={styles.timelineToolPill}>
                  <span className={styles.timelineToolDot} style={{ background: meta.color }} />
                  {meta.label}
                </span>
                <span className={styles.timelinePreview} title={e.error_preview}>
                  {e.error_preview.slice(0, 120)}
                </span>
              </div>
            );
          })}
        </div>
      ),
    });
  } else {
    questions.push({
      id: 'recent',
      question: "What's broken right now?",
      answer: <>No tool-call errors in the last 24h.</>,
      children: <span className={styles.empty}>No tool-call errors in the last 24h.</span>,
    });
  }

  if (tu.sessions_with_token_data > 0 && tokenAnswer) {
    questions.push({
      id: 'tokens',
      question: 'What is each model+tool combo costing?',
      answer: tokenAnswer,
      children: <TokenDetailBlock analytics={analytics} note={tokenNote} />,
      relatedLinks: getCrossLinks('tools', 'errors', 'tokens'),
    });
  } else {
    questions.push({
      id: 'tokens',
      question: 'What is each model+tool combo costing?',
      answer: <>Token and cost data appears as tools with token logs run sessions.</>,
      children: (
        <>
          <GhostRows count={3} />
          <CoverageNote text={tokenNote} />
        </>
      ),
      relatedLinks: getCrossLinks('tools', 'errors', 'tokens'),
    });
  }

  return (
    <div className={styles.panel}>
      <FocusedDetailView
        questions={questions}
        activeId={activeId}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </div>
  );
}

// ── Token detail block ──────────────────────────────
// Lifted from TokenDetailWidget body. By-model rows on top, by-tool
// rows below with section header, then PricingAttribution footer.
// The widget itself stays as-is for the catalog; this is the detail
// view's deep-dive surface.

function TokenDetailBlock({ analytics, note }: { analytics: UserAnalytics; note: string | null }) {
  const tu = analytics.token_usage;
  const refreshed = formatRelativeTime(tu.pricing_refreshed_at);

  return (
    <div className={styles.tokenList}>
      {tu.by_model.map((m, i) => (
        <div
          key={m.agent_model}
          className={styles.tokenRow}
          style={{ '--row-index': i } as CSSProperties}
        >
          <span className={styles.tokenName}>{m.agent_model}</span>
          <div className={styles.tokenMeta}>
            <span className={styles.tokenStat}>
              <span className={styles.tokenStatValue}>{(m.input_tokens / 1000).toFixed(0)}k</span>{' '}
              in
            </span>
            <span className={styles.tokenStat}>
              <span className={styles.tokenStatValue}>{(m.output_tokens / 1000).toFixed(0)}k</span>{' '}
              out
            </span>
            <span className={styles.tokenStat}>
              <span className={styles.tokenStatValue}>{fmtCount(m.sessions)}</span> sessions
            </span>
            <span className={styles.tokenStat}>
              <span className={styles.tokenStatValue}>
                {m.estimated_cost_usd != null && m.estimated_cost_usd > 0
                  ? `$${m.estimated_cost_usd.toFixed(2)}`
                  : '—'}
              </span>
            </span>
          </div>
        </div>
      ))}
      {tu.by_tool.length > 1 && (
        <>
          <div className={styles.tokenSectionHead}>By tool</div>
          {tu.by_tool.map((t, i) => (
            <div
              key={t.host_tool}
              className={styles.tokenRow}
              style={{ '--row-index': tu.by_model.length + 1 + i } as CSSProperties}
            >
              <span className={styles.tokenName}>{getToolMeta(t.host_tool).label}</span>
              <div className={styles.tokenMeta}>
                <span className={styles.tokenStat}>
                  <span className={styles.tokenStatValue}>
                    {(t.input_tokens / 1000).toFixed(0)}k
                  </span>{' '}
                  in
                </span>
                <span className={styles.tokenStat}>
                  <span className={styles.tokenStatValue}>
                    {(t.output_tokens / 1000).toFixed(0)}k
                  </span>{' '}
                  out
                </span>
                <span className={styles.tokenStat}>
                  <span className={styles.tokenStatValue}>{fmtCount(t.sessions)}</span> sessions
                </span>
              </div>
            </div>
          ))}
        </>
      )}
      {refreshed ? (
        <div className={styles.tokenFooter}>
          Pricing from{' '}
          <a href="https://github.com/BerriAI/litellm" target="_blank" rel="noopener noreferrer">
            LiteLLM
          </a>
          , refreshed {refreshed}
          {tu.pricing_is_stale && ' — cost estimates disabled until next refresh'}.
        </div>
      ) : (
        <div className={styles.tokenFooter}>Pricing data unavailable.</div>
      )}
      <CoverageNote text={note} />
    </div>
  );
}
