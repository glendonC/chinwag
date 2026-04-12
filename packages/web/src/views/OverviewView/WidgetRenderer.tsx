import { memo, useMemo, useState, type CSSProperties } from 'react';
import { getWidget, type WidgetDef } from './widget-catalog.js';
import {
  DAY_LABELS,
  buildHeatmapData,
  WORK_TYPE_COLORS,
  aggregateModels,
  formatDuration,
} from './overview-utils.js';
import { Sparkline } from './overview-charts.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import type { UserAnalytics, ConversationAnalytics } from '../../lib/apiSchemas.js';
import type { LiveAgent } from './useOverviewData.js';
import styles from './OverviewView.module.css';

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'var(--success)',
  neutral: 'var(--soft)',
  frustrated: 'var(--warn)',
  confused: 'var(--warn)',
  negative: 'var(--danger)',
  unclassified: 'var(--ghost)',
};

interface WidgetProps {
  widgetId: string;
  analytics: UserAnalytics;
  conversationData: ConversationAnalytics;
  summaries: Array<Record<string, unknown>>;
  liveAgents: LiveAgent[];
  selectTeam: (teamId: string) => void;
}

interface CoverageCategory {
  id: string;
  label: string;
  total: number;
  active: number;
  hint: string;
}

function computeDataCoverage(a: UserAnalytics, conv: ConversationAnalytics): CoverageCategory[] {
  const models = aggregateModels(a.model_outcomes);
  return [
    {
      id: 'sessions',
      label: 'Session basics',
      total: 6,
      active: [
        a.stuckness.total_sessions > 0,
        a.hourly_distribution.length > 0 || a.duration_distribution.some((d) => d.count > 0),
        a.work_type_distribution.length > 0 &&
          a.work_type_distribution.reduce((s, w) => s + w.sessions, 0) > 0,
        a.work_type_outcomes.length > 0,
        a.scope_complexity.length > 0,
        a.first_edit_stats.avg_minutes_to_first_edit > 0 || a.first_edit_stats.by_tool.length > 0,
      ].filter(Boolean).length,
      hint: 'Run a few coding sessions',
    },
    {
      id: 'outcomes',
      label: 'Outcome analysis',
      total: 6,
      active: [
        a.period_comparison.current.total_sessions > 0 && a.period_comparison.previous !== null,
        a.hourly_effectiveness.length > 0,
        a.outcome_predictors.length > 0,
        a.tool_outcomes.length > 0,
        a.conflict_correlation.length > 0,
        a.member_analytics.length > 0,
      ].filter(Boolean).length,
      hint: 'Complete or close some sessions',
    },
    {
      id: 'edits',
      label: 'Edit intelligence',
      total: 8,
      active: [
        a.edit_velocity.length >= 2,
        a.daily_trends.length >= 2,
        a.prompt_efficiency.length >= 2,
        a.file_heatmap.length > 0,
        a.directory_heatmap.length > 0,
        a.file_churn.length > 0,
        a.file_rework.length > 0,
        a.audit_staleness.length > 0,
      ].filter(Boolean).length,
      hint: 'Let agents make file edits',
    },
    {
      id: 'toolcalls',
      label: 'Tool call analytics',
      total: 3,
      active: [
        a.tool_call_stats.total_calls > 0,
        a.tool_call_stats.frequency.length > 0,
        a.tool_call_stats.error_patterns.length > 0,
      ].filter(Boolean).length,
      hint: 'Runs automatically with Claude Code',
    },
    {
      id: 'conversations',
      label: 'Conversation insights',
      total: 2,
      active: [
        a.conversation_edit_correlation.length > 0,
        conv.total_messages > 0 || conv.sessions_with_conversations > 0,
      ].filter(Boolean).length,
      hint: 'Use a tool with conversation capture',
    },
    {
      id: 'memory',
      label: 'Memory intelligence',
      total: 3,
      active: [
        a.memory_usage.total_memories > 0 || a.memory_usage.searches > 0,
        a.memory_outcome_correlation.length > 0,
        a.top_memories.length > 0,
      ].filter(Boolean).length,
      hint: 'Save or search shared memories',
    },
    {
      id: 'multitool',
      label: 'Multi-tool analysis',
      total: 3,
      active: [
        models.length >= 2,
        a.tool_handoffs.length > 0,
        a.concurrent_edits.length > 0,
      ].filter(Boolean).length,
      hint: 'Connect a second tool',
    },
    {
      id: 'tokens',
      label: 'Token usage',
      total: 2,
      active: [
        a.token_usage.sessions_with_token_data > 0,
        a.data_coverage !== undefined && a.data_coverage.tools_reporting.length > 0,
      ].filter(Boolean).length,
      hint: 'Use a tool that reports tokens',
    },
    {
      id: 'tools',
      label: 'Tool comparison',
      total: 2,
      active: [a.tool_comparison.length > 0, a.tool_work_type.length > 0].filter(Boolean).length,
      hint: 'Connect at least one tool',
    },
  ];
}

function WidgetRendererInner({
  widgetId,
  analytics,
  conversationData,
  summaries,
  liveAgents,
  selectTeam,
}: WidgetProps) {
  const def = getWidget(widgetId);
  if (!def) return null;

  return (
    <>
      <span className={styles.sectionLabel}>{def.name}</span>
      <WidgetBody
        def={def}
        analytics={analytics}
        conversationData={conversationData}
        summaries={summaries}
        liveAgents={liveAgents}
        selectTeam={selectTeam}
      />
    </>
  );
}

export const WidgetRenderer = memo(WidgetRendererInner);

// ── Inner body renderer by viz type ─────────────

function WidgetBody({
  def,
  analytics,
  conversationData,
  summaries,
  liveAgents,
  selectTeam,
}: {
  def: WidgetDef;
  analytics: UserAnalytics;
  conversationData: ConversationAnalytics;
  summaries: Array<Record<string, unknown>>;
  liveAgents: LiveAgent[];
  selectTeam: (teamId: string) => void;
}) {
  // Captured once per widget instance so relative-time math in render stays
  // pure. Accepted staleness: if the dashboard stays mounted across a day
  // boundary the "Xd ago" label may lag by a day until the next remount.
  const [nowMs] = useState(() => Date.now());
  switch (def.id) {
    // ── Stat widgets ──────────────────────
    case 'sessions': {
      const v = analytics.daily_trends.reduce((s, d) => s + d.sessions, 0);
      return <StatWidget value={v.toLocaleString()} />;
    }
    case 'edits': {
      const v = analytics.daily_trends.reduce((s, d) => s + d.edits, 0);
      return <StatWidget value={v.toLocaleString()} />;
    }
    case 'lines-added': {
      const v = analytics.daily_trends.reduce((s, d) => s + d.lines_added, 0);
      return <StatWidget value={`+${v.toLocaleString()}`} />;
    }
    case 'lines-removed': {
      const v = analytics.daily_trends.reduce((s, d) => s + d.lines_removed, 0);
      return <StatWidget value={`-${v.toLocaleString()}`} />;
    }
    case 'files-touched':
      return <StatWidget value={String(analytics.file_heatmap.length)} />;
    case 'cost': {
      const c = analytics.token_usage.total_estimated_cost_usd;
      return <StatWidget value={c > 0 ? `$${c.toFixed(2)}` : '$0'} />;
    }

    // ── Outcomes ──────────────────────────
    case 'outcomes':
      return <OutcomeWidget cs={analytics.completion_summary} />;

    // ── Stuckness ─────────────────────────
    case 'stuckness': {
      const s = analytics.stuckness;
      if (s.total_sessions === 0) return <GhostStatRow labels={['stuck rate', 'stuck sessions']} />;
      return (
        <div className={styles.statRow}>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{s.stuckness_rate}%</span>
            <span className={styles.statBlockLabel}>stuck rate</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{s.stuck_sessions}</span>
            <span className={styles.statBlockLabel}>stuck sessions</span>
          </div>
          {s.stuck_sessions > 0 && (
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{s.stuck_completion_rate}%</span>
              <span className={styles.statBlockLabel}>stuck completed</span>
            </div>
          )}
        </div>
      );
    }

    // ── Sparklines ────────────────────────
    case 'session-trend': {
      const data = analytics.daily_trends.map((d) => d.sessions);
      if (data.length < 2) return <GhostSparkline />;
      return <Sparkline data={data} height={80} />;
    }
    case 'edit-velocity': {
      const data = analytics.edit_velocity.map((d) => d.edits_per_hour);
      if (data.length < 2) return <GhostSparkline />;
      return <Sparkline data={data} height={80} />;
    }

    // ── Heatmap ───────────────────────────
    case 'heatmap':
      return <HeatmapWidget hourly={analytics.hourly_distribution} />;

    // ── Work types ────────────────────────
    case 'work-types':
      return <WorkTypeWidget workTypes={analytics.work_type_distribution} />;

    // ── Codebase ──────────────────────────
    case 'directories':
      return <DirectoryWidget dirs={analytics.directory_heatmap} />;
    case 'files':
      return <FileWidget files={analytics.file_heatmap} />;

    // ── Tools & Models ────────────────────
    case 'tools':
      return <ToolsWidget tools={analytics.tool_comparison} />;
    case 'models':
      return <ModelsWidget modelOutcomes={analytics.model_outcomes} />;

    // ── Conversations ─────────────────────
    case 'conversation-stats': {
      if (conversationData.total_messages === 0)
        return <GhostStatRow labels={['messages', 'sessions']} />;
      return (
        <div className={styles.statRow}>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>
              {conversationData.total_messages.toLocaleString()}
            </span>
            <span className={styles.statBlockLabel}>messages</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>
              {conversationData.sessions_with_conversations}
            </span>
            <span className={styles.statBlockLabel}>sessions</span>
          </div>
        </div>
      );
    }
    case 'sentiment':
      return <SentimentWidget data={conversationData.sentiment_distribution} />;
    case 'topics':
      return <TopicWidget data={conversationData.topic_distribution} />;

    // ── Memory ────────────────────────────
    case 'memory-stats': {
      const m = analytics.memory_usage;
      if (m.total_memories === 0 && m.searches === 0)
        return <GhostStatRow labels={['memories', 'searches', 'created']} />;
      return (
        <div className={styles.statRow}>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{m.total_memories}</span>
            <span className={styles.statBlockLabel}>memories</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{m.searches}</span>
            <span className={styles.statBlockLabel}>searches</span>
          </div>
          {m.search_hit_rate > 0 && (
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{m.search_hit_rate}%</span>
              <span className={styles.statBlockLabel}>hit rate</span>
            </div>
          )}
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{m.memories_created_period}</span>
            <span className={styles.statBlockLabel}>created</span>
          </div>
          {m.stale_memories > 0 && (
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{m.stale_memories}</span>
              <span className={styles.statBlockLabel}>stale</span>
            </div>
          )}
          {m.avg_memory_age_days > 0 && (
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{Math.round(m.avg_memory_age_days)}d</span>
              <span className={styles.statBlockLabel}>avg age</span>
            </div>
          )}
        </div>
      );
    }

    // ── Team ──────────────────────────────
    case 'team-members':
      return <TeamWidget members={analytics.member_analytics} />;

    // ── Projects ──────────────────────────
    case 'projects':
      return (
        <ProjectWidget summaries={summaries} liveAgents={liveAgents} selectTeam={selectTeam} />
      );

    // ── First edit timing ────────────────
    case 'first-edit': {
      const fe = analytics.first_edit_stats;
      if (!fe || fe.avg_minutes_to_first_edit === 0)
        return <GhostStatRow labels={['avg first edit', 'median']} />;
      return (
        <div className={styles.statRow}>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>
              {fe.avg_minutes_to_first_edit.toFixed(1)}m
            </span>
            <span className={styles.statBlockLabel}>avg first edit</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>
              {fe.median_minutes_to_first_edit.toFixed(1)}m
            </span>
            <span className={styles.statBlockLabel}>median</span>
          </div>
          {fe.by_tool.length > 1 &&
            fe.by_tool.slice(0, 2).map((t) => (
              <div key={t.host_tool} className={styles.statBlock}>
                <span className={styles.statBlockValue}>{t.avg_minutes.toFixed(1)}m</span>
                <span className={styles.statBlockLabel}>{getToolMeta(t.host_tool).label}</span>
              </div>
            ))}
        </div>
      );
    }

    // ── Duration distribution ────────────
    case 'duration-dist': {
      const dd = analytics.duration_distribution;
      if (dd.length === 0) return <GhostBars count={4} />;
      const maxD = Math.max(...dd.map((d) => d.count), 1);
      return (
        <div className={styles.metricBars}>
          {dd.map((d) => (
            <div key={d.bucket} className={styles.metricRow}>
              <span className={styles.metricLabel}>{d.bucket}</span>
              <div className={styles.metricBarTrack}>
                <div
                  className={styles.metricBarFill}
                  style={{ width: `${(d.count / maxD) * 100}%` }}
                />
              </div>
              <span className={styles.metricValue}>{d.count}</span>
            </div>
          ))}
        </div>
      );
    }

    // ── Scope complexity ─────────────────
    case 'scope-complexity': {
      const sc = analytics.scope_complexity;
      if (sc.length === 0) return <GhostBars count={4} />;
      return (
        <div className={styles.metricBars}>
          {sc.map((b) => (
            <div key={b.bucket} className={styles.metricRow}>
              <span className={styles.metricLabel}>{b.bucket}</span>
              <div className={styles.metricBarTrack}>
                <div
                  className={styles.metricBarFill}
                  style={{
                    width: `${b.completion_rate}%`,
                    background: 'var(--success)',
                    opacity: 0.6,
                  }}
                />
              </div>
              <span className={styles.metricValue}>
                {b.completion_rate}% · {b.sessions}
              </span>
            </div>
          ))}
        </div>
      );
    }

    // ── Outcome predictors ───────────────
    case 'outcome-predictors': {
      const op = analytics.outcome_predictors;
      if (op.length === 0) return <GhostBars count={3} />;
      return (
        <div className={styles.dataList}>
          {op.map((p, i) => (
            <div
              key={p.outcome}
              className={styles.dataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.dataName}>{p.outcome}</span>
              <div className={styles.dataMeta}>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{p.avg_first_edit_min.toFixed(1)}m</span>{' '}
                  avg first edit
                </span>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{p.sessions}</span> sessions
                </span>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // ── Period comparison ─────────────────
    case 'period-delta': {
      const pc = analytics.period_comparison;
      if (!pc || !pc.previous)
        return <GhostStatRow labels={['completion', 'velocity', 'stuck rate']} />;
      return (
        <div className={styles.statRow}>
          <DeltaStat
            label="completion"
            current={pc.current.completion_rate}
            prev={pc.previous.completion_rate}
            suffix="%"
          />
          <DeltaStat
            label="velocity"
            current={pc.current.edit_velocity}
            prev={pc.previous.edit_velocity}
            suffix="/hr"
          />
          <DeltaStat
            label="stuck rate"
            current={pc.current.stuckness_rate}
            prev={pc.previous.stuckness_rate}
            suffix="%"
            invert
          />
          <DeltaStat
            label="sessions"
            current={pc.current.total_sessions}
            prev={pc.previous.total_sessions}
            suffix=""
          />
        </div>
      );
    }

    // ── Prompt efficiency sparkline ──────
    case 'prompt-efficiency': {
      const pe = analytics.prompt_efficiency;
      const data = pe.map((d) => d.avg_turns_per_edit);
      if (data.length < 2) return <GhostSparkline />;
      return <Sparkline data={data} height={80} />;
    }

    // ── Hourly effectiveness ─────────────
    case 'hourly-effectiveness': {
      const he = analytics.hourly_effectiveness;
      if (he.length === 0) return <GhostBars count={6} />;
      const maxS = Math.max(...he.map((h) => h.sessions), 1);
      return (
        <div className={styles.metricBars}>
          {he
            .filter((h) => h.sessions > 0)
            .slice(0, 12)
            .map((h) => (
              <div key={h.hour} className={styles.metricRow}>
                <span className={styles.metricLabel}>
                  {h.hour === 0
                    ? '12a'
                    : h.hour < 12
                      ? `${h.hour}a`
                      : h.hour === 12
                        ? '12p'
                        : `${h.hour - 12}p`}
                </span>
                <div className={styles.metricBarTrack}>
                  <div
                    className={styles.metricBarFill}
                    style={{
                      width: `${(h.sessions / maxS) * 100}%`,
                      background:
                        h.completion_rate >= 70
                          ? 'var(--success)'
                          : h.completion_rate >= 40
                            ? 'var(--warn)'
                            : 'var(--danger)',
                      opacity: 0.6,
                    }}
                  />
                </div>
                <span className={styles.metricValue}>
                  {h.completion_rate}% · {h.sessions}
                </span>
              </div>
            ))}
        </div>
      );
    }

    // ── Work type outcomes ────────────────
    case 'work-type-outcomes': {
      const wto = analytics.work_type_outcomes;
      if (wto.length === 0) return <GhostBars count={4} />;
      return (
        <div className={styles.metricBars}>
          {wto.map((w) => (
            <div key={w.work_type} className={styles.metricRow}>
              <span className={styles.metricLabel}>{w.work_type}</span>
              <div className={styles.metricBarTrack}>
                <div
                  className={styles.metricBarFill}
                  style={{
                    width: `${w.completion_rate}%`,
                    background: WORK_TYPE_COLORS[w.work_type] || WORK_TYPE_COLORS.other,
                    opacity: 0.6,
                  }}
                />
              </div>
              <span className={styles.metricValue}>
                {w.completion_rate}% · {w.sessions}
              </span>
            </div>
          ))}
        </div>
      );
    }

    // ── File churn ────────────────────────
    case 'file-churn': {
      const fc = analytics.file_churn;
      if (fc.length === 0) return <GhostRows count={3} />;
      return (
        <div className={styles.dataList}>
          {fc.slice(0, 10).map((f, i) => (
            <div
              key={f.file}
              className={styles.dataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.dataName} title={f.file}>
                {f.file.split('/').slice(-2).join('/')}
              </span>
              <div className={styles.dataMeta}>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{f.session_count}</span> sessions
                </span>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{f.total_edits}</span> edits
                </span>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{f.total_lines.toLocaleString()}</span>{' '}
                  lines
                </span>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // ── File rework ──────────────────────
    case 'file-rework': {
      const fr = analytics.file_rework;
      if (fr.length === 0) return <GhostRows count={3} />;
      return (
        <div className={styles.dataList}>
          {fr.slice(0, 10).map((f, i) => (
            <div
              key={f.file}
              className={styles.dataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.dataName} title={f.file}>
                {f.file.split('/').slice(-2).join('/')}
              </span>
              <div className={styles.dataMeta}>
                <span className={styles.dataStat} style={{ color: 'var(--danger)' }}>
                  <span className={styles.dataStatValue}>{f.rework_ratio}%</span> rework
                </span>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>
                    {f.failed_edits}/{f.total_edits}
                  </span>{' '}
                  failed
                </span>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // ── Stale directories ────────────────
    case 'audit-staleness': {
      const as_ = analytics.audit_staleness;
      if (as_.length === 0)
        return <span className={styles.sectionEmpty}>No stale directories</span>;
      return (
        <div className={styles.dataList}>
          {as_.slice(0, 10).map((d, i) => (
            <div
              key={d.directory}
              className={styles.dataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.dataName}>{d.directory}</span>
              <div className={styles.dataMeta}>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{d.days_since}d</span> ago
                </span>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{d.prior_edit_count}</span> prior edits
                </span>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // ── Concurrent edits ─────────────────
    case 'concurrent-edits': {
      const ce = analytics.concurrent_edits;
      if (ce.length === 0)
        return <span className={styles.sectionEmpty}>No concurrent edits detected</span>;
      return (
        <div className={styles.dataList}>
          {ce.slice(0, 10).map((f, i) => (
            <div
              key={f.file}
              className={styles.dataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.dataName} title={f.file}>
                {f.file.split('/').slice(-2).join('/')}
              </span>
              <div className={styles.dataMeta}>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{f.agents}</span> agents
                </span>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{f.edit_count}</span> edits
                </span>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // ── Tool outcomes ────────────────────
    case 'tool-outcomes': {
      const to = analytics.tool_outcomes;
      if (to.length === 0) return <GhostBars count={3} />;
      // Group by tool, show stacked outcome counts
      const byTool = new Map<string, { completed: number; abandoned: number; failed: number }>();
      for (const t of to) {
        const entry = byTool.get(t.host_tool) || { completed: 0, abandoned: 0, failed: 0 };
        if (t.outcome === 'completed') entry.completed = t.count;
        else if (t.outcome === 'abandoned') entry.abandoned = t.count;
        else if (t.outcome === 'failed') entry.failed = t.count;
        byTool.set(t.host_tool, entry);
      }
      const tools = [...byTool.entries()]
        .map(([tool, counts]) => ({
          tool,
          ...counts,
          total: counts.completed + counts.abandoned + counts.failed,
        }))
        .sort((a, b) => b.total - a.total);
      const maxT = Math.max(...tools.map((t) => t.total), 1);
      return (
        <div className={styles.metricBars}>
          {tools.map((t) => (
            <div key={t.tool} className={styles.metricRow}>
              <span className={styles.metricLabel}>{getToolMeta(t.tool).label}</span>
              <div className={styles.metricBarTrack}>
                <div
                  className={styles.metricBarFill}
                  style={{
                    width: `${(t.completed / maxT) * 100}%`,
                    background: 'var(--success)',
                    opacity: 0.6,
                  }}
                />
                <div
                  className={styles.metricBarFill}
                  style={{
                    width: `${(t.abandoned / maxT) * 100}%`,
                    background: 'var(--warn)',
                    opacity: 0.6,
                  }}
                />
                <div
                  className={styles.metricBarFill}
                  style={{
                    width: `${(t.failed / maxT) * 100}%`,
                    background: 'var(--danger)',
                    opacity: 0.6,
                  }}
                />
              </div>
              <span className={styles.metricValue}>
                {t.completed}/{t.abandoned}/{t.failed}
              </span>
            </div>
          ))}
        </div>
      );
    }

    // ── Tool handoffs ────────────────────
    case 'tool-handoffs': {
      const th = analytics.tool_handoffs;
      if (th.length === 0)
        return <span className={styles.sectionEmpty}>No cross-tool handoffs</span>;
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
                  <span className={styles.dataStatValue}>{h.handoff_completion_rate}%</span>{' '}
                  completed
                </span>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // ── Tool calls overview ──────────────
    case 'tool-calls': {
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

    // ── Tool call frequency ──────────────
    case 'tool-call-freq': {
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

    // ── Tool call errors ─────────────────
    case 'tool-call-errors': {
      const errs = analytics.tool_call_stats.error_patterns;
      if (errs.length === 0) return <span className={styles.sectionEmpty}>No tool errors</span>;
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
                <span
                  className={styles.dataStat}
                  style={{ opacity: 0.7, fontSize: 'var(--text-2xs)' }}
                >
                  {e.error_preview.slice(0, 80)}
                </span>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // ── Token detail ─────────────────────
    case 'token-detail': {
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
                  <span className={styles.dataStatValue}>
                    {(m.input_tokens / 1000).toFixed(0)}k
                  </span>{' '}
                  in
                </span>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>
                    {(m.output_tokens / 1000).toFixed(0)}k
                  </span>{' '}
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
        </div>
      );
    }

    // ── Sentiment outcomes ───────────────
    case 'sentiment-outcomes': {
      const soc = conversationData.sentiment_outcome_correlation;
      if (!soc || soc.length === 0) return <GhostBars count={3} />;
      return (
        <div className={styles.metricBars}>
          {soc.map((s) => (
            <div key={s.dominant_sentiment} className={styles.metricRow}>
              <span className={styles.metricLabel}>{s.dominant_sentiment}</span>
              <div className={styles.metricBarTrack}>
                <div
                  className={styles.metricBarFill}
                  style={{
                    width: `${s.completion_rate}%`,
                    background: SENTIMENT_COLORS[s.dominant_sentiment] || 'var(--ghost)',
                    opacity: 0.6,
                  }}
                />
              </div>
              <span className={styles.metricValue}>
                {s.completion_rate}% · {s.sessions}
              </span>
            </div>
          ))}
        </div>
      );
    }

    // ── Conversation depth ───────────────
    case 'conversation-depth': {
      const ced = analytics.conversation_edit_correlation;
      if (ced.length === 0) return <GhostBars count={4} />;
      const maxCed = Math.max(...ced.map((c) => c.avg_edits), 1);
      return (
        <div className={styles.metricBars}>
          {ced.map((c) => (
            <div key={c.bucket} className={styles.metricRow}>
              <span className={styles.metricLabel}>{c.bucket} turns</span>
              <div className={styles.metricBarTrack}>
                <div
                  className={styles.metricBarFill}
                  style={{ width: `${(c.avg_edits / maxCed) * 100}%` }}
                />
              </div>
              <span className={styles.metricValue}>
                {c.avg_edits.toFixed(1)} edits · {c.completion_rate}%
              </span>
            </div>
          ))}
        </div>
      );
    }

    // ── Memory outcomes ──────────────────
    case 'memory-outcomes': {
      const moc = analytics.memory_outcome_correlation;
      if (moc.length === 0) return <GhostBars count={2} />;
      return (
        <div className={styles.metricBars}>
          {moc.map((m) => (
            <div key={m.bucket} className={styles.metricRow}>
              <span className={styles.metricLabel}>{m.bucket}</span>
              <div className={styles.metricBarTrack}>
                <div
                  className={styles.metricBarFill}
                  style={{
                    width: `${m.completion_rate}%`,
                    background: 'var(--success)',
                    opacity: 0.6,
                  }}
                />
              </div>
              <span className={styles.metricValue}>
                {m.completion_rate}% · {m.sessions}
              </span>
            </div>
          ))}
        </div>
      );
    }

    // ── Top memories ─────────────────────
    case 'top-memories': {
      const tm = analytics.top_memories;
      if (tm.length === 0) return <span className={styles.sectionEmpty}>No memories accessed</span>;
      return (
        <div className={styles.dataList}>
          {tm.slice(0, 8).map((m, i) => {
            const daysAgo = m.last_accessed_at
              ? Math.max(
                  0,
                  Math.floor((nowMs - new Date(m.last_accessed_at).getTime()) / 86_400_000),
                )
              : null;
            return (
              <div
                key={m.id}
                className={styles.dataRow}
                style={{ '--row-index': i } as CSSProperties}
              >
                <span className={styles.dataName} style={{ fontSize: 'var(--text-2xs)' }}>
                  {m.text_preview}
                </span>
                <div className={styles.dataMeta}>
                  <span className={styles.dataStat}>
                    <span className={styles.dataStatValue}>{m.access_count}</span> hits
                  </span>
                  {daysAgo !== null && (
                    <span className={styles.dataStat}>
                      <span className={styles.dataStatValue}>
                        {daysAgo === 0 ? 'today' : `${daysAgo}d`}
                      </span>
                      {daysAgo > 0 ? ' ago' : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // ── Conflict impact ──────────────────
    case 'conflict-impact': {
      const cc = analytics.conflict_correlation;
      if (cc.length === 0) return <GhostStatRow labels={['with conflicts', 'without']} />;
      return (
        <div className={styles.statRow}>
          {cc.map((c) => (
            <div key={c.bucket} className={styles.statBlock}>
              <span className={styles.statBlockValue}>{c.completion_rate}%</span>
              <span className={styles.statBlockLabel}>
                {c.bucket} ({c.sessions})
              </span>
            </div>
          ))}
        </div>
      );
    }

    // ── Retry patterns ───────────────────
    case 'retry-patterns': {
      const rp = analytics.retry_patterns;
      if (rp.length === 0) return <span className={styles.sectionEmpty}>No retry patterns</span>;
      return (
        <div className={styles.dataList}>
          {rp.slice(0, 10).map((r, i) => (
            <div
              key={`${r.handle}-${r.file}`}
              className={styles.dataRow}
              style={{ '--row-index': i } as CSSProperties}
            >
              <span className={styles.dataName} title={r.file}>
                {r.file.split('/').slice(-2).join('/')}
              </span>
              <div className={styles.dataMeta}>
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{r.attempts}</span> attempts
                </span>
                <span
                  className={styles.dataStat}
                  style={{ color: r.resolved ? 'var(--success)' : 'var(--danger)' }}
                >
                  {r.resolved ? 'resolved' : r.final_outcome}
                </span>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // ── Tool adoption (multi-line) ──────
    case 'tool-daily': {
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

    // ── Tool work mix (per-tool stacked bar) ──
    case 'tool-work-type': {
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

    // ── Tool call hourly pacing ─────────
    case 'tool-call-hourly': {
      const ha = analytics.tool_call_stats.hourly_activity;
      if (ha.length === 0) return <GhostSparkline />;
      const buckets = new Array(24).fill(0) as number[];
      for (const h of ha) {
        if (h.hour >= 0 && h.hour < 24) buckets[h.hour] += h.calls;
      }
      if (buckets.every((v) => v === 0)) return <GhostSparkline />;
      return <Sparkline data={buckets} height={80} />;
    }

    // ── Data coverage ───────────────────
    case 'data-coverage': {
      const cats = computeDataCoverage(analytics, conversationData);
      const totalActive = cats.reduce((s, c) => s + c.active, 0);
      const totalPossible = cats.reduce((s, c) => s + c.total, 0);
      const waiting = cats.filter((c) => c.active < c.total);
      return (
        <>
          <div className={styles.statRow} style={{ marginBottom: 12 }}>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{totalActive}</span>
              <span className={styles.statBlockLabel}>active</span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{totalPossible - totalActive}</span>
              <span className={styles.statBlockLabel}>waiting</span>
            </div>
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>
                {Math.round((totalActive / Math.max(totalPossible, 1)) * 100)}%
              </span>
              <span className={styles.statBlockLabel}>coverage</span>
            </div>
          </div>
          {waiting.length === 0 ? (
            <span className={styles.sectionEmpty}>All insights have data</span>
          ) : (
            <div className={styles.dataList}>
              {waiting.slice(0, 8).map((cat, i) => (
                <div
                  key={cat.id}
                  className={styles.dataRow}
                  style={{ '--row-index': i } as CSSProperties}
                >
                  <span className={styles.dataName}>{cat.label}</span>
                  <div className={styles.dataMeta}>
                    <span className={styles.dataStat}>
                      <span className={styles.dataStatValue}>
                        {cat.active}/{cat.total}
                      </span>
                    </span>
                    <span className={styles.dataStat} style={{ color: 'var(--muted)' }}>
                      {cat.hint}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      );
    }

    // ── Message length ──────────────────
    case 'message-length': {
      const u = conversationData.avg_user_char_count;
      const a = conversationData.avg_assistant_char_count;
      if (u === 0 && a === 0) return <GhostStatRow labels={['your prompts', 'responses']} />;
      return (
        <div className={styles.statRow}>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{Math.round(u).toLocaleString()}</span>
            <span className={styles.statBlockLabel}>your chars</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{Math.round(a).toLocaleString()}</span>
            <span className={styles.statBlockLabel}>response chars</span>
          </div>
          {u > 0 && (
            <div className={styles.statBlock}>
              <span className={styles.statBlockValue}>{Math.round(a / u)}×</span>
              <span className={styles.statBlockLabel}>response ratio</span>
            </div>
          )}
        </div>
      );
    }

    // ── File overlap ────────────────────
    case 'file-overlap': {
      const fo = analytics.file_overlap;
      if (fo.total_files === 0) return <GhostStatRow labels={['overlap rate', 'shared files']} />;
      return (
        <div className={styles.statRow}>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{fo.overlap_rate}%</span>
            <span className={styles.statBlockLabel}>overlap rate</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{fo.overlapping_files}</span>
            <span className={styles.statBlockLabel}>shared files</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statBlockValue}>{fo.total_files}</span>
            <span className={styles.statBlockLabel}>total files</span>
          </div>
        </div>
      );
    }

    default:
      return <span className={styles.sectionEmpty}>Unknown widget</span>;
  }
}

// ── Shared ghost states ─────────────────────────

function StatWidget({ value }: { value: string }) {
  return <span className={styles.heroStatValue}>{value}</span>;
}

function GhostStatRow({ labels }: { labels: string[] }) {
  return (
    <div className={styles.ghostStatRow}>
      {labels.map((l) => (
        <div key={l} className={styles.statBlock}>
          <span className={styles.ghostStatValue}>—</span>
          <span className={styles.statBlockLabel}>{l}</span>
        </div>
      ))}
    </div>
  );
}

function GhostBars({ count }: { count: number }) {
  return (
    <div className={styles.metricBars}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.ghostRow}>
          <span className={styles.ghostLabel}>—</span>
          <div className={styles.ghostBarTrack} />
          <span className={styles.ghostValue}>—</span>
        </div>
      ))}
    </div>
  );
}

function GhostRows({ count }: { count: number }) {
  return (
    <div className={styles.dataList}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.ghostRow}>
          <span className={styles.ghostLabel} style={{ width: 'auto' }}>
            —
          </span>
          <span className={styles.ghostValue}>—</span>
        </div>
      ))}
    </div>
  );
}

function DeltaStat({
  label,
  current,
  prev,
  suffix,
  invert,
}: {
  label: string;
  current: number;
  prev: number;
  suffix: string;
  invert?: boolean;
}) {
  const d = current - prev;
  const isGood = invert ? d < 0 : d > 0;
  const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
  const color = d === 0 ? 'var(--muted)' : isGood ? 'var(--success)' : 'var(--danger)';
  return (
    <div className={styles.statBlock}>
      <span className={styles.statBlockValue}>
        {typeof current === 'number' && current % 1 !== 0 ? current.toFixed(1) : current}
        {suffix}
        <span style={{ color, marginLeft: 6, fontSize: 'var(--text-2xs)' }}>
          {arrow}
          {Math.abs(d) % 1 !== 0 ? Math.abs(d).toFixed(1) : Math.abs(d)}
        </span>
      </span>
      <span className={styles.statBlockLabel}>{label}</span>
    </div>
  );
}

function GhostSparkline() {
  return (
    <svg
      width="100%"
      height={80}
      viewBox="0 0 300 80"
      preserveAspectRatio="none"
      className={styles.trendSvg}
    >
      <line x1="0" y1="40" x2="300" y2="40" stroke="var(--ghost)" strokeWidth="1.5" opacity="0.3" />
    </svg>
  );
}

// ── Outcome bar ─────────────────────────────────

function OutcomeWidget({ cs }: { cs: UserAnalytics['completion_summary'] }) {
  if (cs.total_sessions === 0) {
    return (
      <>
        <div className={styles.outcomeBar}>
          <div
            className={styles.outcomeSegment}
            style={{ width: '100%', background: 'var(--ghost)' }}
          />
        </div>
        <div
          className={styles.outcomeLegend}
          style={{ flexDirection: 'column', gap: 8, marginTop: 12, opacity: 0.3 }}
        >
          {['finished', 'abandoned', 'failed'].map((l) => (
            <div key={l} className={styles.outcomeItem}>
              <span className={styles.outcomeDot} style={{ background: 'var(--ghost)' }} />
              <span className={styles.outcomeValue}>—</span>
              <span className={styles.outcomeLabel}>{l}</span>
            </div>
          ))}
        </div>
      </>
    );
  }
  const items = [
    { key: 'completed', count: cs.completed, color: 'var(--success)', label: 'finished' },
    { key: 'abandoned', count: cs.abandoned, color: 'var(--warn)', label: 'abandoned' },
    { key: 'failed', count: cs.failed, color: 'var(--danger)', label: 'failed' },
    { key: 'unknown', count: cs.unknown, color: 'var(--ghost)', label: 'unknown' },
  ].filter((i) => i.count > 0);

  return (
    <>
      <div className={styles.outcomeBar}>
        {items.map((i) => (
          <div
            key={i.key}
            className={styles.outcomeSegment}
            style={{
              width: `${(i.count / cs.total_sessions) * 100}%`,
              background: i.color,
              opacity: i.key === 'unknown' ? 1 : 0.6,
            }}
          />
        ))}
      </div>
      <div
        className={styles.outcomeLegend}
        style={{ flexDirection: 'column', gap: 8, marginTop: 12 }}
      >
        {items.map((i) => (
          <div key={i.key} className={styles.outcomeItem}>
            <span className={styles.outcomeDot} style={{ background: i.color }} />
            <span className={styles.outcomeValue}>{i.count}</span>
            <span className={styles.outcomeLabel}>{i.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Heatmap ─────────────────────────────────────

const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21];

function HeatmapWidget({ hourly }: { hourly: UserAnalytics['hourly_distribution'] }) {
  const { grid, max } = useMemo(() => buildHeatmapData(hourly), [hourly]);
  const hasData = hourly.length > 0;

  return (
    <div className={styles.heatmapWrap}>
      <div className={styles.heatmapGrid}>
        <div className={styles.heatmapYLabels}>
          {DAY_LABELS.map((d) => (
            <span key={d} className={styles.heatmapYLabel}>
              {d}
            </span>
          ))}
        </div>
        <div className={styles.heatmapCols}>
          {Array.from({ length: 24 }, (_, hour) => (
            <div key={hour} className={styles.heatmapCol}>
              {Array.from({ length: 7 }, (_, dow) => {
                const val = hasData ? grid[dow][hour] : 0;
                const opacity = max > 0 ? 0.05 + (val / max) * 0.7 : 0.04;
                return (
                  <div
                    key={dow}
                    className={styles.heatmapCell}
                    style={{ background: 'var(--accent)', opacity }}
                    title={hasData ? `${DAY_LABELS[dow]} ${hour}:00 — ${val} sessions` : ''}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.heatmapXLabels}>
        {HOUR_LABELS.map((h) => (
          <span key={h} className={styles.heatmapXLabel}>
            {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Work types ──────────────────────────────────

function WorkTypeWidget({ workTypes }: { workTypes: UserAnalytics['work_type_distribution'] }) {
  const total = workTypes.reduce((s, w) => s + w.sessions, 0);
  if (total === 0) {
    return (
      <>
        <div className={styles.workBar}>
          <div
            className={styles.workSegment}
            style={{ width: '100%', background: 'var(--ghost)', opacity: 0.3 }}
          />
        </div>
        <div className={styles.workLegend} style={{ opacity: 0.3 }}>
          {['frontend', 'backend', 'test'].map((t) => (
            <div key={t} className={styles.workLegendItem}>
              <span className={styles.workDot} style={{ background: WORK_TYPE_COLORS[t] }} />
              <span className={styles.workLegendLabel}>{t}</span>
              <span className={styles.workLegendValue}>—</span>
            </div>
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <div className={styles.workBar}>
        {workTypes.map((w) => {
          const pct = (w.sessions / total) * 100;
          return pct < 1 ? null : (
            <div
              key={w.work_type}
              className={styles.workSegment}
              style={{
                width: `${pct}%`,
                background: WORK_TYPE_COLORS[w.work_type] || WORK_TYPE_COLORS.other,
              }}
              title={`${w.work_type}: ${Math.round(pct)}%`}
            />
          );
        })}
      </div>
      <div className={styles.workLegend}>
        {workTypes.map((w) => {
          const pct = Math.round((w.sessions / total) * 100);
          return pct < 1 ? null : (
            <div key={w.work_type} className={styles.workLegendItem}>
              <span
                className={styles.workDot}
                style={{ background: WORK_TYPE_COLORS[w.work_type] || WORK_TYPE_COLORS.other }}
              />
              <span className={styles.workLegendLabel}>{w.work_type}</span>
              <span className={styles.workLegendValue}>
                {pct}% · {w.sessions}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Directories ─────────────────────────────────

function DirectoryWidget({ dirs }: { dirs: UserAnalytics['directory_heatmap'] }) {
  if (dirs.length === 0) {
    return (
      <div className={styles.metricBars}>
        {[1, 2, 3].map((i) => (
          <div key={i} className={styles.ghostRow}>
            <span className={styles.ghostLabel}>—</span>
            <div className={styles.ghostBarTrack} />
            <span className={styles.ghostValue}>—</span>
          </div>
        ))}
      </div>
    );
  }
  const maxT = Math.max(...dirs.map((d) => d.touch_count), 1);
  return (
    <div className={styles.metricBars}>
      {dirs.slice(0, 10).map((d) => (
        <div key={d.directory} className={styles.metricRow}>
          <span className={styles.metricLabel} title={d.directory}>
            {d.directory}
          </span>
          <div className={styles.metricBarTrack}>
            <div
              className={styles.metricBarFill}
              style={{ width: `${(d.touch_count / maxT) * 100}%` }}
            />
          </div>
          <span className={styles.metricValue}>
            {d.touch_count}
            {d.file_count > 0 ? ` · ${d.file_count}f` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Files ────────────────────────────────────────

function FileWidget({ files }: { files: UserAnalytics['file_heatmap'] }) {
  if (files.length === 0) {
    return (
      <div className={styles.dataList}>
        {[1, 2, 3].map((i) => (
          <div key={i} className={styles.ghostRow}>
            <span className={styles.ghostLabel} style={{ width: 'auto' }}>
              —
            </span>
            <span className={styles.ghostValue}>—</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.dataList}>
      {files.slice(0, 10).map((f, i) => (
        <div key={f.file} className={styles.dataRow} style={{ '--row-index': i } as CSSProperties}>
          <span className={styles.dataName} title={f.file}>
            {f.file.split('/').slice(-2).join('/')}
          </span>
          <div className={styles.dataMeta}>
            <span className={styles.dataStat}>
              <span className={styles.dataStatValue}>{f.touch_count}</span> touches
            </span>
            {f.total_lines_added != null && f.total_lines_removed != null && (
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>
                  +{f.total_lines_added}/-{f.total_lines_removed}
                </span>
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tools ────────────────────────────────────────

function ToolsWidget({ tools }: { tools: UserAnalytics['tool_comparison'] }) {
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

// ── Models ───────────────────────────────────────

function ModelsWidget({ modelOutcomes }: { modelOutcomes: UserAnalytics['model_outcomes'] }) {
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

// ── Sentiment ───────────────────────────────────

function SentimentWidget({ data }: { data: ConversationAnalytics['sentiment_distribution'] }) {
  if (data.length === 0) {
    return (
      <div className={styles.metricBars} style={{ opacity: 0.25 }}>
        {['positive', 'neutral', 'frustrated'].map((s) => (
          <div key={s} className={styles.metricRow}>
            <span className={styles.metricLabel}>{s}</span>
            <div className={styles.metricBarTrack} />
            <span className={styles.durationCount}>—</span>
          </div>
        ))}
      </div>
    );
  }
  const maxC = Math.max(...data.map((s) => s.count), 1);
  return (
    <div className={styles.metricBars}>
      {data.map((s) => (
        <div key={s.sentiment} className={styles.metricRow}>
          <span className={styles.metricLabel}>{s.sentiment}</span>
          <div className={styles.metricBarTrack}>
            <div
              className={styles.metricBarFill}
              style={{
                width: `${(s.count / maxC) * 100}%`,
                background: SENTIMENT_COLORS[s.sentiment] || 'var(--ghost)',
              }}
            />
          </div>
          <span className={styles.durationCount}>{s.count}</span>
        </div>
      ))}
    </div>
  );
}

// ── Topics ──────────────────────────────────────

function TopicWidget({ data }: { data: ConversationAnalytics['topic_distribution'] }) {
  if (data.length === 0) {
    return (
      <div className={styles.metricBars} style={{ opacity: 0.25 }}>
        {['bug-fix', 'feature', 'refactor'].map((t) => (
          <div key={t} className={styles.metricRow}>
            <span className={styles.metricLabel}>{t}</span>
            <div className={styles.metricBarTrack} />
            <span className={styles.durationCount}>—</span>
          </div>
        ))}
      </div>
    );
  }
  const maxC = Math.max(...data.map((t) => t.count), 1);
  return (
    <div className={styles.metricBars}>
      {data.slice(0, 8).map((t) => (
        <div key={t.topic} className={styles.metricRow}>
          <span className={styles.metricLabel}>{t.topic}</span>
          <div className={styles.metricBarTrack}>
            <div className={styles.metricBarFill} style={{ width: `${(t.count / maxC) * 100}%` }} />
          </div>
          <span className={styles.durationCount}>{t.count}</span>
        </div>
      ))}
    </div>
  );
}

// ── Team ─────────────────────────────────────────

function TeamWidget({ members }: { members: UserAnalytics['member_analytics'] }) {
  if (members.length <= 1) {
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
      {members.map((m, i) => {
        const meta = m.primary_tool ? getToolMeta(m.primary_tool) : null;
        return (
          <div
            key={m.handle}
            className={styles.dataRow}
            style={{ '--row-index': i } as CSSProperties}
          >
            <span className={styles.dataName}>
              {m.handle}
              {meta && (
                <span className={styles.dataStat} style={{ marginLeft: 8 }}>
                  {meta.label}
                </span>
              )}
            </span>
            <div className={styles.dataMeta}>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{m.sessions}</span> sessions
              </span>
              <span className={styles.dataStat}>
                <span className={styles.dataStatValue}>{m.total_edits.toLocaleString()}</span> edits
              </span>
              {m.completion_rate > 0 && (
                <span className={styles.dataStat}>
                  <span className={styles.dataStatValue}>{m.completion_rate}%</span>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Projects ─────────────────────────────────────

function ProjectWidget({
  summaries,
  liveAgents,
  selectTeam,
}: {
  summaries: Array<Record<string, unknown>>;
  liveAgents: LiveAgent[];
  selectTeam: (id: string) => void;
}) {
  if (summaries.length === 0) return <span className={styles.sectionEmpty}>No projects</span>;

  return (
    <div className={styles.projectList}>
      {summaries.map((s, i) => {
        const teamId = (s.team_id as string) || '';
        const teamName = (s.team_name as string) || teamId;
        const sessions24 = (s.recent_sessions_24h as number) || 0;
        const conflictCount = (s.conflict_count as number) || 0;
        const memoryCount = (s.memory_count as number) || 0;
        const liveCount = liveAgents.filter((a) => a.teamId === teamId).length;
        return (
          <button
            key={teamId}
            type="button"
            className={styles.projectRow}
            style={{ '--row-index': i } as CSSProperties}
            onClick={() => selectTeam(teamId)}
          >
            <span className={styles.projectName}>{teamName}</span>
            <div className={styles.projectMeta}>
              {liveCount > 0 && (
                <span className={styles.projectLive}>
                  <span className={styles.liveDot} style={{ background: 'var(--accent)' }} />
                  {liveCount} live
                </span>
              )}
              {sessions24 > 0 && (
                <span className={styles.projectStat}>{sessions24} sessions today</span>
              )}
              {conflictCount > 0 && (
                <span className={styles.projectStat} style={{ color: 'var(--warn)' }}>
                  {conflictCount} {conflictCount === 1 ? 'conflict' : 'conflicts'}
                </span>
              )}
              {memoryCount > 0 && (
                <span className={styles.projectStat}>
                  {memoryCount.toLocaleString()} {memoryCount === 1 ? 'memory' : 'memories'}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
