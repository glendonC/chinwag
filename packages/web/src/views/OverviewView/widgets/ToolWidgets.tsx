import { useMemo, type CSSProperties } from 'react';
import SectionEmpty from '../../../components/SectionEmpty/SectionEmpty.js';
import { Sparkline } from '../overview-charts.js';
import { WORK_TYPE_COLORS, aggregateModels, formatDuration } from '../overview-utils.js';
import { getToolMeta } from '../../../lib/toolMeta.js';
import { formatRelativeTime } from '../../../lib/relativeTime.js';
import type { TokenUsageStats, UserAnalytics } from '../../../lib/apiSchemas.js';
import styles from '../OverviewView.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { GhostBars, GhostRows, GhostStatRow } from './shared.js';

function ToolsWidget({ analytics }: WidgetBodyProps) {
  const tools = analytics.tool_comparison;
  if (tools.length === 0) {
    return (
      <div className={styles.factualGrid} style={{ opacity: 0.3 }}>
        {[1, 2].map((i) => (
          <div key={i} className={styles.factualItem}>
            <span className={styles.toolIconLetter} style={{ background: 'var(--ghost)' }}>
              ?
            </span>
            <div>
              <span className={styles.factualLabel} style={{ color: 'var(--muted)' }}>
                —
              </span>
              <div className={styles.factualMeta}>— sessions · — edits</div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.factualGrid}>
      {tools.map((t) => {
        const meta = getToolMeta(t.host_tool);
        return (
          <div key={t.host_tool} className={styles.factualItem}>
            {meta.icon ? (
              <span className={styles.toolIcon}>
                <img src={meta.icon} alt="" />
              </span>
            ) : (
              <span className={styles.toolIconLetter} style={{ background: meta.color }}>
                {meta.label[0]}
              </span>
            )}
            <div>
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
          </div>
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
  if (models.length === 0) {
    return (
      <div className={styles.dataList}>
        {[1, 2].map((i) => (
          <div key={i} className={styles.ghostRow}>
            <span className={styles.ghostLabel} style={{ width: 'auto' }}>
              —
            </span>
            <span className={styles.ghostValue}>— sessions</span>
            <span className={styles.ghostValue}>— edits</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.dataList}>
      {models.map((m, i) => (
        <div key={m.model} className={styles.dataRow} style={{ '--row-index': i } as CSSProperties}>
          <span className={styles.dataName}>{m.model}</span>
          <div className={styles.dataMeta}>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{m.total}</span> sessions
            </span>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{m.edits.toLocaleString()}</span> edits
            </span>
            {(m.linesAdded > 0 || m.linesRemoved > 0) && (
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>
                  +{m.linesAdded.toLocaleString()}/-{m.linesRemoved.toLocaleString()}
                </span>
              </span>
            )}
            {m.avgMin > 0 && (
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{m.avgMin.toFixed(1)}m</span> avg
              </span>
            )}
            {m.rate > 0 && (
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{m.rate}%</span>
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolHandoffsWidget({ analytics }: WidgetBodyProps) {
  const th = analytics.tool_handoffs;
  if (th.length === 0) return <SectionEmpty>No cross-tool handoffs</SectionEmpty>;
  return (
    <div className={styles.dataList}>
      {th.slice(0, 10).map((h, i) => (
        <div
          key={`${h.from_tool}-${h.to_tool}`}
          className={styles.dataRow}
          style={{ '--row-index': i } as CSSProperties}
        >
          <span className={styles.dataName}>
            {getToolMeta(h.from_tool).label} → {getToolMeta(h.to_tool).label}
          </span>
          <div className={styles.dataMeta}>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{h.file_count}</span> files
            </span>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{h.handoff_completion_rate}%</span> completed
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolCallsWidget({ analytics }: WidgetBodyProps) {
  const tc = analytics.tool_call_stats;
  if (tc.total_calls === 0)
    return <GhostStatRow labels={['calls', 'error rate', 'research:edit']} />;
  return (
    <div className={styles.statRow}>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{tc.total_calls.toLocaleString()}</span>
        <span className={styles.statBlockLabel}>calls</span>
      </div>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{tc.error_rate}%</span>
        <span className={styles.statBlockLabel}>error rate</span>
      </div>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{tc.research_to_edit_ratio}:1</span>
        <span className={styles.statBlockLabel}>research:edit</span>
      </div>
      <div className={styles.statBlock}>
        <span className={styles.statBlockValue}>{tc.calls_per_session}</span>
        <span className={styles.statBlockLabel}>calls/session</span>
      </div>
    </div>
  );
}

function ToolCallFreqWidget({ analytics }: WidgetBodyProps) {
  const freq = analytics.tool_call_stats.frequency;
  if (freq.length === 0) return <GhostBars count={5} />;
  const maxC = Math.max(...freq.map((f) => f.calls), 1);
  return (
    <div className={styles.metricBars}>
      {freq.slice(0, 15).map((f) => (
        <div key={f.tool} className={styles.metricRow}>
          <span className={styles.metricLabel}>{f.tool}</span>
          <div className={styles.metricBarTrack}>
            <div
              className={styles.metricBarFill}
              style={{
                width: `${(f.calls / maxC) * 100}%`,
                background: f.error_rate > 10 ? 'var(--warn)' : undefined,
              }}
            />
          </div>
          <span className={styles.metricValue}>
            {f.calls}
            {f.errors > 0 ? ` · ${f.error_rate}% err` : ''}
            {f.avg_duration_ms > 0 ? ` · ${formatDuration(f.avg_duration_ms)}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function ToolCallErrorsWidget({ analytics }: WidgetBodyProps) {
  const errs = analytics.tool_call_stats.error_patterns;
  if (errs.length === 0) return <SectionEmpty>No tool errors</SectionEmpty>;
  return (
    <div className={styles.dataList}>
      {errs.slice(0, 10).map((e, i) => (
        <div
          key={`${e.tool}-${i}`}
          className={styles.dataRow}
          style={{ '--row-index': i } as CSSProperties}
        >
          <span className={styles.dataName}>{e.tool}</span>
          <div className={styles.dataMeta}>
            <span className={styles.dataStat} style={{ color: 'var(--danger)' }}>
              <span className={styles.dataStatValue}>{e.count}x</span>
            </span>
            <span className={styles.dataStat} style={{ opacity: 0.7, fontSize: 'var(--text-2xs)' }}>
              {e.error_preview.slice(0, 80)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PricingAttribution({ usage }: { usage: TokenUsageStats }) {
  const refreshed = formatRelativeTime(usage.pricing_refreshed_at);
  if (!refreshed) {
    return <div className={styles.coverageNote}>Pricing data unavailable.</div>;
  }
  return (
    <div className={styles.coverageNote}>
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
  if (tu.sessions_with_token_data === 0) return <GhostRows count={3} />;
  return (
    <div className={styles.dataList}>
      {tu.by_model.map((m, i) => (
        <div
          key={m.agent_model}
          className={styles.dataRow}
          style={{ '--row-index': i } as CSSProperties}
        >
          <span className={styles.dataName}>{m.agent_model}</span>
          <div className={styles.dataMeta}>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{(m.input_tokens / 1000).toFixed(0)}k</span> in
            </span>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{(m.output_tokens / 1000).toFixed(0)}k</span>{' '}
              out
            </span>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{m.sessions}</span> sessions
            </span>
            {m.estimated_cost_usd != null && m.estimated_cost_usd > 0 && (
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>${m.estimated_cost_usd.toFixed(2)}</span>
              </span>
            )}
          </div>
        </div>
      ))}
      {tu.by_tool.length > 1 && (
        <>
          <div
            className={styles.dataRow}
            style={
              {
                '--row-index': tu.by_model.length,
                opacity: 0.5,
                borderTop: '1px solid var(--ghost)',
              } as CSSProperties
            }
          >
            <span
              className={styles.dataName}
              style={{
                fontSize: 'var(--text-2xs)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              By tool
            </span>
            <div className={styles.dataMeta} />
          </div>
          {tu.by_tool.map((t, i) => (
            <div
              key={t.host_tool}
              className={styles.dataRow}
              style={{ '--row-index': tu.by_model.length + 1 + i } as CSSProperties}
            >
              <span className={styles.dataName}>{getToolMeta(t.host_tool).label}</span>
              <div className={styles.dataMeta}>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>
                    {(t.input_tokens / 1000).toFixed(0)}k
                  </span>{' '}
                  in
                </span>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>
                    {(t.output_tokens / 1000).toFixed(0)}k
                  </span>{' '}
                  out
                </span>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{t.sessions}</span> sessions
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
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 5);
  if (tools.length === 0) return <GhostBars count={3} />;
  return (
    <div className={styles.metricBars}>
      {tools.map((t) => {
        const meta = getToolMeta(t.tool);
        return (
          <div key={t.tool} className={styles.metricRow}>
            <span className={styles.metricLabel} title={meta.label}>
              {meta.label}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {t.data.length >= 2 ? (
                <Sparkline data={t.data} height={32} color={meta.color} />
              ) : (
                <span style={{ opacity: 0.4, fontSize: 'var(--text-2xs)' }}>—</span>
              )}
            </div>
            <span className={styles.metricValue}>{t.sessions}</span>
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
  const tools = [...byTool.entries()]
    .map(([tool, v]) => ({
      tool,
      sessions: v.sessions,
      types: [...v.types.entries()].map(([work_type, sessions]) => ({ work_type, sessions })),
    }))
    .filter((t) => t.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 5);
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
      <div className={styles.metricBars} style={{ marginBottom: 12 }}>
        {tools.map((t) => {
          const meta = getToolMeta(t.tool);
          return (
            <div key={t.tool} className={styles.metricRow}>
              <span className={styles.metricLabel} title={meta.label}>
                {meta.label}
              </span>
              <div className={styles.workBar} style={{ flex: 1, marginBottom: 0 }}>
                {orderedTypes.map((wt) => {
                  const w = t.types.find((x) => x.work_type === wt);
                  const pct = w ? (w.sessions / t.sessions) * 100 : 0;
                  if (pct < 0.5) return null;
                  return (
                    <div
                      key={wt}
                      className={styles.workSegment}
                      style={{
                        width: `${pct}%`,
                        background: WORK_TYPE_COLORS[wt] ?? WORK_TYPE_COLORS.other,
                      }}
                      title={`${wt}: ${Math.round(pct)}%`}
                    />
                  );
                })}
              </div>
              <span className={styles.metricValue}>{t.sessions}</span>
            </div>
          );
        })}
      </div>
      <div className={styles.workLegend}>
        {orderedTypes.slice(0, 6).map((wt) => (
          <div key={wt} className={styles.workLegendItem}>
            <span
              className={styles.workDot}
              style={{ background: WORK_TYPE_COLORS[wt] ?? WORK_TYPE_COLORS.other }}
            />
            <span className={styles.workLegendLabel}>{wt}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const toolWidgets: WidgetRegistry = {
  tools: ToolsWidget,
  models: ModelsWidget,
  'tool-handoffs': ToolHandoffsWidget,
  'tool-calls': ToolCallsWidget,
  'tool-call-freq': ToolCallFreqWidget,
  'tool-call-errors': ToolCallErrorsWidget,
  'token-detail': TokenDetailWidget,
  'tool-daily': ToolDailyWidget,
  'tool-work-type': ToolWorkTypeWidget,
};
