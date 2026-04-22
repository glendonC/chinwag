import { useMemo, type CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { Sparkline } from '../charts.js';
import {
  TOOL_ERROR_RATE_WARN_THRESHOLD,
  TOOLS_TOP_N_CAP,
  aggregateModels,
  classifyToolCall,
  formatDuration,
  getToolDepth,
  workTypeColor,
} from '../utils.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { navigateToTool } from '../../lib/router.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import type { TokenUsageStats, UserAnalytics } from '../../lib/apiSchemas.js';
import shared from '../widget-shared.module.css';
import styles from './ToolWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import {
  GhostBars,
  GhostRows,
  GhostStatRow,
  StatWidget,
  CoverageNote,
  MoreHidden,
  capabilityCoverageNote,
} from './shared.js';

function ToolDepthBars({ toolId }: { toolId: string }) {
  const { level, label } = getToolDepth(toolId);
  return (
    <span className={styles.toolDepthBars} title={label}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={styles.depthBar}
          style={{ height: `${i * 4}px`, opacity: i <= level ? 0.8 : 0.15 }}
        />
      ))}
    </span>
  );
}

function ToolsWidget({ analytics }: WidgetBodyProps) {
  const tools = analytics.tool_comparison;
  if (tools.length === 0) {
    return <SectionEmpty>Connect a tool to see comparison</SectionEmpty>;
  }
  return (
    <div className={styles.factualGrid}>
      {tools.map((t, i) => {
        const meta = getToolMeta(t.host_tool);
        return (
          <button
            key={t.host_tool}
            type="button"
            className={styles.factualItem}
            style={{ '--row-index': i } as CSSProperties}
            onClick={() => navigateToTool(t.host_tool)}
            aria-label={`View ${meta.label} details`}
          >
            {meta.icon ? (
              <span className={styles.toolIcon}>
                <img src={meta.icon} alt="" />
              </span>
            ) : (
              <span
                className={styles.toolIconLetter}
                style={{ '--tool-brand': meta.color } as CSSProperties}
              >
                {meta.label[0]}
              </span>
            )}
            <div className={styles.factualBody}>
              <span className={styles.factualLabel}>{meta.label}</span>
              <div className={styles.factualMeta}>
                <span className={styles.factualMetaValue}>{t.sessions}</span> sessions ·{' '}
                <span className={styles.factualMetaValue}>{t.total_edits.toLocaleString()}</span>{' '}
                edits
                {t.completion_rate > 0 && (
                  <>
                    {' '}
                    · <span className={styles.factualMetaValue}>{t.completion_rate}%</span>
                  </>
                )}
              </div>
            </div>
            <ToolDepthBars toolId={t.host_tool} />
          </button>
        );
      })}
    </div>
  );
}

function ModelsWidget({ analytics }: WidgetBodyProps) {
  return <ModelsList modelOutcomes={analytics.model_outcomes} />;
}

function ModelsList({ modelOutcomes }: { modelOutcomes: UserAnalytics['model_outcomes'] }) {
  const models = useMemo(() => aggregateModels(modelOutcomes), [modelOutcomes]);
  if (models.length === 0) return <GhostRows count={2} />;
  return (
    <div className={shared.dataList}>
      {models.map((m, i) => (
        <div
          key={m.model}
          className={styles.modelRow}
          style={{ '--row-index': i } as CSSProperties}
        >
          <div className={styles.modelHead}>
            <span className={shared.dataName}>{m.model}</span>
            <div className={shared.dataMeta}>
              <span className={shared.dataStat}>
                <span className={shared.dataStatValue}>{m.total}</span> sessions
              </span>
              <span className={shared.dataStat}>
                <span className={shared.dataStatValue}>{m.edits.toLocaleString()}</span> edits
              </span>
              {m.avgMin > 0 && (
                <span className={shared.dataStat}>
                  <span className={shared.dataStatValue}>{m.avgMin.toFixed(1)}m</span> avg
                </span>
              )}
              {m.rate > 0 && (
                <span className={shared.dataStat}>
                  <span className={shared.dataStatValue}>{m.rate}%</span>
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

function ToolHandoffsWidget({ analytics }: WidgetBodyProps) {
  const th = analytics.tool_handoffs;
  if (th.length === 0) {
    const toolCount = analytics.tool_comparison.length;
    // One tool connected: the empty state earns its keep by nudging the
    // user toward the coordination substrate chinwag actually provides.
    // Two-plus tools connected with zero handoffs is a truthful negative.
    const message =
      toolCount <= 1
        ? 'Add a second tool with `chinwag add <tool>` to see how agents hand off files.'
        : 'No cross-tool handoffs yet — agents are staying within one tool.';
    return <SectionEmpty>{message}</SectionEmpty>;
  }
  return (
    <div className={shared.dataList}>
      {th.slice(0, 10).map((h, i) => (
        <div
          key={`${h.from_tool}-${h.to_tool}`}
          className={shared.dataRow}
          style={{ '--row-index': i } as CSSProperties}
        >
          <span className={shared.dataName}>
            {getToolMeta(h.from_tool).label} → {getToolMeta(h.to_tool).label}
          </span>
          <div className={shared.dataMeta}>
            <span className={shared.dataStat}>
              <span className={shared.dataStatValue}>{h.file_count}</span> files
            </span>
            <span className={shared.dataStat}>
              <span className={shared.dataStatValue}>{h.handoff_completion_rate}%</span> completed
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolOutcomesWidget({ analytics }: WidgetBodyProps) {
  const to = analytics.tool_outcomes;
  if (to.length === 0) return <GhostBars count={3} />;
  const byTool = new Map<string, { completed: number; abandoned: number; failed: number }>();
  for (const t of to) {
    const entry = byTool.get(t.host_tool) || { completed: 0, abandoned: 0, failed: 0 };
    if (t.outcome === 'completed') entry.completed = t.count;
    else if (t.outcome === 'abandoned') entry.abandoned = t.count;
    else if (t.outcome === 'failed') entry.failed = t.count;
    byTool.set(t.host_tool, entry);
  }
  const ranked = [...byTool.entries()]
    .map(([tool, counts]) => ({
      tool,
      ...counts,
      total: counts.completed + counts.abandoned + counts.failed,
    }))
    .sort((a, b) => b.total - a.total);
  // C1: a single tool's outcome breakdown is a stat pretending to be a
  // chart — the widget's question is "how do my tools compare," which
  // needs ≥2 tools to answer. Below two, return a truthful empty state
  // instead of rendering a lone bar.
  if (ranked.length < 2) {
    return (
      <SectionEmpty>Comparison appears once 2+ tools have sessions in this period</SectionEmpty>
    );
  }
  // D3b: cap at TOOLS_TOP_N_CAP so a team on 10+ tools doesn't saturate
  // the widget with a vertical wall of 3-segment bars. The +N more
  // disclosure keeps the truncation honest.
  const tools = ranked.slice(0, TOOLS_TOP_N_CAP);
  const hiddenCount = ranked.length - tools.length;
  const maxT = Math.max(...tools.map((t) => t.total), 1);
  return (
    <>
      <div className={shared.metricBars}>
        {tools.map((t, i) => (
          <div
            key={t.tool}
            className={shared.metricRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={shared.metricLabel}>{getToolMeta(t.tool).label}</span>
            <div className={shared.metricBarTrack}>
              <div
                className={shared.metricBarFill}
                style={{
                  width: `${(t.completed / maxT) * 100}%`,
                  background: 'var(--success)',
                  opacity: 'var(--opacity-bar-fill)',
                }}
              />
              <div
                className={shared.metricBarFill}
                style={{
                  width: `${(t.abandoned / maxT) * 100}%`,
                  background: 'var(--warn)',
                  opacity: 'var(--opacity-bar-fill)',
                }}
              />
              <div
                className={shared.metricBarFill}
                style={{
                  width: `${(t.failed / maxT) * 100}%`,
                  background: 'var(--danger)',
                  opacity: 'var(--opacity-bar-fill)',
                }}
              />
            </div>
            <span className={shared.metricValue}>
              {t.completed}/{t.abandoned}/{t.failed}
            </span>
          </div>
        ))}
      </div>
      <MoreHidden count={hiddenCount} />
    </>
  );
}

function ToolCallsWidget({ analytics }: WidgetBodyProps) {
  const tc = analytics.tool_call_stats;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'toolCallLogs');
  if (tc.total_calls === 0) {
    return (
      <>
        <GhostStatRow labels={['calls', 'error rate', 'research:edit']} />
        <CoverageNote text={note} />
      </>
    );
  }
  return (
    <>
      <div className={shared.statRow}>
        <div className={shared.statBlock}>
          <span className={shared.statBlockValue}>{tc.total_calls.toLocaleString()}</span>
          <span className={shared.statBlockLabel}>calls</span>
        </div>
        <div className={shared.statBlock}>
          <span className={shared.statBlockValue}>{tc.error_rate}%</span>
          <span className={shared.statBlockLabel}>error rate</span>
        </div>
        <div className={shared.statBlock}>
          <span className={shared.statBlockValue}>{tc.research_to_edit_ratio}:1</span>
          <span className={shared.statBlockLabel}>research:edit</span>
        </div>
        <div className={shared.statBlock}>
          <span className={shared.statBlockValue}>{tc.calls_per_session}</span>
          <span className={shared.statBlockLabel}>calls/session</span>
        </div>
      </div>
      <CoverageNote text={note} />
    </>
  );
}

function ToolCallFreqWidget({ analytics }: WidgetBodyProps) {
  const freq = analytics.tool_call_stats.frequency;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'toolCallLogs');
  if (freq.length === 0) {
    return (
      <>
        <GhostBars count={5} />
        <CoverageNote text={note} />
      </>
    );
  }
  // Lane split: built-in primitives dominate top-N if left undivided, hiding
  // the MCP/custom tail that's actually the substrate-unique signal. Each
  // lane normalizes its own maxC so bars read against the lane's peak, not
  // an Edit-count that dwarfs every MCP tool.
  const builtinAll = freq.filter((f) => classifyToolCall(f.tool) === 'builtin');
  const customAll = freq.filter((f) => classifyToolCall(f.tool) === 'custom');
  const builtin = builtinAll.slice(0, TOOLS_TOP_N_CAP);
  const custom = customAll.slice(0, TOOLS_TOP_N_CAP);
  const builtinHidden = builtinAll.length - builtin.length;
  const customHidden = customAll.length - custom.length;

  const renderRow = (f: (typeof freq)[number], i: number, maxC: number) => (
    <div key={f.tool} className={shared.metricRow} style={{ '--row-index': i } as CSSProperties}>
      <span className={shared.metricLabel}>{f.tool}</span>
      <div className={shared.metricBarTrack}>
        <div
          className={shared.metricBarFill}
          style={{
            width: `${(f.calls / maxC) * 100}%`,
            background: f.error_rate > TOOL_ERROR_RATE_WARN_THRESHOLD ? 'var(--warn)' : undefined,
          }}
        />
      </div>
      <span className={shared.metricValue}>
        {f.calls}
        {f.errors > 0 ? ` · ${f.error_rate}% err` : ''}
        {f.avg_duration_ms > 0 ? ` · ${formatDuration(f.avg_duration_ms)}` : ''}
      </span>
    </div>
  );

  const builtinMax = Math.max(...builtin.map((f) => f.calls), 1);
  const customMax = Math.max(...custom.map((f) => f.calls), 1);

  return (
    <>
      {builtin.length > 0 && (
        <>
          <span className={styles.sectionSublabel}>Built-in</span>
          <div className={shared.metricBars}>
            {builtin.map((f, i) => renderRow(f, i, builtinMax))}
            {builtinHidden > 0 && <MoreHidden count={builtinHidden} />}
          </div>
        </>
      )}
      {custom.length > 0 && (
        <>
          <span className={styles.sectionSublabel} style={{ marginTop: 16 }}>
            MCP &amp; custom
          </span>
          <div className={shared.metricBars}>
            {custom.map((f, i) => renderRow(f, i, customMax))}
            {customHidden > 0 && <MoreHidden count={customHidden} />}
          </div>
        </>
      )}
      <CoverageNote text={note} />
    </>
  );
}

function ToolCallErrorsWidget({ analytics }: WidgetBodyProps) {
  const errs = analytics.tool_call_stats.error_patterns;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'toolCallLogs');
  if (errs.length === 0) {
    return (
      <>
        <SectionEmpty>No tool errors</SectionEmpty>
        <CoverageNote text={note} />
      </>
    );
  }
  // Two-pane split: top-5 by frequency and top-5 by recency. A frequency-only
  // sort buries rare-but-recent errors; a recency-only sort misses systemic
  // issues. Showing both keeps the rare-and-the-common both legible. De-dupe
  // across panes so the same row doesn't appear twice.
  const PANE_CAP = 5;
  const byCount = [...errs].sort((a, b) => b.count - a.count).slice(0, PANE_CAP);
  const byCountKeys = new Set(byCount.map((e) => `${e.tool}|${e.error_preview}`));
  const byRecent = [...errs]
    .filter((e) => e.last_at != null)
    .sort((a, b) => (a.last_at! < b.last_at! ? 1 : -1))
    .filter((e) => !byCountKeys.has(`${e.tool}|${e.error_preview}`))
    .slice(0, PANE_CAP);

  const renderRow = (e: (typeof errs)[number], i: number, showRecency: boolean) => (
    <div
      key={`${e.tool}-${e.error_preview}-${i}`}
      className={shared.dataRow}
      style={{ '--row-index': i } as CSSProperties}
    >
      <span className={shared.dataName}>{e.tool}</span>
      <div className={shared.dataMeta}>
        <span className={shared.dataStat} style={{ color: 'var(--danger)' }}>
          <span className={shared.dataStatValue}>{e.count}x</span>
        </span>
        {showRecency && e.last_at && (
          <span className={shared.dataStat}>{formatRelativeTime(e.last_at)}</span>
        )}
        <span className={shared.dataStat} style={{ opacity: 0.7, fontSize: 'var(--text-2xs)' }}>
          {e.error_preview.slice(0, 80)}
        </span>
      </div>
    </div>
  );

  return (
    <>
      <span className={styles.sectionSublabel}>Most frequent</span>
      <div className={shared.dataList}>{byCount.map((e, i) => renderRow(e, i, true))}</div>
      {byRecent.length > 0 && (
        <>
          <span className={styles.sectionSublabel} style={{ marginTop: 16 }}>
            Most recent
          </span>
          <div className={shared.dataList}>{byRecent.map((e, i) => renderRow(e, i, true))}</div>
        </>
      )}
      <CoverageNote text={note} />
    </>
  );
}

function PricingAttribution({ usage }: { usage: TokenUsageStats }) {
  const refreshed = formatRelativeTime(usage.pricing_refreshed_at);
  if (!refreshed) {
    return <div className={shared.coverageNote}>Pricing data unavailable.</div>;
  }
  return (
    <div className={shared.coverageNote}>
      Pricing from{' '}
      <a href="https://github.com/BerriAI/litellm" target="_blank" rel="noopener noreferrer">
        LiteLLM
      </a>
      , refreshed {refreshed}
      {usage.pricing_is_stale && ' — cost estimates disabled until next refresh'}.
    </div>
  );
}

function TokenDetailWidget({ analytics }: WidgetBodyProps) {
  const tu = analytics.token_usage;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'tokenUsage');
  if (tu.sessions_with_token_data === 0) {
    return (
      <>
        <GhostRows count={3} />
        <CoverageNote text={note} />
      </>
    );
  }
  return (
    <div className={shared.dataList}>
      {tu.by_model.map((m, i) => (
        <div
          key={m.agent_model}
          className={shared.dataRow}
          style={{ '--row-index': i } as CSSProperties}
        >
          <span className={shared.dataName}>{m.agent_model}</span>
          <div className={shared.dataMeta}>
            <span className={shared.dataStat}>
              <span className={shared.dataStatValue}>{(m.input_tokens / 1000).toFixed(0)}k</span> in
            </span>
            <span className={shared.dataStat}>
              <span className={shared.dataStatValue}>{(m.output_tokens / 1000).toFixed(0)}k</span>{' '}
              out
            </span>
            <span className={shared.dataStat}>
              <span className={shared.dataStatValue}>{m.sessions}</span> sessions
            </span>
            <span className={shared.dataStat}>
              <span className={shared.dataStatValue}>
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
          <span className={styles.sectionSublabel}>By tool</span>
          {tu.by_tool.map((t, i) => (
            <div
              key={t.host_tool}
              className={shared.dataRow}
              style={{ '--row-index': tu.by_model.length + 1 + i } as CSSProperties}
            >
              <span className={shared.dataName}>{getToolMeta(t.host_tool).label}</span>
              <div className={shared.dataMeta}>
                <span className={shared.dataStat}>
                  <span className={shared.dataStatValue}>
                    {(t.input_tokens / 1000).toFixed(0)}k
                  </span>{' '}
                  in
                </span>
                <span className={shared.dataStat}>
                  <span className={shared.dataStatValue}>
                    {(t.output_tokens / 1000).toFixed(0)}k
                  </span>{' '}
                  out
                </span>
                <span className={shared.dataStat}>
                  <span className={shared.dataStatValue}>{t.sessions}</span> sessions
                </span>
              </div>
            </div>
          ))}
        </>
      )}
      <PricingAttribution usage={tu} />
    </div>
  );
}

function ToolDailyWidget({ analytics }: WidgetBodyProps) {
  const td = analytics.tool_daily;
  if (td.length === 0) return <GhostBars count={3} />;
  const byTool = new Map<string, { sessions: number; series: Map<string, number> }>();
  for (const d of td) {
    const e = byTool.get(d.host_tool) ?? { sessions: 0, series: new Map<string, number>() };
    e.sessions += d.sessions;
    e.series.set(d.day, (e.series.get(d.day) ?? 0) + d.sessions);
    byTool.set(d.host_tool, e);
  }
  const tools = [...byTool.entries()]
    .map(([tool, v]) => ({
      tool,
      sessions: v.sessions,
      data: [...v.series.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, n]) => n),
    }))
    .filter((t) => t.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);
  if (tools.length === 0) return <GhostBars count={3} />;
  // Small-multiples grid: every tool gets a thumbnail sparkline. No top-N
  // truncation — the grid auto-fills, so 10+ tools tile naturally rather
  // than being silently hidden.
  return (
    <div className={styles.sparkGrid}>
      {tools.map((t, i) => {
        const meta = getToolMeta(t.tool);
        return (
          <div
            key={t.tool}
            className={styles.sparkCell}
            style={
              {
                '--row-index': i,
                '--tool-brand': meta.color,
              } as CSSProperties
            }
          >
            <div className={styles.sparkHead}>
              <span className={styles.sparkLabel} title={meta.label}>
                {meta.label}
              </span>
              <span className={styles.sparkCount}>{t.sessions}</span>
            </div>
            <div className={styles.sparkBody}>
              {t.data.length >= 2 ? (
                <Sparkline data={t.data} height={28} color={meta.color} />
              ) : (
                <span className={styles.sparkEmpty}>—</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ToolWorkTypeWidget({ analytics }: WidgetBodyProps) {
  const twt = analytics.tool_work_type;
  if (twt.length === 0) return <GhostBars count={3} />;
  const byTool = new Map<string, { sessions: number; types: Map<string, number> }>();
  for (const t of twt) {
    const e = byTool.get(t.host_tool) ?? { sessions: 0, types: new Map<string, number>() };
    e.sessions += t.sessions;
    e.types.set(t.work_type, (e.types.get(t.work_type) ?? 0) + t.sessions);
    byTool.set(t.host_tool, e);
  }
  const ranked = [...byTool.entries()]
    .map(([tool, v]) => ({
      tool,
      sessions: v.sessions,
      types: [...v.types.entries()].map(([work_type, sessions]) => ({ work_type, sessions })),
    }))
    .filter((t) => t.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);
  const tools = ranked.slice(0, TOOLS_TOP_N_CAP);
  const hiddenCount = ranked.length - tools.length;
  if (tools.length === 0) return <GhostBars count={3} />;
  const allTypes = new Map<string, number>();
  for (const t of tools) {
    for (const w of t.types) {
      allTypes.set(w.work_type, (allTypes.get(w.work_type) ?? 0) + w.sessions);
    }
  }
  const orderedTypes = [...allTypes.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  return (
    <div>
      <div className={shared.metricBars} style={{ marginBottom: 12 }}>
        {tools.map((t, i) => {
          const meta = getToolMeta(t.tool);
          return (
            <div
              key={t.tool}
              className={shared.metricRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={shared.metricLabel} title={meta.label}>
                {meta.label}
              </span>
              <div className={shared.workBar} style={{ flex: 1, marginBottom: 0 }}>
                {orderedTypes.map((wt) => {
                  const w = t.types.find((x) => x.work_type === wt);
                  const pct = w ? (w.sessions / t.sessions) * 100 : 0;
                  if (pct < 0.5) return null;
                  return (
                    <div
                      key={wt}
                      className={shared.workSegment}
                      style={{
                        width: `${pct}%`,
                        background: workTypeColor(wt),
                      }}
                      title={`${wt}: ${Math.round(pct)}%`}
                    />
                  );
                })}
              </div>
              <span className={shared.metricValue}>{t.sessions}</span>
            </div>
          );
        })}
        {hiddenCount > 0 && <MoreHidden count={hiddenCount} />}
      </div>
      <div className={shared.workLegend}>
        {orderedTypes.slice(0, 6).map((wt) => (
          <div key={wt} className={shared.workLegendItem}>
            <span className={shared.workDot} style={{ background: workTypeColor(wt) }} />
            <span className={shared.workLegendLabel}>{wt}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CacheEfficiencyWidget({ analytics }: WidgetBodyProps) {
  const chr = analytics.token_usage.cache_hit_rate;
  const tools = analytics.data_coverage?.tools_reporting ?? [];
  const note = capabilityCoverageNote(tools, 'tokenUsage');
  const value = chr == null ? '--' : `${Math.round(chr * 100)}%`;
  return (
    <>
      <StatWidget value={value} />
      <CoverageNote text={note} />
    </>
  );
}

export const toolWidgets: WidgetRegistry = {
  tools: ToolsWidget,
  models: ModelsWidget,
  'tool-handoffs': ToolHandoffsWidget,
  'tool-outcomes': ToolOutcomesWidget,
  'tool-calls': ToolCallsWidget,
  'tool-call-freq': ToolCallFreqWidget,
  'tool-call-errors': ToolCallErrorsWidget,
  'token-detail': TokenDetailWidget,
  'tool-daily': ToolDailyWidget,
  'tool-work-type': ToolWorkTypeWidget,
  'cache-efficiency': CacheEfficiencyWidget,
};
