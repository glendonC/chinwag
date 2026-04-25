import { useMemo, type CSSProperties } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { aggregateModels, completionColor } from '../utils.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import { getDataCapabilities, type DataCapabilities } from '@chinmeister/shared/tool-registry.js';
import type { TokenUsageStats, UserAnalytics } from '../../lib/apiSchemas.js';
import shared from '../widget-shared.module.css';
import styles from './ToolWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { GhostRows, CoverageNote, capabilityCoverageNote } from './shared.js';

// Capability pills — the substrate-unique "what can each tool answer" affordance
// rendered inline on each tool card. Order is fixed so the eye learns column
// positions across rows; bright = present, dim = absent. No tooltip required —
// the label is the affordance.
type CapabilityPillKey = 'hooks' | 'tokens' | 'tool-calls' | 'commits' | 'conversations';
const CAPABILITY_PILLS: ReadonlyArray<{ key: CapabilityPillKey; cap: keyof DataCapabilities }> = [
  { key: 'hooks', cap: 'hooks' },
  { key: 'tokens', cap: 'tokenUsage' },
  { key: 'tool-calls', cap: 'toolCallLogs' },
  { key: 'commits', cap: 'commitTracking' },
  { key: 'conversations', cap: 'conversationLogs' },
];

function ToolCapabilityPills({ toolId }: { toolId: string }) {
  const caps = getDataCapabilities(toolId);
  return (
    <div className={styles.capabilityPills} aria-label="Data capabilities">
      {CAPABILITY_PILLS.map(({ key, cap }) => {
        const present = caps[cap] === true;
        return (
          <span
            key={key}
            className={`${styles.capabilityPill} ${
              present ? styles.capabilityPillOn : styles.capabilityPillOff
            }`}
            aria-label={`${key}: ${present ? 'available' : 'not available'}`}
          >
            {key}
          </span>
        );
      })}
    </div>
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
          <div
            key={t.host_tool}
            className={styles.factualItem}
            style={{ '--row-index': i } as CSSProperties}
          >
            <div className={styles.factualHead}>
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
            </div>
            <ToolCapabilityPills toolId={t.host_tool} />
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

function ToolHandoffIcon({ toolId }: { toolId: string }) {
  const meta = getToolMeta(toolId);
  if (meta.icon) {
    return (
      <span className={styles.handoffIcon} aria-hidden="true">
        <img src={meta.icon} alt="" />
      </span>
    );
  }
  return (
    <span
      className={styles.handoffIconLetter}
      style={{ '--tool-brand': meta.color } as CSSProperties}
      aria-hidden="true"
    >
      {meta.label[0]}
    </span>
  );
}

function ToolHandoffsWidget({ analytics }: WidgetBodyProps) {
  const th = analytics.tool_handoffs;
  if (th.length === 0) {
    const toolCount = analytics.tool_comparison.length;
    // One tool connected: the empty state earns its keep by nudging the
    // user toward the coordination substrate chinmeister actually provides.
    // Two-plus tools connected with zero handoffs is a truthful negative.
    const message =
      toolCount <= 1
        ? 'Add a second tool with `chinmeister add <tool>` to see how agents hand off files.'
        : 'No cross-tool handoffs yet — agents are staying within one tool.';
    return <SectionEmpty>{message}</SectionEmpty>;
  }
  // Substrate-unique signal: render each pair as a flow strip with the
  // connector line thickness scaled to file count and color tinted by
  // completion. This is the visual that makes "agents hand files between
  // tools" legible at a glance — the list shape buried it.
  const rows = th.slice(0, 10);
  const maxFiles = rows.reduce((m, r) => Math.max(m, r.file_count), 1);
  return (
    <div className={styles.handoffList}>
      {rows.map((h, i) => {
        const fromMeta = getToolMeta(h.from_tool);
        const toMeta = getToolMeta(h.to_tool);
        // Map file count to a 1-4px stroke. Even the rarest pair stays
        // visible at 1px so the row reads as a track, not as missing chrome.
        const share = Math.max(0, Math.min(1, h.file_count / Math.max(1, maxFiles)));
        const strokePx = 1 + Math.round(share * 3);
        const lineColor = completionColor(h.handoff_completion_rate);
        return (
          <div
            key={`${h.from_tool}-${h.to_tool}`}
            className={styles.handoffRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <ToolHandoffIcon toolId={h.from_tool} />
            <span className={styles.handoffEndpoint}>{fromMeta.label}</span>
            <span
              className={styles.handoffConnector}
              style={
                {
                  '--handoff-stroke': `${strokePx}px`,
                  '--handoff-color': lineColor,
                } as CSSProperties
              }
              aria-hidden="true"
            >
              <span className={styles.handoffTrack} />
              <span className={styles.handoffCount}>{h.file_count}</span>
              <span className={styles.handoffArrow}>→</span>
            </span>
            <span className={styles.handoffEndpoint}>{toMeta.label}</span>
            <ToolHandoffIcon toolId={h.to_tool} />
            <span className={styles.handoffRate} style={{ color: lineColor }}>
              {h.handoff_completion_rate}%
            </span>
          </div>
        );
      })}
    </div>
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

  const renderRow = (e: (typeof errs)[number], i: number, showRecency: boolean) => {
    const brand = getToolMeta(e.tool).color;
    return (
      <div
        key={`${e.tool}-${e.error_preview}-${i}`}
        className={`${shared.dataRow} ${styles.errorRow}`}
        style={
          {
            '--row-index': i,
            '--tool-brand': brand,
          } as CSSProperties
        }
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
  };

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

export const toolWidgets: WidgetRegistry = {
  tools: ToolsWidget,
  models: ModelsWidget,
  'tool-handoffs': ToolHandoffsWidget,
  'tool-call-errors': ToolCallErrorsWidget,
  'token-detail': TokenDetailWidget,
};
